package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// ────────────────────────── Config Schema ──────────────────────────

type EnvironmentConfig struct {
	Databases map[string][]string `json:"databases"`
}

type AppConfig struct {
	AuditDatabase string                       `json:"auditDatabase"`
	Environments  map[string]EnvironmentConfig `json:"environments"`
}

// ────────────────────────── Constants ──────────────────────────────

const (
	configRelativePath = "migrations/config.json"
	migrationsDir      = "migrations"
	version            = "1.0.0"
)

var sanitizeRegex = regexp.MustCompile(`[^a-z0-9_]`)

// ────────────────────────── Main ──────────────────────────────────

func main() {
	// Define flags
	dbFlag := flag.String("db", "", "Exact database name (e.g., dev_users)")
	collectionFlag := flag.String("collection", "", "Collection name (e.g., users)")
	descriptionFlag := flag.String("description", "", "Short description for the migration")
	envFlag := flag.String("env", "", "Target environment (required if DB exists in multiple envs)")
	listDBsFlag := flag.Bool("list-dbs", false, "List all registered databases")
	listCollectionsFlag := flag.Bool("list-collections", false, "List collections for a given --db")
	versionFlag := flag.Bool("version", false, "Show CLI version")

	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, `mongo-migration CLI v%s

Generate timestamped migration files for MongoDB schema changes.

USAGE:
  ./migrate --db=<database> --collection=<collection> --description="<description>" [--env=<env>]
  ./migrate --list-dbs
  ./migrate --list-collections --db=<database>

FLAGS:
`, version)
		flag.PrintDefaults()
		fmt.Fprintf(os.Stderr, `
EXAMPLES:
  # Create migration for a unique DB (env auto-detected)
  ./migrate --db=dev_users --collection=users --description="add email index"

  # Create migration for a shared DB (env required)
  ./migrate --env=dev --db=backup --collection=snapshots --description="add ttl field"

  # List all databases
  ./migrate --list-dbs

  # List collections for a database
  ./migrate --list-collections --db=dev_users
`)
	}

	flag.Parse()

	// ── Version ──
	if *versionFlag {
		fmt.Printf("mongo-migration CLI v%s\n", version)
		os.Exit(0)
	}

	// ── Load config ──
	config, err := loadConfig()
	if err != nil {
		fatalf("Failed to load config: %v", err)
	}

	// ── List DBs ──
	if *listDBsFlag {
		listDatabases(config)
		os.Exit(0)
	}

	// ── List Collections ──
	if *listCollectionsFlag {
		if *dbFlag == "" {
			fatalf("--db is required with --list-collections")
		}
		listCollections(config, *dbFlag)
		os.Exit(0)
	}

	// ── Create Migration ──
	if *dbFlag == "" || *collectionFlag == "" || *descriptionFlag == "" {
		fmt.Fprintln(os.Stderr, "Error: --db, --collection, and --description are all required")
		fmt.Fprintln(os.Stderr, "Run ./migrate --help for usage information")
		os.Exit(1)
	}

	createMigration(config, *dbFlag, *collectionFlag, *descriptionFlag, *envFlag)
}

// ────────────────────────── Config Loading ─────────────────────────

func loadConfig() (*AppConfig, error) {
	// Look for config relative to current working directory
	cwd, err := os.Getwd()
	if err != nil {
		return nil, fmt.Errorf("cannot determine working directory: %w", err)
	}

	configPath := filepath.Join(cwd, configRelativePath)

	// Security: verify the config path is within the expected directory
	absConfigPath, err := filepath.Abs(configPath)
	if err != nil {
		return nil, fmt.Errorf("cannot resolve config path: %w", err)
	}

	absCwd, err := filepath.Abs(cwd)
	if err != nil {
		return nil, fmt.Errorf("cannot resolve working directory: %w", err)
	}

	if !strings.HasPrefix(absConfigPath, absCwd) {
		return nil, fmt.Errorf("config path escapes working directory (security violation)")
	}

	data, err := os.ReadFile(absConfigPath)
	if err != nil {
		return nil, fmt.Errorf("cannot read config file at %s: %w", absConfigPath, err)
	}

	var config AppConfig
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("invalid JSON in config file: %w", err)
	}

	if config.AuditDatabase == "" {
		return nil, fmt.Errorf("config.json: 'auditDatabase' is required")
	}

	if len(config.Environments) == 0 {
		return nil, fmt.Errorf("config.json: 'environments' is empty")
	}

	return &config, nil
}

// ────────────────────────── List Commands ──────────────────────────

