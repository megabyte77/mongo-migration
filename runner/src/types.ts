import {
  Db,
  Collection,
  Document,
  ObjectId,
  Long,
  Int32,
  Double,
  Decimal128,
  Binary,
  UUID,
  Timestamp,
  MinKey,
  MaxKey,
} from 'mongodb';

/* ──────────────────────────── Migration File Schema ──────────────────────────── */

export interface MigrationFile {
  id: string;
  description: string;
  db: string;
  collection: string;
  up: (db: Db, helpers: MigrationHelpers) => Promise<void>;
  down?: never; // forward-only — presence of `down` is a hard error
}

/* ──────────────────────────── Migration Helpers ──────────────────────────────── */

export interface BatchOptions {
  filter: Document;
  update?: Document;
  batchSize?: number;  // default 500
  delayMs?: number;    // default 50
}

export interface BatchResult {
  totalMatched: number;
  totalModified: number;
  totalDeleted: number;
  batchesProcessed: number;
}

/**
 * Helpers passed as the second argument to every migration's `up()` function.
 *
 * Includes:
 *  - batchUpdate / batchDelete — chunked operations to avoid Atlas memory limits
 *  - BSON types — so migrations never need to `require('mongodb')` themselves
 *
 * Usage in a migration:
 *   await db.collection('users').updateOne(
 *     { _id: new helpers.ObjectId('694cf12ab931b16d1444e6d6') },
 *     { $set: { name: 'new' } }
 *   );
 */
export interface MigrationHelpers {
  batchUpdate: (collection: Collection, opts: BatchOptions) => Promise<BatchResult>;
  batchDelete: (collection: Collection, opts: BatchOptions) => Promise<BatchResult>;

  // BSON types
  ObjectId: typeof ObjectId;
  Long: typeof Long;
  Int32: typeof Int32;
  Double: typeof Double;
  Decimal128: typeof Decimal128;
  Binary: typeof Binary;
  UUID: typeof UUID;
  Timestamp: typeof Timestamp;
  MinKey: typeof MinKey;
  MaxKey: typeof MaxKey;
}

/* ──────────────────────────── Audit Log Entry ────────────────────────────────── */

export interface MigrationLogEntry {
  migrationId: string;
  filename: string;
  db: string;
  collection: string;
  checksum: string;
  environment: string;

  // Pipeline context
  buildNumber: string;
  commit: string;
  branch: string;
  triggeredBy: string;
  pipelineUuid: string;
  deploymentEnv: string;

  // Timing
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;

  // Outcome
  outcome: 'success' | 'failed' | 'skipped';
  error?: string;

  // Metadata
  appliedAt: Date;
}

/* ──────────────────────────── Config Schema ──────────────────────────────────── */

export interface EnvironmentConfig {
  databases: Record<string, string[]>; // dbName → collection[]
}

export interface AppConfig {
  auditDatabase: string;
  environments: Record<string, EnvironmentConfig>;
}

/* ──────────────────────────── Discovered Migration ────────────────────────────── */

export interface DiscoveredMigration {
  filePath: string;
  filename: string;
  timestamp: string;
  env: string;
  dbFolder: string;
  collectionFolder: string;
}

/* ──────────────────────────── Runner Options ─────────────────────────────────── */

export interface RunnerOptions {
  env: string;
  dryRun: boolean;
  validateOnly: boolean;
}
