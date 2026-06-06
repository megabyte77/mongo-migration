import { Db, Collection, Document } from 'mongodb';

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

export interface MigrationHelpers {
  batchUpdate: (collection: Collection, opts: BatchOptions) => Promise<BatchResult>;
  batchDelete: (collection: Collection, opts: BatchOptions) => Promise<BatchResult>;
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