func listDatabases(config *AppConfig) {
	fmt.Println("Registered databases:")
	fmt.Println()

	for envName, envConfig := range config.Environments {
		fmt.Printf("  [%s]\n", strings.ToUpper(envName))
		for dbName, collections := range envConfig.Databases {
			collStr := "  (no collections registered)"
			if len(collections) > 0 {
				collStr = fmt.Sprintf("  → %s", strings.Join(collections, ", "))
			}
			fmt.Printf("    %-20s%s\n", dbName, collStr)
		}
		fmt.Println()
	}
}

func listCollections(config *AppConfig, db string) {
	found := false

	for envName, envConfig := range config.Environments {
		collections, exists := envConfig.Databases[db]
		if !exists {
			continue
		}

		found = true
		fmt.Printf("[%s] %s:\n", strings.ToUpper(envName), db)

		if len(collections) == 0 {
			fmt.Println("  (no collections registered)")
		} else {
			for _, c := range collections {
				fmt.Printf("  - %s\n", c)
			}
		}
		fmt.Println()
	}

	if !found {
		fatalf("Database %q is not registered in config.json", db)
	}
}

// ────────────────────────── Migration Creation ─────────────────────

func createMigration(config *AppConfig, db, collection, description, envOverride string) {
	// ── 1. Resolve environment ──
	env := resolveEnvironment(config, db, envOverride)

	// ── 2. Validate collection exists in config (strict — no auto-creation) ──
	envConfig := config.Environments[env]
	collections, dbExists := envConfig.Databases[db]
	if !dbExists {
		fatalf("Database %q is not registered under environment %q in config.json", db, env)
	}

	if len(collections) == 0 {
		fatalf(
			"Database %q (env: %s) has no registered collections in config.json.\n"+
				"Add the collection to config.json before creating a migration.",
			db, env,
		)
	}

	if !contains(collections, collection) {
		fatalf(
			"Collection %q is not registered under database %q (env: %s) in config.json.\n"+
				"Registered collections: %s\n"+
				"Add it to config.json first if this is a new collection.",
			collection, db, env, strings.Join(collections, ", "),
		)
	}

	// ── 3. Build file path ──
	cwd, _ := os.Getwd()
	targetDir := filepath.Join(cwd, migrationsDir, env, db, collection)

	// Security: ensure target is within migrations directory
	absMigrationsDir, _ := filepath.Abs(filepath.Join(cwd, migrationsDir))
	absTargetDir, _ := filepath.Abs(targetDir)

	if !strings.HasPrefix(absTargetDir, absMigrationsDir) {
		fatalf("Target path escapes migrations directory (security violation)")
	}

	// ── 4. Generate timestamp and filename ──
	now := time.Now().UTC()
	timestamp := now.Format("20060102150405")
	sanitizedDesc := sanitizeDescription(description)

	if sanitizedDesc == "" {
		fatalf("Description must contain at least one alphanumeric character")
	}

	filename := fmt.Sprintf("%s_%s.js", timestamp, sanitizedDesc)
	migrationID := fmt.Sprintf("%s_%s", timestamp, sanitizedDesc)
	filePath := filepath.Join(targetDir, filename)

	// ── 5. Check for duplicate filename ──
	if _, err := os.Stat(filePath); err == nil {
		fatalf("File already exists: %s", filePath)
	}

	// ── 6. Create directory structure ──
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		fatalf("Failed to create directory %s: %v", targetDir, err)
	}

	// ── 7. Generate file content ──
	content := generateMigrationContent(migrationID, description, env, db, collection, now)

	// ── 8. Write file ──
	if err := os.WriteFile(filePath, []byte(content), 0o644); err != nil {
		fatalf("Failed to write file %s: %v", filePath, err)
	}

	// ── 9. Output ──
	relPath, _ := filepath.Rel(cwd, filePath)
	fmt.Println()
	fmt.Println(" Migration created successfully")
	fmt.Println()
	fmt.Printf("  File:        %s\n", relPath)
	fmt.Printf("  ID:          %s\n", migrationID)
	fmt.Printf("  Database:    %s\n", db)
	fmt.Printf("  Collection:  %s\n", collection)
	fmt.Printf("  Environment: %s\n", env)
	fmt.Printf("  Generated:   %s UTC\n", now.Format("2006-01-02 15:04:05"))
	fmt.Println()
	fmt.Println("  Edit the up() function to add your migration logic.")
	fmt.Println()
}

// ────────────────────────── Helpers ────────────────────────────────

