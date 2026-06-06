import * as fs from 'fs';
import * as path from 'path';
import { AppConfig } from './types';
import { logger } from './logger';

const CONFIG_RELATIVE_PATH = '../migrations/config.json';
const VALID_ENVIRONMENTS = ['dev', 'test', 'uat', 'prod'];

/**
 * Load and validate the config.json file.
 * Resolves path relative to the runner directory (one level up → migrations/).
 */
export function loadConfig(): AppConfig {
  const configPath = path.resolve(__dirname, '..', CONFIG_RELATIVE_PATH);
  logger.debug('Loading config', { path: configPath });

  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const raw = fs.readFileSync(configPath, 'utf-8');
  let config: AppConfig;

  try {
    config = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in config file: ${configPath}`);
  }

  // Validate structure
  if (!config.auditDatabase || typeof config.auditDatabase !== 'string') {
    throw new Error('config.json: "auditDatabase" must be a non-empty string');
  }

  if (!config.environments || typeof config.environments !== 'object') {
    throw new Error('config.json: "environments" must be an object');
  }

  for (const env of VALID_ENVIRONMENTS) {
    if (!config.environments[env]) {
      throw new Error(`config.json: missing environment "${env}"`);
    }
    if (!config.environments[env].databases || typeof config.environments[env].databases !== 'object') {
      throw new Error(`config.json: environment "${env}" must have a "databases" object`);
    }
  }

  return config;
}

/**
 * Validate that the target environment is recognized.
 */
export function validateEnvironment(env: string): void {
  if (!VALID_ENVIRONMENTS.includes(env)) {
    throw new Error(
      `Unknown environment "${env}". Valid environments: ${VALID_ENVIRONMENTS.join(', ')}`
    );
  }
}

/**
 * Get the MONGO_URI from environment variables.
 * Bitbucket deployment contexts inject the same var name with different values.
 */
export function getMongoUri(): string {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error(
      'MONGO_URI environment variable is not set. ' +
      'Ensure Bitbucket deployment variables are configured.'
    );
  }
  return uri;
}

/**
 * Get the base migrations directory path.
 */
export function getMigrationsDir(): string {
  return path.resolve(__dirname, '..', '..', 'migrations');
}

/**
 * Validate that a database name belongs to the specified environment.
 */
export function isDatabaseInEnvironment(config: AppConfig, env: string, dbName: string): boolean {
  const envConfig = config.environments[env];
  if (!envConfig) {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(envConfig.databases, dbName);
}

/**
 * Get all database names for an environment.
 */
export function getDatabasesForEnv(config: AppConfig, env: string): string[] {
  const envConfig = config.environments[env];
  if (!envConfig) {
    return [];
  }
  return Object.keys(envConfig.databases);
}

/**
 * Get pipeline context from CI environment variables.
 * Supports both Bitbucket Pipelines and GitHub Actions transparently —
 * whichever set of variables is present is used.
 */
export function getPipelineContext(): {
  buildNumber: string;
  commit: string;
  branch: string;
  triggeredBy: string;
  pipelineUuid: string;
  deploymentEnv: string;
} {
  // GitHub Actions is detected by GITHUB_ACTIONS=true
  if (process.env.GITHUB_ACTIONS === 'true') {
    return {
      buildNumber: process.env.GITHUB_RUN_NUMBER || 'local',
      commit: process.env.GITHUB_SHA || 'unknown',
      // For PRs use HEAD_REF (source branch); for push use REF_NAME
      branch: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || 'unknown',
      triggeredBy: process.env.GITHUB_ACTOR || 'local-user',
      pipelineUuid: process.env.GITHUB_RUN_ID || 'local',
      // MIGRATION_ENV is set explicitly by our workflows; fall back to job-level env name
      deploymentEnv:
        process.env.MIGRATION_ENV ||
        process.env.GITHUB_JOB ||
        'local',
    };
  }

  // Default: Bitbucket Pipelines
  return {
    buildNumber: process.env.BITBUCKET_BUILD_NUMBER || 'local',
    commit: process.env.BITBUCKET_COMMIT || 'unknown',
    branch: process.env.BITBUCKET_BRANCH || 'unknown',
    triggeredBy: process.env.BITBUCKET_STEP_TRIGGERER_UUID || 'local-user',
    pipelineUuid: process.env.BITBUCKET_PIPELINE_UUID || 'local',
    deploymentEnv: process.env.BITBUCKET_DEPLOYMENT_ENVIRONMENT || 'local',
  };
}
