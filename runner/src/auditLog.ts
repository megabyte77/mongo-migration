import { MongoClient, Db } from 'mongodb';
import { MigrationLogEntry } from './types';
import { logger } from './logger';

const COLLECTION_NAME = '_migration_log';

/**
 * Manages the audit log collection in the _migration_audit database.
 * Each Atlas cluster has its own audit database to keep logs co-located with data.
 */
export class AuditLog {
  private db: Db;

  constructor(client: MongoClient, auditDatabaseName: string) {
    this.db = client.db(auditDatabaseName);
  }

  /**
   * Ensure required indexes exist on _migration_log collection.
   * Called once at runner startup.
   */
  async ensureIndexes(): Promise<void> {
    const collection = this.db.collection(COLLECTION_NAME);
    await collection.createIndex(
      { migrationId: 1 },
      { unique: true, name: 'idx_migrationId_unique' }
    );
    logger.debug('Audit log indexes ensured', { collection: COLLECTION_NAME });
  }

  /**
   * Look up a migration by its ID.
   * Returns the log entry if found, null otherwise.
   */
  async findById(migrationId: string): Promise<MigrationLogEntry | null> {
    const collection = this.db.collection<MigrationLogEntry>(COLLECTION_NAME);
    const entry = await collection.findOne({ migrationId });
    return entry as MigrationLogEntry | null;
  }

  /**
   * Record a migration execution in the audit log.
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
   * Get all previously applied migration IDs for quick lookup.
   */
  async getAppliedIds(): Promise<Set<string>> {
    const collection = this.db.collection<MigrationLogEntry>(COLLECTION_NAME);
    const entries = await collection
      .find({}, { projection: { migrationId: 1, checksum: 1 } })
      .toArray();
    return new Set(entries.map((e) => e.migrationId));
  }
}
