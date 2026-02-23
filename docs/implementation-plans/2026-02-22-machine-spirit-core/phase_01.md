# Machine Spirit Core Implementation Plan - Phase 1: Project Scaffolding

**Goal:** Bun project initialised with TypeScript, dependencies, build configuration, database schema, and persistence layer.

**Architecture:** Ports-and-adapters pattern. Each domain concern defines a port interface in `types.ts`, with swappable adapter implementations. The persistence layer is the first adapter, connecting to PostgreSQL with pgvector for vector storage and semantic search.

**Tech Stack:** Bun 1.3.7, TypeScript (strict), PostgreSQL 17 + pgvector, Zod 4 for config validation, pg (node-postgres) for database access, @iarna/toml for TOML parsing

**Scope:** 8 phases from original design (this is phase 1 of 8)

**Codebase verified:** 2026-02-22. Greenfield project — only `docs/design-plans/2026-02-22-machine-spirit-core.md` exists. No source code, no package.json, no configuration files. Bun 1.3.7, Deno 2.6.9, Docker 29.1.5 all available on the system.

---

## Acceptance Criteria Coverage

This phase is infrastructure (project scaffolding). Verified operationally, not by tests.

**Verifies: None** — this is a scaffolding phase. Verification is operational: `bun install` succeeds, `bun run build` succeeds (type-check), `docker compose up` starts Postgres, migrations run and create tables with pgvector extension enabled.

---

<!-- START_TASK_1 -->
### Task 1: Initialise Bun project and configure TypeScript

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `bunfig.toml`
- Create: `.gitignore`

**Step 1: Create package.json**

```json
{
  "name": "constellation",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "bun run src/index.ts",
    "build": "tsc --noEmit",
    "test": "bun test",
    "migrate": "bun run src/persistence/migrate.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "@iarna/toml": "^2.2.5",
    "openai": "^4.80.0",
    "pg": "^8.13.0",
    "pgvector": "^0.2.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/pg": "^8.11.0",
    "typescript": "^5.7.0"
  }
}
```

Note: Use Zod 3.x (stable, widely supported by Bun). The design plan lists Zod generically. Zod 4 is available but 3.x is the safer choice for a new project with broad ecosystem compatibility. The executor should check current versions at implementation time and use the latest stable release of each package.

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "Preserve",
    "moduleDetection": "force",
    "allowJs": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noPropertyAccessFromIndexSignature": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "workspace"]
}
```

**Step 3: Create bunfig.toml**

```toml
[test]
preload = []
```

**Step 4: Create .gitignore**

```
node_modules/
*.log
.DS_Store
.env
workspace/
dist/
```

**Step 5: Verify operationally**

Run: `bun install`
Expected: Installs without errors, creates `bun.lockb`

Run: `bun run build`
Expected: Succeeds (no source files yet, but tsc runs without error)

**Step 6: Commit**

```bash
git add package.json tsconfig.json bunfig.toml .gitignore bun.lockb
git commit -m "chore: initialise bun project with typescript"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create application configuration with TOML + Zod validation

**Files:**
- Create: `config.toml`
- Create: `src/config/config.ts`

**Step 1: Create config.toml**

```toml
[agent]
max_tool_rounds = 20
max_code_size = 51200
max_output_size = 1048576
code_timeout = 60000
max_tool_calls_per_exec = 25
context_budget = 0.8

[model]
provider = "anthropic"
name = "claude-sonnet-4-5-20250514"

[embedding]
provider = "ollama"
model = "nomic-embed-text"
endpoint = "http://192.168.1.100:11434"
dimensions = 768

[database]
url = "postgresql://constellation:constellation@localhost:5432/constellation"

[runtime]
working_dir = "./workspace"
allowed_hosts = ["api.anthropic.com", "api.moonshot.ai"]
```

**Step 2: Create src/config/config.ts**

This module loads configuration from `config.toml` with environment variable overrides for secrets, then validates with Zod.

