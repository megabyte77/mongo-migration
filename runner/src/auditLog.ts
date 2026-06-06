import { MongoClient, Db } from 'mongodb';
import { MigrationLogEntry } from './types';
import { logger } from './logger';

const COLLECTION_NAME = '_migration_log';
const LEGACY_UNIQUE_INDEX_NAME = 'idx_migrationId_unique';
const SUCCESS_UNIQUE_INDEX_NAME = 'idx_migrationId_unique_success';

/**
 * Manages the audit log collection in the _migration_audit database.
 * Each Atlas cluster has its own audit database to keep logs co-located with data.
 *
 * Semantics:
 *  - Every attempt (success or failure) is recorded → full forensic history.
 *  - Only ONE successful entry per migrationId is permitted (partial unique index).
 *  - Failed entries do NOT block retry — devs can fix the file and rerun.
 *  - Tamper protection applies only to migrations that have already SUCCEEDED.
 */
export class AuditLog {
  private db: Db;

  constructor(client: MongoClient, auditDatabaseName: string) {
    this.db = client.db(auditDatabaseName);
  }

  /**
   * Ensure required indexes exist on _migration_log collection.
   * Migrates away from the legacy non-partial unique index if present.
   */
  async ensureIndexes(): Promise<void> {
    const collection = this.db.collection(COLLECTION_NAME);

    // ── Drop legacy non-partial unique index (would block retries) ──
    try {
      const existing = await collection.indexes();
      const legacy = existing.find((i) => i.name === LEGACY_UNIQUE_INDEX_NAME);
      if (legacy && !legacy.partialFilterExpression) {
        logger.warn('Dropping legacy unique index that blocked retries', {
          index: LEGACY_UNIQUE_INDEX_NAME,
        });
        await collection.dropIndex(LEGACY_UNIQUE_INDEX_NAME);
      }
    } catch (err: any) {
      // Collection may not exist yet — that's fine
      logger.debug('Index inspection skipped', { reason: err.message });
    }

    // ── Partial unique: only ONE success per migrationId ──
    await collection.createIndex(
      { migrationId: 1 },
      {
        unique: true,
        name: SUCCESS_UNIQUE_INDEX_NAME,
        partialFilterExpression: { outcome: 'success' },
      }
    );

    // ── Non-unique index for fast lookups + queries by env/time ──
    await collection.createIndex(
      { migrationId: 1, startedAt: -1 },
      { name: 'idx_migrationId_startedAt' }
    );

    logger.debug('Audit log indexes ensured', { collection: COLLECTION_NAME });
  }

  /**
   * Look up the SUCCESSFUL run of a migration, if any.
   * Returns the log entry if the migration has been applied successfully,
   * null otherwise. Failed entries do not count — they allow retry.
   */
  async findSuccessfulById(migrationId: string): Promise<MigrationLogEntry | null> {
    const collection = this.db.collection<MigrationLogEntry>(COLLECTION_NAME);
    const entry = await collection.findOne({ migrationId, outcome: 'success' });
    return entry as MigrationLogEntry | null;
  }

  /**
   * Record a migration execution in the audit log.
   * Each call inserts a new row — full retry history is preserved.
   */
  async insert(entry: MigrationLogEntry): Promise<void> {
    const collection = this.db.collection<MigrationLogEntry>(COLLECTION_NAME);
    await collection.insertOne(entry as any);
    logger.info('Audit log entry recorded', {
      migrationId: entry.migrationId,
      outcome: entry.outcome,
      durationMs: entry.durationMs,
    });
  }

  /**
   * Get all successfully-applied migration IDs for quick lookup.
   */
  async getAppliedIds(): Promise<Set<string>> {
    const collection = this.db.collection<MigrationLogEntry>(COLLECTION_NAME);
    const entries = await collection
      .find({ outcome: 'success' }, { projection: { migrationId: 1 } })
      .toArray();
    return new Set(entries.map((e) => e.migrationId));
  }
}
