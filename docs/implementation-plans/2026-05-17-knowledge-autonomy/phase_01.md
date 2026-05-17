# Knowledge Autonomy Implementation Plan — Phase 1: Secrets Management

**Goal:** PostgreSQL-backed secret store with merged resolver, agent tools, and Deno sandbox injection

**Architecture:** Port/adapter pattern with `SecretStore` port, `PostgresSecretStore` adapter, `SecretResolver` factory merging config + stored secrets, and three agent tools. Secrets are injected into the Deno sandbox as TypeScript const declarations (not environment variables — Deno runs with `--deny-env`).

**Tech Stack:** TypeScript 5.7+, PostgreSQL 17, Zod, Bun

**Scope:** 7 phases from original design (phase 1 of 7)

**Codebase verified:** 2026-05-17

---

## Acceptance Criteria Coverage

This phase implements and tests:

### knowledge-autonomy.AC1: Secrets Management
- **knowledge-autonomy.AC1.1 Success:** Agent stores a secret via `secret_set` and it persists in PostgreSQL
- **knowledge-autonomy.AC1.2 Success:** Agent lists secret key names via `secret_list` without exposing values
- **knowledge-autonomy.AC1.3 Success:** Agent deletes a secret via `secret_delete` and it is removed from store
- **knowledge-autonomy.AC1.4 Success:** Secrets are injected as environment variables into Deno sandbox execution
- **knowledge-autonomy.AC1.5 Success:** Config secrets (env vars) take precedence over agent-stored secrets with the same key
- **knowledge-autonomy.AC1.6 Failure:** Secret tools are not registered when `secrets.agent_managed = false`
- **knowledge-autonomy.AC1.7 Failure:** Secret values never appear in tool output or conversation context

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Database migration for secrets table

**Files:**
- Create: `src/persistence/migrations/011_secrets_schema.sql`

**Implementation:**

Create the migration file with the following SQL:

```sql
-- Secrets table for agent-managed API keys and credentials

CREATE TABLE IF NOT EXISTS secrets (
    owner TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (owner, key)
);

CREATE INDEX IF NOT EXISTS idx_secrets_owner
    ON secrets (owner);
```

Design notes:
- Composite primary key `(owner, key)` enforces one value per key per owner (matches the owner-scoped pattern used in `scheduled_tasks`, `interests`, etc.)
- `value` stored as plain TEXT — encryption at rest is a future concern, explicitly out of scope
- No separate `id` column needed since `(owner, key)` is the natural key
- `updated_at` supports upsert semantics (store-or-update on same key)

**Verification:**

Run: `bun run migrate`
Expected: Migration applies without errors

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(secrets): add database migration for secrets table`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Config schema extension for secrets section

**Files:**
- Modify: `src/config/schema.ts` (add `SecretsConfigSchema` before `AppConfigSchema` at line ~247, add `secrets` field to `AppConfigSchema`)
- Modify: `src/config/schema.ts` (add `SecretsConfig` type export after line ~265)

**Implementation:**

Add the `SecretsConfigSchema` definition before `AppConfigSchema`:

```typescript
const SecretsConfigSchema = z.object({
  agent_managed: z.boolean().default(false),
});
```

Add `secrets` as an optional field in `AppConfigSchema`:

```typescript
secrets: SecretsConfigSchema.optional(),
```

Add the type export alongside the other config type exports:

```typescript
export type SecretsConfig = z.infer<typeof SecretsConfigSchema>;
```

Also export `SecretsConfigSchema` for tests.

**Verification:**

Run: `bun run build`
Expected: Type-check passes. `config.secrets?.agent_managed` is typed as `boolean | undefined`.

**Commit:** `feat(secrets): add secrets config schema with agent_managed flag`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->

<!-- START_TASK_3 -->
### Task 3: SecretStore port and PostgresSecretStore adapter

**Files:**
- Create: `src/secrets/types.ts`
- Create: `src/secrets/postgres-store.ts`
- Create: `src/secrets/index.ts`

**Implementation:**

`src/secrets/types.ts` — Port interface (Functional Core):

```typescript
// pattern: Functional Core

