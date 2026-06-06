import { Db, Collection, Document } from 'mongodb';
import { logger } from './logger';

/**
 * Write operations that should be intercepted in dry-run mode.
 * Each is replaced with an .explain("executionStats") call.
 */
const WRITE_OPERATIONS = [
  'insertOne',
  'insertMany',
  'updateOne',
  'updateMany',
  'deleteOne',
  'deleteMany',
  'replaceOne',
  'bulkWrite',
  'findOneAndUpdate',
  'findOneAndReplace',
  'findOneAndDelete',
] as const;

/**
 * Create a proxied Db instance that intercepts all write operations
 * and runs .explain("executionStats") instead, printing the query plan
 * without modifying any data.
 *
 * Read operations (find, aggregate, countDocuments, etc.) pass through normally
 * to give accurate explain output.
 */
export function createDryRunProxy(db: Db): Db {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === 'collection') {
        return (name: string, ...args: any[]) => {
          const realCollection = target.collection(name, ...args);
          return createCollectionProxy(realCollection);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

/**
 * Proxy a Collection to intercept write operations.
 */
function createCollectionProxy(collection: Collection): Collection {
  return new Proxy(collection, {
    get(target, prop, receiver) {
      const propName = prop as string;

      if (WRITE_OPERATIONS.includes(propName as any)) {
        return createExplainHandler(target, propName);
      }

      return Reflect.get(target, prop, receiver);
    },
  });
}

/**
 * Create a handler that replaces a write operation with .explain().
 */
function createExplainHandler(collection: Collection, operation: string) {
  return async (...args: any[]) => {
    logger.info(`[DRY-RUN] Intercepted ${operation} on "${collection.collectionName}"`, {
      operation,
      collection: collection.collectionName,
    });

    try {
      let explainResult: Document;

      switch (operation) {
        case 'updateOne':
        case 'updateMany': {
          const [filter, update] = args;
          explainResult = await collection
            .find(filter)
            .explain('executionStats');

          // Also count affected documents
          const matchCount = await collection.countDocuments(filter);

          logger.info(`[DRY-RUN] Explain for ${operation}`, {
            collection: collection.collectionName,
            filter: JSON.stringify(filter),
            update: JSON.stringify(update),
            documentsMatching: matchCount,
          });

          printExplainSummary(explainResult, operation, matchCount);
          break;
        }

        case 'deleteOne':
        case 'deleteMany': {
          const [filter] = args;
          explainResult = await collection
            .find(filter)
            .explain('executionStats');

          const matchCount = await collection.countDocuments(filter);

          logger.info(`[DRY-RUN] Explain for ${operation}`, {
            collection: collection.collectionName,
            filter: JSON.stringify(filter),
            documentsMatching: matchCount,
          });

          printExplainSummary(explainResult, operation, matchCount);
          break;
        }

        case 'insertOne':
        case 'insertMany': {
          const docCount = operation === 'insertOne' ? 1 : (args[0]?.length || 0);
          logger.info(`[DRY-RUN] Would insert ${docCount} document(s) into "${collection.collectionName}"`);
          break;
        }

        case 'replaceOne':
        case 'findOneAndUpdate':
        case 'findOneAndReplace':
        case 'findOneAndDelete': {
          const [filter] = args;
          explainResult = await collection
            .find(filter)
            .explain('executionStats');

          const matchCount = await collection.countDocuments(filter);

          logger.info(`[DRY-RUN] Explain for ${operation}`, {
            collection: collection.collectionName,
            filter: JSON.stringify(filter),
            documentsMatching: matchCount,
          });

          printExplainSummary(explainResult, operation, matchCount);
          break;
        }

        case 'bulkWrite': {
          const ops = args[0] || [];
          logger.info(`[DRY-RUN] Would execute ${ops.length} bulk operation(s) on "${collection.collectionName}"`);
          break;
        }

        default:
          logger.warn(`[DRY-RUN] Unhandled write operation: ${operation}`);
      }
    } catch (err: any) {
      logger.warn(`[DRY-RUN] Explain failed for ${operation}: ${err.message}`);
    }

    // Return a mock result that won't break the migration code
    return {
      acknowledged: true,
      modifiedCount: 0,
      matchedCount: 0,
      deletedCount: 0,
      insertedCount: 0,
      insertedId: null,
      insertedIds: {},
      upsertedCount: 0,
      upsertedId: null,
      value: null,
      ok: 1,
    };
  };
}

/**
 * Print a human-readable summary of an explain plan.
 */
function printExplainSummary(
  explain: Document,
  operation: string,
  matchCount: number
): void {
  const stats = explain?.executionStats || explain?.queryPlanner;

  if (!stats) {
    logger.info(`[DRY-RUN] No execution stats available for ${operation}`);
    return;
  }

  const summary: Record<string, unknown> = {
    operation,
    documentsMatching: matchCount,
  };

  if (stats.executionSuccess !== undefined) {
    summary.executionSuccess = stats.executionSuccess;
  }
  if (stats.nReturned !== undefined) {
    summary.nReturned = stats.nReturned;
  }
  if (stats.totalDocsExamined !== undefined) {
    summary.totalDocsExamined = stats.totalDocsExamined;
  }
  if (stats.totalKeysExamined !== undefined) {
    summary.totalKeysExamined = stats.totalKeysExamined;
  }
  if (stats.executionTimeMillis !== undefined) {
    summary.executionTimeMillis = stats.executionTimeMillis;
  }

  // Extract winning plan info
  const winningPlan = explain?.queryPlanner?.winningPlan;
  if (winningPlan) {
    summary.winningPlanStage = winningPlan.stage;
    if (winningPlan.inputStage) {
      summary.inputStage = winningPlan.inputStage.stage;
      if (winningPlan.inputStage.indexName) {
        summary.indexUsed = winningPlan.inputStage.indexName;
      }
    }
  }

  logger.info(`[DRY-RUN] Query plan summary`, summary);
}