```typescript
import { z } from "zod";
import TOML from "@iarna/toml";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const AgentConfigSchema = z.object({
  max_tool_rounds: z.number().int().positive().default(20),
  max_code_size: z.number().int().positive().default(51200),
  max_output_size: z.number().int().positive().default(1048576),
  code_timeout: z.number().int().positive().default(60000),
  max_tool_calls_per_exec: z.number().int().positive().default(25),
  context_budget: z.number().min(0).max(1).default(0.8),
});

const ModelConfigSchema = z.object({
  provider: z.enum(["anthropic", "openai-compat"]),
  name: z.string(),
  api_key: z.string().optional(),
  base_url: z.string().url().optional(),
});

const EmbeddingConfigSchema = z.object({
  provider: z.enum(["openai", "ollama"]),
  model: z.string(),
  endpoint: z.string().url().optional(),
  dimensions: z.number().int().positive().default(768),
  api_key: z.string().optional(),
});

const DatabaseConfigSchema = z.object({
  url: z.string(),
});

const RuntimeConfigSchema = z.object({
  working_dir: z.string().default("./workspace"),
  allowed_hosts: z.array(z.string()).default([]),
});

const AppConfigSchema = z.object({
  agent: AgentConfigSchema.default({}),
  model: ModelConfigSchema,
  embedding: EmbeddingConfigSchema,
  database: DatabaseConfigSchema,
  runtime: RuntimeConfigSchema.default({}),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type EmbeddingConfig = z.infer<typeof EmbeddingConfigSchema>;
export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;
export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

export function loadConfig(configPath?: string): AppConfig {
  const resolvedPath = resolve(configPath ?? "config.toml");
  const raw = readFileSync(resolvedPath, "utf-8");
  const parsed = TOML.parse(raw);

  // Environment variable overrides for secrets
  const envOverrides: Record<string, unknown> = {};

  if (process.env.ANTHROPIC_API_KEY || process.env.OPENAI_COMPAT_API_KEY) {
    const model = (parsed.model as Record<string, unknown>) ?? {};
    model.api_key =
      process.env.ANTHROPIC_API_KEY ??
      process.env.OPENAI_COMPAT_API_KEY ??
      model.api_key;
    envOverrides.model = model;
  }

  if (process.env.EMBEDDING_API_KEY) {
    const embedding = (parsed.embedding as Record<string, unknown>) ?? {};
    embedding.api_key = process.env.EMBEDDING_API_KEY ?? embedding.api_key;
    envOverrides.embedding = embedding;
  }

  if (process.env.DATABASE_URL) {
    envOverrides.database = { url: process.env.DATABASE_URL };
  }

  const merged = { ...parsed, ...envOverrides };
  return AppConfigSchema.parse(merged);
}
```

**Step 3: Verify operationally**

Run: `bun run build`
Expected: Type-checks without errors

**Step 4: Commit**

```bash
git add config.toml src/config/config.ts
git commit -m "feat: add TOML config loading with Zod validation"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Create Docker Compose for PostgreSQL with pgvector

**Files:**
- Create: `docker-compose.yml`

**Step 1: Create docker-compose.yml**

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg17
    container_name: constellation-postgres
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: constellation
      POSTGRES_PASSWORD: constellation
      POSTGRES_DB: constellation
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U constellation"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
```

**Step 2: Verify operationally**

Run: `docker compose up -d`
Expected: PostgreSQL container starts, `docker compose ps` shows healthy status

Run: `docker compose down`
Expected: Container stops cleanly

**Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "chore: add docker-compose for pgvector postgres"
```
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Create database migration SQL files

**Files:**
- Create: `src/persistence/migrations/001_initial_schema.sql`

**Step 1: Create the initial schema migration**

This migration creates all tables needed by the memory system, conversation history, and pending mutations. It enables the pgvector extension and creates appropriate indexes.

```sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Memory blocks table (three-tier memory)
CREATE TABLE memory_blocks (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    tier TEXT NOT NULL CHECK (tier IN ('core', 'working', 'archival')),
    label TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    embedding vector,
    permission TEXT NOT NULL CHECK (permission IN ('readonly', 'familiar', 'append', 'readwrite')),
    pinned BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_memory_blocks_owner ON memory_blocks (owner);
CREATE INDEX idx_memory_blocks_tier ON memory_blocks (tier);
CREATE INDEX idx_memory_blocks_label ON memory_blocks (label);
CREATE INDEX idx_memory_blocks_owner_tier ON memory_blocks (owner, tier);

-- Memory events table (event sourcing)
CREATE TABLE memory_events (
    id TEXT PRIMARY KEY,
    block_id TEXT NOT NULL REFERENCES memory_blocks(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN ('create', 'update', 'delete', 'archive')),
    old_content TEXT,
    new_content TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_memory_events_block_id ON memory_events (block_id);
CREATE INDEX idx_memory_events_created_at ON memory_events (created_at);

-- Conversation messages table
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content TEXT NOT NULL,
    tool_calls JSONB,
    tool_call_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation_id ON messages (conversation_id);
CREATE INDEX idx_messages_created_at ON messages (created_at);
CREATE INDEX idx_messages_conversation_created ON messages (conversation_id, created_at);

-- Pending mutations table (familiar permission approval flow)
CREATE TABLE pending_mutations (
    id TEXT PRIMARY KEY,
    block_id TEXT NOT NULL REFERENCES memory_blocks(id) ON DELETE CASCADE,
    proposed_content TEXT NOT NULL,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    feedback TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_pending_mutations_block_id ON pending_mutations (block_id);
CREATE INDEX idx_pending_mutations_status ON pending_mutations (status);
```

**Step 2: Verify operationally**

The SQL file should parse correctly. We'll verify it runs in a later task when the migration runner is built.

**Step 3: Commit**

```bash
git add src/persistence/migrations/001_initial_schema.sql
git commit -m "feat: add initial database schema with pgvector"
```
<!-- END_TASK_4 -->

<!-- START_SUBCOMPONENT_A (tasks 5-7) -->
<!-- START_TASK_5 -->
### Task 5: Create PersistenceProvider port interface

**Files:**
- Create: `src/persistence/types.ts`

**Step 1: Create the persistence port**

This defines the interface that any persistence adapter must implement. The PostgreSQL adapter in the next task implements this port.

```typescript
export type QueryFunction = <T extends Record<string, unknown>>(
  sql: string,
  params?: ReadonlyArray<unknown>,
) => Promise<Array<T>>;

export type PersistenceProvider = {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  runMigrations(): Promise<void>;
  query: QueryFunction;
  withTransaction<T>(
    fn: (query: QueryFunction) => Promise<T>,
  ): Promise<T>;
};
```

Note: The port does NOT import `pg` types. It defines its own `QueryFunction` type for the transaction callback pattern. The PostgreSQL adapter wraps `Pool` and `PoolClient` internally but exposes only this abstract interface. This ensures any consumer of `PersistenceProvider` depends on the port, not on `pg`.

**Known gap — connection resilience:** This initial implementation does not include connection retry logic or automatic reconnection. The `pg` Pool handles basic connection pooling and will recreate connections as needed, but transient database outages will surface as errors to callers. If this becomes an issue, add exponential backoff retry logic to `connect()` and wrap `query()` calls with retry-on-connection-error in a future slice.

**Step 2: Verify operationally**

Run: `bun run build`
Expected: Type-checks without errors

**Step 3: Commit**

```bash
git add src/persistence/types.ts
git commit -m "feat: add PersistenceProvider port interface"
```
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Create PostgreSQL adapter with migration runner

**Files:**
- Create: `src/persistence/postgres.ts`

**Step 1: Create the PostgreSQL adapter**

This adapter implements the PersistenceProvider port, managing connection pooling, query execution, transactions, and running SQL migration files in order.

```typescript
import { Pool } from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import type { PersistenceProvider } from "./types.ts";
import type { DatabaseConfig } from "../config/config.ts";

export function createPostgresProvider(
  config: DatabaseConfig,
): PersistenceProvider {
  const pool = new Pool({ connectionString: config.url });

  async function connect(): Promise<void> {
    const client = await pool.connect();
    client.release();
  }

  async function disconnect(): Promise<void> {
    await pool.end();
  }

  async function runMigrations(): Promise<void> {
    const migrationsDir = resolve(
      import.meta.dir,
      "migrations",
    );
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          name TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      const applied = await client.query<{ name: string }>(
        "SELECT name FROM schema_migrations ORDER BY name",
      );
      const appliedSet = new Set(applied.rows.map((r) => r.name));

      for (const file of files) {
        if (appliedSet.has(file)) continue;

        const sql = readFileSync(join(migrationsDir, file), "utf-8");
        await client.query("BEGIN");
        try {
          await client.query(sql);
          await client.query(
            "INSERT INTO schema_migrations (name) VALUES ($1)",
            [file],
          );
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      }
    } finally {
      client.release();
    }
  }

  async function query<T extends Record<string, unknown>>(
    sql: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<Array<T>> {
    const result = await pool.query(sql, params as Array<unknown>);
    return result.rows as Array<T>;
  }

  async function withTransaction<T>(
    fn: (queryFn: typeof query) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect();
    const txQuery = async <R extends Record<string, unknown>>(
      sql: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<Array<R>> => {
      const result = await client.query(sql, params as Array<unknown>);
      return result.rows as Array<R>;
    };
    try {
      await client.query("BEGIN");
      const result = await fn(txQuery);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    connect,
    disconnect,
    runMigrations,
    query,
    withTransaction,
  };
}
```

**Step 2: Verify operationally**

Run: `bun run build`
Expected: Type-checks without errors

**Step 3: Commit**

```bash
git add src/persistence/postgres.ts
git commit -m "feat: add postgres adapter with migration runner"
```
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Create migration runner script and entry point placeholder

**Files:**
- Create: `src/persistence/migrate.ts`
- Create: `src/index.ts`

**Step 1: Create the standalone migration runner**

```typescript
import { loadConfig } from "../config/config.ts";
import { createPostgresProvider } from "./postgres.ts";

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createPostgresProvider(config.database);

  try {
    await db.connect();
    console.log("Connected to database");

    await db.runMigrations();
    console.log("Migrations complete");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await db.disconnect();
  }
}

main();
```

**Step 2: Create entry point placeholder**

```typescript
console.log("constellation daemon starting...");
```

**Step 3: Verify the full stack operationally**

Run: `bun run build`
Expected: Type-checks without errors

Run: `docker compose up -d`
Expected: PostgreSQL starts

Run: `bun run migrate`
Expected: Connects to database, runs migrations, creates tables. Output includes "Connected to database" and "Migrations complete".

Verify tables exist:
Run: `docker compose exec postgres psql -U constellation -c "\dt"`
Expected: Lists `schema_migrations`, `memory_blocks`, `memory_events`, `messages`, `pending_mutations` tables.

Verify pgvector extension:
Run: `docker compose exec postgres psql -U constellation -c "\dx"`
Expected: Lists `vector` extension.

Run: `docker compose down`
Expected: Container stops cleanly

**Step 4: Commit**

```bash
git add src/persistence/migrate.ts src/index.ts
git commit -m "feat: add migration runner and entry point placeholder"
```
<!-- END_TASK_7 -->
<!-- END_SUBCOMPONENT_A -->