export type SecretStore = {
  get(owner: string, key: string): Promise<string | null>;
  set(owner: string, key: string, value: string): Promise<void>;
  delete(owner: string, key: string): Promise<boolean>;
  listKeys(owner: string): Promise<ReadonlyArray<string>>;
};
```

`src/secrets/postgres-store.ts` — Adapter (Imperative Shell):

```typescript
// pattern: Imperative Shell

import type { PersistenceProvider } from '@/persistence/types.js';
import type { SecretStore } from './types.js';

export function createPostgresSecretStore(persistence: PersistenceProvider): SecretStore {
  return {
    async get(owner, key) {
      const rows = await persistence.query<{ value: string }>(
        'SELECT value FROM secrets WHERE owner = $1 AND key = $2',
        [owner, key],
      );
      return rows[0]?.value ?? null;
    },

    async set(owner, key, value) {
      await persistence.query(
        `INSERT INTO secrets (owner, key, value, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (owner, key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [owner, key, value],
      );
    },

    async delete(owner, key) {
      const rows = await persistence.query(
        'DELETE FROM secrets WHERE owner = $1 AND key = $2 RETURNING key',
        [owner, key],
      );
      return rows.length > 0;
    },

    async listKeys(owner) {
      const rows = await persistence.query<{ key: string }>(
        'SELECT key FROM secrets WHERE owner = $1 ORDER BY key',
        [owner],
      );
      return rows.map(r => r.key);
    },
  };
}
```

`src/secrets/index.ts` — Barrel exports (resolver exports added in Task 4):

```typescript
export type { SecretStore } from './types.js';
export { createPostgresSecretStore } from './postgres-store.js';
```

**Verification:**

Run: `bun run build`
Expected: Type-check passes (may need to defer resolver export until Task 4)

**Commit:** `feat(secrets): add SecretStore port and PostgresSecretStore adapter`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: SecretResolver factory

**Files:**
- Create: `src/secrets/resolver.ts`
- Modify: `src/secrets/index.ts` (add resolver exports that were deferred from Task 3)

**Implementation:**

`src/secrets/resolver.ts` — Factory merging config and stored secrets (Imperative Shell):

```typescript
// pattern: Imperative Shell

import type { SecretStore } from './types.js';

export type SecretResolver = {
  resolve(keys: ReadonlyArray<string>): Promise<Record<string, string>>;
  listKeys(): Promise<ReadonlyArray<string>>;
};

type SecretResolverOptions = {
  readonly store: SecretStore;
  readonly owner: string;
  readonly configSecrets: Readonly<Record<string, string>>;
};

export function createSecretResolver(options: SecretResolverOptions): SecretResolver {
  const { store, owner, configSecrets } = options;

  return {
    async resolve(keys) {
      const result: Record<string, string> = {};
      for (const key of keys) {
        if (key in configSecrets) {
          result[key] = configSecrets[key]!;
          continue;
        }
        const stored = await store.get(owner, key);
        if (stored !== null) {
          result[key] = stored;
        }
      }
      return result;
    },

    async listKeys() {
      const storedKeys = await store.listKeys(owner);
      const configKeys = Object.keys(configSecrets);
      const allKeys = new Set([...configKeys, ...storedKeys]);
      return [...allKeys].sort();
    },
  };
}
```

Design notes:
- Config secrets take precedence: if a key exists in both `configSecrets` and the store, the config value wins (AC1.5)
- `configSecrets` is built from environment variables in the composition root (ANTHROPIC_API_KEY, BRAVE_API_KEY, etc.)
- `listKeys()` merges both sources for the agent to see all available keys
- `resolve()` takes an explicit list of keys to resolve, not "all" — prevents unnecessary DB queries

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(secrets): add SecretResolver merging config and stored secrets`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: SecretStore and SecretResolver tests

**Verifies:** knowledge-autonomy.AC1.1, knowledge-autonomy.AC1.3, knowledge-autonomy.AC1.5

**Files:**
- Create: `src/secrets/postgres-store.test.ts`
- Create: `src/secrets/resolver.test.ts`

**Testing:**

`postgres-store.test.ts` — Tests against real PostgreSQL (following the project's database test pattern):

Tests must verify:
- knowledge-autonomy.AC1.1: `set()` persists a secret and `get()` retrieves it
- knowledge-autonomy.AC1.1: `set()` on an existing key updates the value (upsert)
- knowledge-autonomy.AC1.3: `delete()` removes a secret and returns `true`; subsequent `get()` returns `null`
- `delete()` on non-existent key returns `false`
- `listKeys()` returns all keys for owner, sorted alphabetically
- `listKeys()` returns empty array for owner with no secrets
- Owner isolation: secrets from owner A are not visible to owner B

Test setup pattern (following `src/activity/postgres-activity-manager.test.ts`):
- `beforeAll`: connect persistence, run migrations
- Generate unique `TEST_OWNER` per test run: `'test-secrets-' + Math.random().toString(36).substring(7)`
- `afterAll`: delete test data with `DELETE FROM secrets WHERE owner = $1`, disconnect

`resolver.test.ts` — Unit tests with mock SecretStore (Functional Core):

Tests must verify:
- knowledge-autonomy.AC1.5: `resolve()` returns config secret when same key exists in both config and store
- `resolve()` falls back to store when key not in config
- `resolve()` skips keys not found in either source
- `listKeys()` returns merged, deduplicated, sorted keys from both sources

Mock the SecretStore with simple in-memory implementation:
```typescript
function createMockSecretStore(data: Record<string, string>): SecretStore {
  return {
    async get(_owner, key) { return data[key] ?? null; },
    async set(_owner, key, value) { data[key] = value; },
    async delete(_owner, key) { const had = key in data; delete data[key]; return had; },
    async listKeys(_owner) { return Object.keys(data).sort(); },
  };
}
```

**Verification:**

Run: `bun test src/secrets/`
Expected: All tests pass

**Commit:** `test(secrets): add SecretStore and SecretResolver tests`

<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 6-8) -->

<!-- START_TASK_6 -->
### Task 6: Secret agent tools (secret_set, secret_list, secret_delete)

**Files:**
- Create: `src/tool/builtin/secrets.ts`

**Implementation:**

Follow the existing tool pattern from `src/tool/builtin/memory.ts` and `src/tool/builtin/code.ts`.

```typescript
// pattern: Imperative Shell

import type { Tool } from '../types.js';
import type { SecretStore } from '@/secrets/types.js';

type SecretToolDeps = {
  readonly store: SecretStore;
  readonly owner: string;
};

export function createSecretTools(deps: SecretToolDeps): ReadonlyArray<Tool> {
  const { store, owner } = deps;

  const secretSet: Tool = {
    definition: {
      name: 'secret_set',
      description: 'Store an API key or credential securely. The value is persisted and available for sandbox code execution. Values are never returned in tool output.',
      parameters: [
        { name: 'key', type: 'string', description: 'Secret name (e.g., MY_API_KEY)', required: true },
        { name: 'value', type: 'string', description: 'Secret value', required: true },
      ],
    },
    handler: async (params) => {
      const key = params['key'] as string;
      const value = params['value'] as string;
      await store.set(owner, key, value);
      return { success: true, output: `Secret "${key}" stored successfully.` };
    },
  };

  const secretList: Tool = {
    definition: {
      name: 'secret_list',
      description: 'List all stored secret key names. Values are never exposed.',
      parameters: [],
    },
    handler: async () => {
      const keys = await store.listKeys(owner);
      if (keys.length === 0) {
        return { success: true, output: 'No secrets stored.' };
      }
      return { success: true, output: `Stored secrets:\n${keys.map(k => `  - ${k}`).join('\n')}` };
    },
  };

  const secretDelete: Tool = {
    definition: {
      name: 'secret_delete',
      description: 'Delete a stored secret by key name.',
      parameters: [
        { name: 'key', type: 'string', description: 'Secret name to delete', required: true },
      ],
    },
    handler: async (params) => {
      const key = params['key'] as string;
      const deleted = await store.delete(owner, key);
      if (!deleted) {
        return { success: false, output: '', error: `Secret "${key}" not found.` };
      }
      return { success: true, output: `Secret "${key}" deleted.` };
    },
  };

  return [secretSet, secretList, secretDelete];
}
```

Key design decisions:
- `secret_set` handler NEVER includes the value in its output (AC1.7)
- `secret_list` returns key names only (AC1.2, AC1.7)
- Tools take `owner` from the composition root, not from the agent — the agent cannot set secrets for other owners
- Returns `ReadonlyArray<Tool>` following the `createMemoryTools` pattern

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(secrets): add secret_set, secret_list, secret_delete tools`

<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Extend ExecutionContext with secrets and update executor

**Files:**
- Modify: `src/runtime/types.ts` (add `secrets` field to `ExecutionContext` at line ~26)
- Modify: `src/runtime/executor.ts` (add `generateSecretConstants` function, integrate into `combinedScript` at line ~111)

**Implementation:**

In `src/runtime/types.ts`, add a `secrets` field to `ExecutionContext`:

```typescript
export type ExecutionContext = {
  readonly bluesky?: {
    readonly service: string;
    readonly pdsUrl: string;
    readonly accessToken: string;
    readonly refreshToken: string;
    readonly did: string;
    readonly handle: string;
  };
  readonly secrets?: Readonly<Record<string, string>>;
};
```

In `src/runtime/executor.ts`, add a new pure function alongside `generateCredentialConstants`:

```typescript
export function generateSecretConstants(context?: ExecutionContext): string {
  if (!context?.secrets) return '';
  const entries = Object.entries(context.secrets);
  if (entries.length === 0) return '';
  return entries
    .map(([key, value]) => `const ${key} = ${JSON.stringify(value)};`)
    .join('\n');
}
```

Modify the `combinedScript` assembly (around line 111) to include secret constants:

Change from:
```typescript
const combinedScript = `${runtimeCode}\n\n// Credentials\n${credentialBlock}\n\n// Tool stubs\n${toolStubs}\n\n// User code\n${wrappedUserCode}`;
```

To:
```typescript
const secretBlock = generateSecretConstants(context);
const combinedScript = `${runtimeCode}\n\n// Credentials\n${credentialBlock}\n\n// Secrets\n${secretBlock}\n\n// Tool stubs\n${toolStubs}\n\n// User code\n${wrappedUserCode}`;
```

Design notes:
- Secret names become TypeScript const names directly (e.g., `MY_API_KEY` becomes `const MY_API_KEY = "..."`)
- This follows the exact same injection pattern as Bluesky credentials (`generateCredentialConstants`)
- The `--deny-env` flag on the Deno subprocess means environment variables are not accessible — const injection is the established mechanism
- Secret values are in the temporary script file which is cleaned up after execution

**Verification:**

Run: `bun run build`
Expected: Type-check passes

Run: `bun test src/runtime/`
Expected: Existing executor tests still pass

**Commit:** `feat(secrets): extend ExecutionContext with secrets injection for Deno sandbox`

<!-- END_TASK_7 -->

<!-- START_TASK_8 -->
### Task 8: Secret tools and executor integration tests

**Verifies:** knowledge-autonomy.AC1.1, knowledge-autonomy.AC1.2, knowledge-autonomy.AC1.3, knowledge-autonomy.AC1.4, knowledge-autonomy.AC1.6, knowledge-autonomy.AC1.7

**Files:**
- Create: `src/tool/builtin/secrets.test.ts`
- Create: `src/runtime/executor-secrets.test.ts`

**Testing:**

`secrets.test.ts` — Tests for the secret agent tools:

Tests must verify:
- knowledge-autonomy.AC1.1: `secret_set` handler calls store.set and returns success message
- knowledge-autonomy.AC1.2: `secret_list` handler returns key names only, never values
- knowledge-autonomy.AC1.3: `secret_delete` handler calls store.delete, returns success; returns error for non-existent key
- knowledge-autonomy.AC1.7: `secret_set` output does NOT contain the secret value (check that `output` string does not include the value passed in)
- knowledge-autonomy.AC1.7: `secret_list` output contains only key names

Use a mock SecretStore (same pattern as Task 5's `createMockSecretStore`). Create tools via `createSecretTools({ store: mockStore, owner: 'test-owner' })`, then call handlers directly with parameter objects.

`executor-secrets.test.ts` — Tests for `generateSecretConstants`:

Tests must verify:
- knowledge-autonomy.AC1.4: `generateSecretConstants` produces valid TypeScript const declarations
- Returns empty string when no secrets in context
- Returns empty string when secrets object is empty
- Properly JSON-escapes values containing quotes, newlines, etc.
- Multiple secrets produce multiple const lines

These are pure function tests — no database or Deno subprocess needed.

**Verification:**

Run: `bun test src/tool/builtin/secrets.test.ts src/runtime/executor-secrets.test.ts`
Expected: All tests pass

**Commit:** `test(secrets): add secret tool and executor integration tests`

<!-- END_TASK_8 -->

<!-- END_SUBCOMPONENT_C -->

<!-- START_SUBCOMPONENT_D (tasks 9-10) -->

<!-- START_TASK_9 -->
### Task 9: Composition root wiring

**Files:**
- Modify: `src/index.ts` (add imports, create store/resolver, conditionally register tools, update execution context)

**Implementation:**

Add imports near the top of `src/index.ts` (alongside other module imports around lines 20-60):

```typescript
import { createPostgresSecretStore, createSecretResolver } from '@/secrets';
import { createSecretTools } from '@/tool/builtin/secrets';
```

After persistence is connected and config is loaded (around line 650, near where other stores are created), create the secret store and resolver:

```typescript
const secretStore = createPostgresSecretStore(persistence);

const configSecrets: Record<string, string> = {};
if (process.env['ANTHROPIC_API_KEY']) configSecrets['ANTHROPIC_API_KEY'] = process.env['ANTHROPIC_API_KEY'];
if (process.env['OPENAI_COMPAT_API_KEY']) configSecrets['OPENAI_COMPAT_API_KEY'] = process.env['OPENAI_COMPAT_API_KEY'];
if (process.env['OPENROUTER_API_KEY']) configSecrets['OPENROUTER_API_KEY'] = process.env['OPENROUTER_API_KEY'];
if (process.env['EMBEDDING_API_KEY']) configSecrets['EMBEDDING_API_KEY'] = process.env['EMBEDDING_API_KEY'];
if (process.env['BRAVE_API_KEY']) configSecrets['BRAVE_API_KEY'] = process.env['BRAVE_API_KEY'];
if (process.env['TAVILY_API_KEY']) configSecrets['TAVILY_API_KEY'] = process.env['TAVILY_API_KEY'];
if (process.env['MAILGUN_API_KEY']) configSecrets['MAILGUN_API_KEY'] = process.env['MAILGUN_API_KEY'];

const secretResolver = createSecretResolver({
  store: secretStore,
  owner: AGENT_OWNER,
  configSecrets,
});
```

Conditionally register secret tools (after the registry is created, near the other tool registrations around line 660-740):

```typescript
if (config.secrets?.agent_managed) {
  const secretTools = createSecretTools({ store: secretStore, owner: AGENT_OWNER });
  for (const tool of secretTools) {
    registry.register(tool);
  }
  console.log('secret tools registered (agent_managed: true)');
}
```

Update the `getExecutionContext` closure (around line 905) to include resolved secrets:

The existing pattern builds `ExecutionContext` synchronously. Since `SecretResolver.resolve()` is async, the `getExecutionContext` getter needs to become async. Check the call site in `src/agent/agent.ts` — it calls `deps.getExecutionContext?.()` at line 501. This needs to support `Promise<ExecutionContext>`.

Alternative approach (simpler, no async change): resolve all secrets eagerly before each execution by making `getExecutionContext` async:

Modify the agent dependency type to accept `getExecutionContext?: () => Promise<ExecutionContext> | ExecutionContext` and `await` it in agent.ts at the call site.

Or — simpler still — resolve secrets at agent creation time and refresh periodically. Given this is the composition root, the cleanest approach is:

Update `getExecutionContext` to be async and update `agent.ts:501` to `await`:

In `src/index.ts`, change the `getExecutionContext` closure:

```typescript
const getExecutionContext = async (): Promise<ExecutionContext> => {
  const allKeys = await secretResolver.listKeys();
  const secrets = await secretResolver.resolve(allKeys);

  const context: ExecutionContext = { secrets };

  if (blueskyConnected && blueskySource) {
    const src = blueskySource;
    return {
      ...context,
      bluesky: {
        service: "https://bsky.social",
        pdsUrl: src.getPdsUrl(),
        accessToken: src.getAccessToken(),
        refreshToken: src.getRefreshToken(),
        did: config.bluesky.did!,
        handle: config.bluesky.handle!,
      },
    };
  }

  return context;
};
```

In `src/agent/agent.ts`, update the call site at line ~501:

Change:
```typescript
const context = deps.getExecutionContext?.();
```

To:
```typescript
const context = await deps.getExecutionContext?.();
```

And update the type of `getExecutionContext` in the agent's dependency type to:
```typescript
getExecutionContext?: () => Promise<ExecutionContext> | ExecutionContext;
```

**Verification:**

Run: `bun run build`
Expected: Type-check passes

Run: `bun test`
Expected: All existing tests still pass (no regressions)

**Commit:** `feat(secrets): wire secret store, resolver, and tools into composition root`

<!-- END_TASK_9 -->

<!-- START_TASK_10 -->
### Task 10: Composition root wiring tests

**Verifies:** knowledge-autonomy.AC1.6

**Files:**
- Modify: `src/index.test.ts` (add test cases for secret tool conditional registration)

**Testing:**

Tests must verify:
- knowledge-autonomy.AC1.6: When config has `secrets.agent_managed = false` (or `secrets` section absent), the tool registry does NOT contain `secret_set`, `secret_list`, or `secret_delete`
- When config has `secrets: { agent_managed: true }`, the tool registry contains all three secret tools

Follow the existing mock patterns in `src/index.test.ts`. The test creates a mock config and verifies which tools get registered. Check how existing tests handle conditional tool registration (e.g., web tools when `[web]` section is absent).

If `src/index.test.ts` doesn't have a clean pattern for this (the file is 537 lines and may test at a higher level), an alternative is to test the conditional logic directly: create a small test that builds a config with/without `secrets.agent_managed` and asserts tool presence.

**Verification:**

Run: `bun test src/index.test.ts`
Expected: All tests pass including new secret registration tests

**Commit:** `test(secrets): verify conditional secret tool registration`

<!-- END_TASK_10 -->

<!-- END_SUBCOMPONENT_D -->

<!-- START_TASK_11 -->
### Task 11: Error handling (SecretsError class)

**Files:**
- Create: `src/errors/secrets.ts`
- Modify: `src/errors/index.ts` (add export for SecretsError)

**Implementation:**

`src/errors/secrets.ts` — Following the pattern from `src/errors/memory.ts`:

```typescript
// pattern: Functional Core

import { ConstellationError } from './base.js';

export type SecretsErrorCode =
  | 'STORE_FAILED'
  | 'RESOLVE_FAILED';

export class SecretsError extends ConstellationError {
  constructor(
    code: SecretsErrorCode,
    message: string,
    context?: Record<string, unknown>,
    options?: { suggestion?: string; cause?: Error },
  ) {
    super(message, code, 'secrets', context ?? {}, options);
    this.name = 'SecretsError';
  }
}
```

Add to `src/errors/index.ts`:

```typescript
export { SecretsError } from './secrets.js';
export type { SecretsErrorCode } from './secrets.js';
```

Then update `src/secrets/postgres-store.ts` to wrap database errors in `SecretsError`:

```typescript
import { SecretsError } from '@/errors/secrets.js';

// In each method, wrap persistence.query errors:
// try { ... } catch (error) {
//   throw new SecretsError('STORE_FAILED', `failed to [operation] secret`, { key }, { cause: error as Error });
// }
```

Similarly update `src/secrets/resolver.ts` to wrap resolution errors in `SecretsError` with code `RESOLVE_FAILED`.

Note: Keep error contexts free of secret values — only include the key name, never the value (AC1.7).

**Verification:**

Run: `bun run build`
Expected: Type-check passes

Run: `bun test src/secrets/`
Expected: All tests still pass

**Commit:** `feat(secrets): add SecretsError class and error handling`

<!-- END_TASK_11 -->
