import { Collection, Document } from 'mongodb';
import { BatchOptions, BatchResult } from './types';
import { logger } from './logger';

/**
 * Sleep utility for inter-batch delays.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Batched updateMany — processes documents in chunks to avoid MongoDB memory limits.
 *
 * Strategy:
 * 1. Fetch matching _id values in small batches (lean projection)
 * 2. Run updateMany against each batch of _ids
 * 3. Sleep between batches to avoid overwhelming the cluster
 * 4. Repeat until no more matching documents found
 *
 * This prevents the "exceeded memory limit" error that occurs with large
 * updateMany operations on Atlas.
 */
export async function batchUpdate(
  collection: Collection,
  opts: BatchOptions
): Promise<BatchResult> {
  const { filter, update, batchSize = 500, delayMs = 50 } = opts;

  if (!update) {
    throw new Error('batchUpdate requires an "update" option');
  }

  let totalMatched = 0;
  let totalModified = 0;
  let batchesProcessed = 0;

  logger.info('Starting batched update', {
    collection: collection.collectionName,
    batchSize,
    delayMs,
  });

  while (true) {
    // Fetch a batch of _ids matching the filter (lean projection)
    const docs = await collection
      .find(filter, { projection: { _id: 1 } })
      .limit(batchSize)
      .toArray();

    if (docs.length === 0) {
      break;
    }

    const ids = docs.map((d) => d._id);

    // Update this batch by _id — avoids re-scanning the entire collection
    const result = await collection.updateMany(
      { _id: { $in: ids } },
      update as Document
    );

    totalMatched += docs.length;
    totalModified += result.modifiedCount;
    batchesProcessed++;

    logger.debug(`Batch ${batchesProcessed} complete`, {
      matched: docs.length,
      modified: result.modifiedCount,
    });

    // If we got fewer than batchSize, we've processed all matching docs
    if (docs.length < batchSize) {
      break;
    }

    // Throttle to prevent overwhelming the cluster
    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  logger.info('Batched update complete', {
    collection: collection.collectionName,
    totalMatched,
    totalModified,
    batchesProcessed,
  });

  return { totalMatched, totalModified, totalDeleted: 0, batchesProcessed };
}

/**
 * Batched deleteMany — same chunking strategy as batchUpdate.
 */
export async function batchDelete(
  collection: Collection,
  opts: BatchOptions
): Promise<BatchResult> {
  const { filter, batchSize = 500, delayMs = 50 } = opts;

  let totalDeleted = 0;
  let batchesProcessed = 0;

  logger.info('Starting batched delete', {
    collection: collection.collectionName,
    batchSize,
    delayMs,
  });

  while (true) {
    const docs = await collection
      .find(filter, { projection: { _id: 1 } })
      .limit(batchSize)
      .toArray();

    if (docs.length === 0) {
      break;
    }

    const ids = docs.map((d) => d._id);

    const result = await collection.deleteMany({ _id: { $in: ids } });

    totalDeleted += result.deletedCount;
    batchesProcessed++;

    logger.debug(`Delete batch ${batchesProcessed} complete`, {
      deleted: result.deletedCount,
    });

    if (docs.length < batchSize) {
      break;
    }

    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  logger.info('Batched delete complete', {
    collection: collection.collectionName,
    totalDeleted,
    batchesProcessed,
  });

  return { totalMatched: 0, totalModified: 0, totalDeleted, batchesProcessed };
}
