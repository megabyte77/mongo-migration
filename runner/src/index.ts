import { runMigrations } from './runner';
import { RunnerOptions } from './types';
import { logger } from './logger';

/**
 * Entry point for the migration runner CLI.
 *
 * Usage:
 *   node dist/index.js --env=dev                    # Apply migrations to dev
 *   node dist/index.js --env=dev --dry-run           # Dry-run with explain plans
 *   node dist/index.js --env=dev --validate          # Offline validation only
 */
function parseArgs(argv: string[]): RunnerOptions {
  let env = '';
  let dryRun = false;
  let validateOnly = false;

  for (const arg of argv) {
    if (arg.startsWith('--env=')) {
      env = arg.split('=')[1].toLowerCase().trim();
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--validate') {
      validateOnly = true;
    }
  }

  if (!env) {
    logger.error('Missing required argument: --env=<environment>');
    logger.info('Usage: node dist/index.js --env=<dev|test|uat|prod> [--dry-run] [--validate]');
    process.exit(1);
  }

  return { env, dryRun, validateOnly };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  try {
    await runMigrations(options);
    process.exit(0);
  } catch (err: any) {
    logger.error(`Fatal: ${err.message}`);
    process.exit(1);
  }
}

main();
