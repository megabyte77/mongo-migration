import * as fs from 'fs';
import * as path from 'path';
import { DiscoveredMigration } from './types';
import { logger } from './logger';
import { getMigrationsDir } from './config';

/**
 * Filename pattern: YYYYMMDDHHMMSS_<description>.js
 * Strict validation: exactly 14-digit timestamp, underscore, then alphanumeric/underscore description.
 */
const FILENAME_PATTERN = /^(\d{14})_([a-z0-9_]+)\.js$/;

/**
 * Recursively scan the migrations/<env>/ directory and discover all migration files.
 * Returns them sorted by timestamp (ascending) for deterministic execution order.
 */
export function scanMigrations(env: string): DiscoveredMigration[] {
  const migrationsDir = getMigrationsDir();
  const envDir = path.join(migrationsDir, env);

  if (!fs.existsSync(envDir)) {
    logger.warn(`No migrations directory found for environment "${env}"`, { path: envDir });
    return [];
  }

  const discovered: DiscoveredMigration[] = [];

  // Iterate: migrations/<env>/<db>/<collection>/<file>.js
  const dbFolders = listDirectories(envDir);

  for (const dbFolder of dbFolders) {
    const dbPath = path.join(envDir, dbFolder);
    const collectionFolders = listDirectories(dbPath);

    for (const collectionFolder of collectionFolders) {
      const collectionPath = path.join(dbPath, collectionFolder);
      const files = listFiles(collectionPath, '.js');

      for (const file of files) {
        const match = FILENAME_PATTERN.exec(file);
        if (!match) {
          throw new Error(
            `Invalid migration filename: "${file}" in ${collectionPath}. ` +
            `Expected format: YYYYMMDDHHMMSS_description.js (lowercase alphanumeric and underscores only)`
          );
        }

        discovered.push({
          filePath: path.join(collectionPath, file),
          filename: file,
          timestamp: match[1],
          env,
          dbFolder,
          collectionFolder,
        });
      }
    }
  }

  // Sort by timestamp ascending — deterministic execution order
  discovered.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  logger.info(`Discovered ${discovered.length} migration(s) for env "${env}"`);

  return discovered;
}

/**
 * List immediate subdirectories of a path.
 */
function listDirectories(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/**
 * List files in a directory with a specific extension.
 */
function listFiles(dirPath: string, ext: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(ext))
    .map((d) => d.name)
    .sort();
}
