import * as path from 'path';
import { AppConfig, DiscoveredMigration, MigrationFile } from './types';
import { isDatabaseInEnvironment } from './config';
import { logger } from './logger';

/**
 * Load and validate a migration file. Performs all offline checks:
 * 1. Require/syntax check
 * 2. Schema validation (required fields + types)
 * 3. Forward-only guard (no `down` export)
 * 4. ID  filename match
 * 5. DB  folder match (case-sensitive)
 * 6. Collection  folder match (case-sensitive)
 * 7. Environment guard (DB belongs to target env)
 */
export function validateMigration(
  discovered: DiscoveredMigration,
  config: AppConfig,
  env: string
): MigrationFile {
  const { filePath, filename, dbFolder, collectionFolder } = discovered;
  const expectedId = filename.replace(/\.js$/, '');

  // ── 1. Require / syntax check ──
  let mod: Record<string, unknown>;
  try {
    // Clear require cache to ensure fresh load
    delete require.cache[require.resolve(filePath)];
    mod = require(filePath);
  } catch (err: any) {
    throw new Error(
      `Failed to load migration "${filename}": ${err.message}\n` +
      `  Path: ${filePath}`
    );
  }

  // ── 2. Schema validation ──
  const migration = mod as unknown as MigrationFile;

  if (!migration.id || typeof migration.id !== 'string') {
    throw new Error(
      `Migration "${filename}": missing or invalid "id" (must be a non-empty string)`
    );
  }

  if (!migration.description || typeof migration.description !== 'string') {
    throw new Error(
      `Migration "${filename}": missing or invalid "description" (must be a non-empty string)`
    );
  }

  if (!migration.db || typeof migration.db !== 'string') {
    throw new Error(
      `Migration "${filename}": missing or invalid "db" (must be a non-empty string)`
    );
  }

  if (!migration.collection || typeof migration.collection !== 'string') {
    throw new Error(
      `Migration "${filename}": missing or invalid "collection" (must be a non-empty string)`
    );
  }

  if (typeof migration.up !== 'function') {
    throw new Error(
      `Migration "${filename}": "up" must be an async function`
    );
  }

  // ── 3. Forward-only guard ──
  if ('down' in mod) {
    throw new Error(
      `Migration "${filename}": "down" function is not allowed. ` +
      `This framework is forward-only. To rollback, create a new migration.`
    );
  }

  // ── 4. ID  filename match ──
  if (migration.id !== expectedId) {
    throw new Error(
      `Migration "${filename}": id "${migration.id}" does not match filename. ` +
      `Expected id: "${expectedId}"`
    );
  }

  // ── 5. DB  folder match (case-sensitive) ──
  if (migration.db !== dbFolder) {
    throw new Error(
      `Migration "${filename}": db "${migration.db}" does not match folder name "${dbFolder}". ` +
      `The db field must exactly match the parent database folder (case-sensitive).`
    );
  }

  // ── 6. Collection  folder match (case-sensitive) ──
  if (migration.collection !== collectionFolder) {
    throw new Error(
      `Migration "${filename}": collection "${migration.collection}" does not match ` +
      `folder name "${collectionFolder}". ` +
      `The collection field must exactly match the parent collection folder (case-sensitive).`
    );
  }

  // ── 7. Environment guard ──
  if (!isDatabaseInEnvironment(config, env, migration.db)) {
    throw new Error(
      `Migration "${filename}": database "${migration.db}" is not registered ` +
      `under environment "${env}" in config.json. ` +
      `This migration cannot run in the "${env}" environment.`
    );
  }

  logger.debug(`Validated migration: ${filename}`, {
    id: migration.id,
    db: migration.db,
    collection: migration.collection,
  });

  return migration;
}

/**
 * Validate the timestamp portion of a migration filename.
 * Ensures it represents a valid date.
 */
export function validateTimestamp(timestamp: string): void {
  const year = parseInt(timestamp.substring(0, 4), 10);
  const month = parseInt(timestamp.substring(4, 6), 10);
  const day = parseInt(timestamp.substring(6, 8), 10);
  const hour = parseInt(timestamp.substring(8, 10), 10);
  const minute = parseInt(timestamp.substring(10, 12), 10);
  const second = parseInt(timestamp.substring(12, 14), 10);

  if (
    year < 2020 || year > 2099 ||
    month < 1 || month > 12 ||
    day < 1 || day > 31 ||
    hour < 0 || hour > 23 ||
    minute < 0 || minute > 59 ||
    second < 0 || second > 59
  ) {
    throw new Error(
      `Invalid timestamp in migration filename: "${timestamp}". ` +
      `Must be a valid YYYYMMDDHHMMSS date.`
    );
  }
}
