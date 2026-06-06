import { MongoClient } from 'mongodb';
import { AppConfig, MigrationLogEntry, RunnerOptions, MigrationHelpers } from './types';
import { loadConfig, validateEnvironment, getMongoUri, getPipelineContext } from './config';
import { scanMigrations } from './scanner';
import { validateMigration, validateTimestamp } from './validator';
import { computeChecksum, checksumsMatch } from './checksum';
import { AuditLog } from './auditLog';
import { createDryRunProxy } from './explainProxy';
import { batchUpdate, batchDelete } from './batchRunner';
import { logger } from './logger';

/**
 * Core migration runner.
 * Orchestrates: scan → validate → checksum → idempotency → execute → audit.
 */
export async function runMigrations(options: RunnerOptions): Promise<void> {
  const { env, dryRun, validateOnly } = options;

  logger.banner(
    dryRun
      ? `DRY-RUN — Environment: ${env.toUpperCase()}`
      : validateOnly
        ? `VALIDATE — Environment: ${env.toUpperCase()}`
        : `MIGRATE — Environment: ${env.toUpperCase()}`
  );

  // ── 1. Load config and validate environment ──
  const config = loadConfig();
  validateEnvironment(env);
  logger.info('Configuration loaded successfully');

  // ── 2. Scan for migration files ──
  const discovered = scanMigrations(env);
  if (discovered.length === 0) {
    logger.info('No migrations found. Nothing to do.');
    return;
  }

  // ── 3. Validate all files FIRST (fail-fast before any DB connection) ──
  logger.banner('Phase 1: Validation');
  const validatedMigrations = [];

  for (const disc of discovered) {
    validateTimestamp(disc.timestamp);
    const migration = validateMigration(disc, config, env);
    const checksum = computeChecksum(disc.filePath);

    validatedMigrations.push({
      discovered: disc,
      migration,
      checksum,
    });

    logger.info(`✓ ${disc.filename}`, {
      db: migration.db,
      collection: migration.collection,
    });
  }

  logger.info(`All ${validatedMigrations.length} migration(s) passed validation`);

  // If validate-only mode, stop here (no DB connection needed)
  if (validateOnly) {
    logger.banner('Validation Complete');
    logger.info('All migrations are valid. No database operations performed.');
    return;
  }

  // ── 4. Connect to MongoDB Atlas ──
  const mongoUri = getMongoUri();
  const client = new MongoClient(mongoUri, {
    connectTimeoutMS: 30000,
    serverSelectionTimeoutMS: 30000,
  });

  try {
    await client.connect();
    logger.info('Connected to MongoDB Atlas');

    // ── 5. Initialize audit log ──
    const auditLog = new AuditLog(client, config.auditDatabase);
    await auditLog.ensureIndexes();

    // ── 6. Process each migration ──
    logger.banner(dryRun ? 'Phase 2: Dry-Run Execution' : 'Phase 2: Migration Execution');

    const pipelineCtx = getPipelineContext();
    let applied = 0;
    let skipped = 0;
    let failed = 0;

    for (const { discovered: disc, migration, checksum } of validatedMigrations) {
      logger.separator();
      logger.info(`Processing: ${disc.filename}`);

      // ── 6a. Idempotency check ──
      const existingLog = await auditLog.findById(migration.id);

      if (existingLog) {
        // ── 6b. Tamper protection ──
        if (!checksumsMatch(existingLog.checksum, checksum)) {
          throw new Error(
            `TAMPER DETECTED — Migration "${disc.filename}" has been modified after being applied!\n` +
            `  Stored checksum:  ${existingLog.checksum}\n` +
            `  Current checksum: ${checksum}\n` +
            `  Migration files are immutable once applied. ` +
            `Create a new migration to make changes.`
          );
        }

        logger.info(` Skipped (already applied): ${disc.filename}`, {
          appliedAt: existingLog.appliedAt,
        });
        skipped++;
        continue;
      }

      // ── 6c. Execute migration ──
      const startedAt = new Date();

      try {
        // Get the actual database for this migration
        const targetDb = dryRun
          ? createDryRunProxy(client.db(migration.db))
          : client.db(migration.db);

        // Build helpers
        const helpers: MigrationHelpers = {
          batchUpdate,
          batchDelete,
        };

        logger.info(
          dryRun
            ? ` Dry-running: ${disc.filename}`
            : ` Applying: ${disc.filename}`
        );

        // Execute the up() function
        await migration.up(targetDb, helpers);

        const finishedAt = new Date();
        const durationMs = finishedAt.getTime() - startedAt.getTime();

        if (!dryRun) {
          // Record in audit log (skip for dry-run)
          const logEntry: MigrationLogEntry = {
            migrationId: migration.id,
            filename: disc.filename,
            db: migration.db,
            collection: migration.collection,
            checksum,
            environment: env,
            buildNumber: pipelineCtx.buildNumber,
            commit: pipelineCtx.commit,
            branch: pipelineCtx.branch,
            triggeredBy: pipelineCtx.triggeredBy,
            pipelineUuid: pipelineCtx.pipelineUuid,
            deploymentEnv: pipelineCtx.deploymentEnv,
            startedAt,
            finishedAt,
            durationMs,
            outcome: 'success',
            appliedAt: finishedAt,
          };

          await auditLog.insert(logEntry);
          logger.info(` Applied: ${disc.filename}`, { durationMs });
        } else {
          logger.info(` Dry-run complete: ${disc.filename}`, { durationMs });
        }

        applied++;
      } catch (err: any) {
        const finishedAt = new Date();
        const durationMs = finishedAt.getTime() - startedAt.getTime();

        if (!dryRun) {
          // Record failure in audit log
          const logEntry: MigrationLogEntry = {
            migrationId: migration.id,
            filename: disc.filename,
            db: migration.db,
            collection: migration.collection,
            checksum,
            environment: env,
            buildNumber: pipelineCtx.buildNumber,
            commit: pipelineCtx.commit,
            branch: pipelineCtx.branch,
            triggeredBy: pipelineCtx.triggeredBy,
            pipelineUuid: pipelineCtx.pipelineUuid,
            deploymentEnv: pipelineCtx.deploymentEnv,
            startedAt,
            finishedAt,
            durationMs,
            outcome: 'failed',
            error: err.message,
            appliedAt: finishedAt,
          };

          await auditLog.insert(logEntry);
        }

        failed++;
        throw new Error(
          `Migration "${disc.filename}" failed after ${durationMs}ms: ${err.message}`
        );
      }
    }

    // ── 7. Summary ──
    logger.banner('Summary');
    logger.info(`Environment: ${env.toUpperCase()}`);
    logger.info(`Mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}`);
    logger.info(`Total:   ${validatedMigrations.length}`);
    logger.info(`Applied: ${applied}`);
    logger.info(`Skipped: ${skipped}`);
    logger.info(`Failed:  ${failed}`);

  } finally {
    await client.close();
    logger.info('MongoDB connection closed');
  }
}