// resolveEnvironment determines which environment a DB belongs to.
// If the DB exists in multiple envs, --env is required.
func resolveEnvironment(config *AppConfig, db, envOverride string) string {
	matchingEnvs := []string{}

	for envName, envConfig := range config.Environments {
		if _, exists := envConfig.Databases[db]; exists {
			matchingEnvs = append(matchingEnvs, envName)
		}
	}

	if len(matchingEnvs) == 0 {
		fatalf(
			"Database %q is not registered in config.json under any environment.\n"+
				"Run ./migrate --list-dbs to see all registered databases.",
			db,
		)
	}

	if envOverride != "" {
		envOverride = strings.ToLower(envOverride)
		if !contains(matchingEnvs, envOverride) {
			fatalf(
				"Database %q is not registered under environment %q.\n"+
					"It exists in: %s",
				db, envOverride, strings.Join(matchingEnvs, ", "),
			)
		}
		return envOverride
	}

	if len(matchingEnvs) == 1 {
		return matchingEnvs[0]
	}

	// Ambiguous — require --env
	fatalf(
		"Database %q exists in multiple environments: %s\n"+
			"Use --env=<env> to specify which environment.\n"+
			"Example: ./migrate --env=%s --db=%s --collection=<collection> --description=\"...\"",
		db, strings.Join(matchingEnvs, ", "), matchingEnvs[0], db,
	)
	return "" // unreachable
}

// sanitizeDescription converts a human description to a valid filename component.
func sanitizeDescription(desc string) string {
	lower := strings.ToLower(strings.TrimSpace(desc))
	// Replace spaces and hyphens with underscores
	lower = strings.ReplaceAll(lower, " ", "_")
	lower = strings.ReplaceAll(lower, "-", "_")
	// Remove any non-alphanumeric/underscore characters
	lower = sanitizeRegex.ReplaceAllString(lower, "")
	// Collapse multiple underscores
	for strings.Contains(lower, "__") {
		lower = strings.ReplaceAll(lower, "__", "_")
	}
	// Trim leading/trailing underscores
	lower = strings.Trim(lower, "_")
	return lower
}

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

func fatalf(format string, args ...interface{}) {
	fmt.Fprintf(os.Stderr, "Error: "+format+"\n", args...)
	os.Exit(1)
}

// ────────────────────────── Template ───────────────────────────────

// generateMigrationContent renders the migration boilerplate. Uses explicit
// named placeholders + strings.NewReplacer for deterministic, order-independent
// substitution (safer than positional fmt.Sprintf with many args).
func generateMigrationContent(id, description, env, db, collection string, ts time.Time) string {
	const tmpl = `// migrations/{{ENV}}/{{DB}}/{{COLLECTION}}/{{ID}}.js
// {{DESCRIPTION}}
//
// Generated : {{TIMESTAMP}} UTC
// ID        : {{ID}}

module.exports = {
  id: '{{ID}}',
  description: '{{DESCRIPTION_ESCAPED}}',
  db: '{{DB}}',
  collection: '{{COLLECTION}}',

  async up(db, helpers) {
    // TODO: write your migration here.
    //
    // ── Option A: Plain operation (small collections) ──
    //   await db.collection('{{COLLECTION}}').updateOne(
    //     { /* filter */ },
    //     { $set: { /* fields */ } }
    //   );
    //
    // ── Option B: Batched operation (large collections — avoids 'exceeded memory limit') ──
    //   await helpers.batchUpdate(db.collection('{{COLLECTION}}'), {
    //     filter: { /* match docs */ },
    //     update: { $set: { /* fields */ } },
    //     batchSize: 500,
    //     delayMs: 50,
    //   });
    //
    // ── Option C: Import the batch runner directly ──
    //   const { batchUpdate } = require('{{RUNNER_PATH}}');
    //   await batchUpdate(db.collection('{{COLLECTION}}'), {
    //     filter: { /* match docs */ },
    //     update: { $set: { /* fields */ } },
    //     batchSize: 500,
    //     delayMs: 50,
    //   });
  }
};
`

	replacer := strings.NewReplacer(
		"{{ENV}}", env,
		"{{DB}}", db,
		"{{COLLECTION}}", collection,
		"{{ID}}", id,
		"{{DESCRIPTION}}", description,
		"{{DESCRIPTION_ESCAPED}}", escapeSingleQuotes(description),
		"{{TIMESTAMP}}", ts.Format("2006-01-02 15:04:05"),
		"{{RUNNER_PATH}}", "../../../../runner/dist/batchRunner",
	)

	return replacer.Replace(tmpl)
}

func escapeSingleQuotes(s string) string {
	return strings.ReplaceAll(s, "'", "\\'")
}
