# MongoDB Migration Pipeline

Production-grade MongoDB migration framework for Bitbucket Pipelines with tamper protection, dry-run support, batch processing, and comprehensive audit logging.

---

## Architecture

```
mongo-migration/
├── migrations/                    # Migration files organized by env/db/collection
│   ├── config.json                # Source-of-truth: registered DBs & collections
│   ├── dev/                       # DEV environment migrations
│   │   ├── dev_users/users/       # dev_users.users migrations
│   │   ├── dev_teams/teams/       # dev_teams.teams migrations
│   │   ├── dev/                   # dev DB migrations
│   │   ├── backup/                # backup DB migrations (dev cluster)
│   │   └── roles/                 # roles DB migrations (dev cluster)
│   ├── test/                      # TEST environment migrations
│   ├── uat/                       # UAT environment migrations
│   └── prod/                      # PROD environment migrations
├── runner/                        # TypeScript migration runner
│   ├── src/                       # Source files
│   └── dist/                      # Compiled output
├── cli/                           # Go CLI source
├── migrate                        # Pre-built Go binary (committed to repo)
├── bitbucket-pipelines.yml        # Pipeline configuration
└── README.md                      # This file
```

## Safety Guarantees

| Guarantee | Mechanism |
|-----------|-----------|
| **Tamper Protection** | SHA-256 checksum stored on first apply. Modified files cause hard errors. |
| **Forward-Only** | No `down()` function allowed. Rollback = new migration. |
| **Idempotency** | Migrations looked up by ID before running. Reruns are no-ops. |
| **Environment Isolation** | Folder structure `migrations/<env>/` prevents cross-env execution. |
| **Immutable Filenames** | `YYYYMMDDHHMMSS_` prefix ensures deterministic ordering. |
| **Dry-Run** | `.explain("executionStats")` against real Atlas without writes. |
| **Batch Processing** | Chunked updates/deletes to avoid MongoDB memory errors. |

---

## Quick Start

### 1. Create a Migration

Use the pre-built CLI binary at the repo root:

```bash
# For environment-specific DBs (env auto-detected)
./migrate --db=dev_users --collection=users --description="add email index"

# For shared DBs (backup, roles) — specify env explicitly
./migrate --env=dev --db=backup --collection=snapshots --description="add ttl field"

# List all registered databases
./migrate --list-dbs

# List collections for a database
./migrate --list-collections --db=dev_users
```

### 2. Write Your Migration

Edit the generated file's `up()` function:

```javascript
module.exports = {
  id: '20260604122828_add_email_index',
  description: 'add email index',
  db: 'dev_users',
  collection: 'users',

  async up(db, helpers) {
    // Plain operation
    await db.collection('users').createIndex(
      { email: 1 },
      { unique: true }
    );

    // OR batched operation (for large collections)
    await helpers.batchUpdate(db.collection('users'), {
      filter: { emailVerified: { $exists: false } },
      update: { $set: { emailVerified: false } },
      batchSize: 500,
      delayMs: 50,
    });
  }
};
```

### 3. Create Pull Request

The PR pipeline automatically:
1.  Checks JS syntax (`node --check`)
2.  Runs ESLint quality checks
3.  Validates schema, naming, and env guards
4.  Dry-runs against DEV Atlas (explain plans, no writes)

### 4. Deploy

After PR is merged, trigger a manual deployment from Bitbucket Pipelines UI:
- **Pipelines → Run pipeline → Custom → deploy-dev/test/uat/prod**

---

## Registering New Databases & Collections

Before creating migrations for a new DB or collection, add it to `migrations/config.json`:

```json
{
  "environments": {
    "dev": {
      "databases": {
        "dev_users": ["users", "profiles", "sessions"]
      }
    }
  }
}
```

---

## Bitbucket Setup

### Deployment Environment Variables

Configure these in **Repository Settings → Deployments**:

| Deployment | Variable | Value |
|------------|----------|-------|
| Development | `MONGO_URI` | `mongodb+srv://...dev-cluster...` |
| Testing | `MONGO_URI` | `mongodb+srv://...test-cluster...` |
| Staging (UAT) | `MONGO_URI` | `mongodb+srv://...uat-cluster...` |
| Production | `MONGO_URI` | `mongodb+srv://...prod-cluster...` |

### Available Pipelines

| Pipeline | Trigger | Purpose |
|----------|---------|---------|
| PR Validation | Automatic | Syntax + lint + schema + dry-run (DEV) |
| deploy-dev | Manual | Apply migrations to DEV |
| deploy-test | Manual | Apply migrations to TEST |
| deploy-uat | Manual | Apply migrations to UAT |
| deploy-prod | Manual | Apply migrations to PROD |
| dry-run-test | Manual | Dry-run explain plans for TEST |
| dry-run-uat | Manual | Dry-run explain plans for UAT |
| dry-run-prod | Manual | Dry-run explain plans for PROD |

---

## Audit Log

Each cluster contains a `_migration_audit` database with a `_migration_log` collection. Every migration execution is recorded with:

- `migrationId`, `filename`, `db`, `collection`
- `checksum` (SHA-256)
- `environment`, `buildNumber`, `commit`, `branch`, `triggeredBy`
- `startedAt`, `finishedAt`, `durationMs`
- `outcome` (success/failed/skipped)
- `error` (if failed)

---

## Migration Rules

1. **Files are immutable** once merged and applied. Never edit a deployed migration.
2. **No `down()` function**. To rollback, create a new forward migration.
3. **Filename = ID**. The `id` field must match the filename (without `.js`).
4. **DB/collection must match folders**. Case-sensitive.
5. **DB must belong to target environment** as defined in `config.json`.
6. **Use batch helpers** for operations affecting >1000 documents.

---

## Troubleshooting

### "TAMPER DETECTED" Error
A migration file was modified after being applied. Migration files are immutable. Create a new migration instead.

### "exceeded memory limit" Error
Use the batch helpers for large operations:
```javascript
await helpers.batchUpdate(db.collection('users'), {
  filter: { status: 'inactive' },
  update: { $set: { archived: true } },
  batchSize: 500,
  delayMs: 100,
});
```

### Migration Skipped
This is expected behavior — the migration was already applied. The runner is idempotent.

### DB Not Found in Environment
Ensure the database is registered in `migrations/config.json` under the correct environment.
