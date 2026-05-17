# Knowledge Autonomy Implementation Plan — Phase 3: Custom Tools

**Goal:** Runtime tool creation with persistence, registry integration, and Deno sandbox execution

**Architecture:** Port/adapter pattern with `CustomToolManager` orchestrating CRUD, `ToolRegistry` integration, and Deno execution. Custom tool handlers are closures that wrap the tool's TypeScript code, inject parameters as a const, resolve secrets, and execute via the existing `CodeRuntime`. Tools are registered through the normal `ToolRegistry` so they appear in `toModelTools()` (visible to model) and `generateStubs()` (callable from sandbox code).

**Tech Stack:** TypeScript 5.7+, PostgreSQL 17, Bun, Deno sandbox

**Scope:** 7 phases from original design (phase 3 of 7)

**Codebase verified:** 2026-05-17

---

## Acceptance Criteria Coverage

This phase implements and tests:

### knowledge-autonomy.AC2: Custom Tools
- **knowledge-autonomy.AC2.2 Success:** Agent creates a custom tool via `create_tool` and it is callable as a native model tool on the next turn
- **knowledge-autonomy.AC2.3 Success:** Agent creates a custom tool and it is callable from sandbox code via generated stub
- **knowledge-autonomy.AC2.4 Success:** Custom tools persist to PostgreSQL and reload on restart
- **knowledge-autonomy.AC2.5 Success:** Agent updates a custom tool and the updated version is used on subsequent calls
- **knowledge-autonomy.AC2.6 Success:** Agent deletes a custom tool and it is no longer callable or visible
- **knowledge-autonomy.AC2.7 Failure:** Creating a tool with a built-in tool's name returns an error
- **knowledge-autonomy.AC2.8 Success:** Custom tool code can access secrets via sandbox environment variables

---

<!-- START_TASK_1 -->
### Task 1: Database migration for custom_tools table

**Files:**
- Create: `src/persistence/migrations/012_custom_tools_schema.sql`

**Implementation:**

```sql
-- Custom tools table for agent-defined runtime tools

CREATE TABLE IF NOT EXISTS custom_tools (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    parameters JSONB NOT NULL DEFAULT '[]',
    code TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (owner, name)
);

CREATE INDEX IF NOT EXISTS idx_custom_tools_owner
    ON custom_tools (owner);
```

Design notes:
- `id` is a separate TEXT primary key (UUIDv4 via `crypto.randomUUID()`) for stable references — design mentions ULID but nothing relies on lexicographic ordering of tool IDs, so UUID is acceptable
- `UNIQUE (owner, name)` prevents duplicate tool names per owner
- `parameters` stored as JSONB array of `ToolParameter` objects — validated at the application layer
- `code` is the raw TypeScript source to execute in the Deno sandbox

**Verification:**

Run: `bun run migrate`
Expected: Migration applies without errors

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(custom-tool): add database migration for custom_tools table`

<!-- END_TASK_1 -->

<!-- START_SUBCOMPONENT_A (tasks 2-3) -->

<!-- START_TASK_2 -->
### Task 2: CustomToolDefinition types

**Files:**
- Create: `src/custom-tool/types.ts`

**Implementation:**

```typescript
// pattern: Functional Core

import type { ToolParameter } from '@/tool/types.js';

export type CustomToolDefinition = {
  readonly id: string;
  readonly owner: string;
  readonly name: string;
  readonly description: string;
  readonly parameters: ReadonlyArray<ToolParameter>;
  readonly code: string;
  readonly created_at: Date;
  readonly updated_at: Date;
};

export type CustomToolStore = {
  create(def: Omit<CustomToolDefinition, 'created_at' | 'updated_at'>): Promise<CustomToolDefinition>;
  update(owner: string, name: string, patch: Partial<Pick<CustomToolDefinition, 'description' | 'parameters' | 'code'>>): Promise<CustomToolDefinition | null>;
  delete(owner: string, name: string): Promise<boolean>;
  list(owner: string): Promise<ReadonlyArray<CustomToolDefinition>>;
  getByName(owner: string, name: string): Promise<CustomToolDefinition | null>;
};
```

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(custom-tool): add CustomToolDefinition types and CustomToolStore port`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: PostgresCustomToolStore adapter

**Files:**
- Create: `src/custom-tool/postgres-store.ts`

**Implementation:**

```typescript
// pattern: Imperative Shell

import type { PersistenceProvider } from '@/persistence/types.js';
import type { ToolParameter } from '@/tool/types.js';
import type { CustomToolDefinition, CustomToolStore } from './types.js';

export function createPostgresCustomToolStore(persistence: PersistenceProvider): CustomToolStore {
  return {
    async create(def) {
      const rows = await persistence.query<CustomToolRow>(
        `INSERT INTO custom_tools (id, owner, name, description, parameters, code)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [def.id, def.owner, def.name, def.description, JSON.stringify(def.parameters), def.code],
      );
      return rowToDefinition(rows[0]!);
    },

    async update(owner, name, patch) {
      const setClauses: Array<string> = ['updated_at = NOW()'];
      const values: Array<unknown> = [];
      let paramIndex = 1;

      if (patch.description !== undefined) {
        setClauses.push(`description = $${paramIndex++}`);
        values.push(patch.description);
      }
      if (patch.parameters !== undefined) {
        setClauses.push(`parameters = $${paramIndex++}`);
        values.push(JSON.stringify(patch.parameters));
      }
      if (patch.code !== undefined) {
        setClauses.push(`code = $${paramIndex++}`);
        values.push(patch.code);
      }

      values.push(owner, name);
      const rows = await persistence.query<CustomToolRow>(
        `UPDATE custom_tools SET ${setClauses.join(', ')}
         WHERE owner = $${paramIndex++} AND name = $${paramIndex}
         RETURNING *`,
        values,
      );
      return rows[0] ? rowToDefinition(rows[0]) : null;
    },

    async delete(owner, name) {
      const rows = await persistence.query(
        'DELETE FROM custom_tools WHERE owner = $1 AND name = $2 RETURNING id',
        [owner, name],
      );
      return rows.length > 0;
    },

    async list(owner) {
      const rows = await persistence.query<CustomToolRow>(
        'SELECT * FROM custom_tools WHERE owner = $1 ORDER BY name',
        [owner],
      );
      return rows.map(rowToDefinition);
    },

    async getByName(owner, name) {
      const rows = await persistence.query<CustomToolRow>(
        'SELECT * FROM custom_tools WHERE owner = $1 AND name = $2',
        [owner, name],
      );
      return rows[0] ? rowToDefinition(rows[0]) : null;
    },
  };
}

type CustomToolRow = {
  id: string;
  owner: string;
  name: string;
  description: string;
  parameters: ReadonlyArray<ToolParameter> | string;
  code: string;
  created_at: Date;
  updated_at: Date;
};

function rowToDefinition(row: CustomToolRow): CustomToolDefinition {
  const parameters = typeof row.parameters === 'string'
    ? JSON.parse(row.parameters) as ReadonlyArray<ToolParameter>
    : row.parameters;
  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    description: row.description,
    parameters,
    code: row.code,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
```

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(custom-tool): add PostgresCustomToolStore adapter`

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-6) -->

<!-- START_TASK_4 -->
### Task 4: CustomToolManager — CRUD with registry integration

**Files:**
- Create: `src/custom-tool/manager.ts`
- Create: `src/custom-tool/index.ts`

**Implementation:**

The manager orchestrates CRUD operations and keeps the `ToolRegistry` in sync. When a custom tool is created, the manager:
1. Persists the definition to PostgreSQL
2. Creates a handler closure that wraps the tool's code for Deno execution
3. Registers the tool in the `ToolRegistry`

When a custom tool is invoked (via normal registry dispatch), the handler:
1. Retrieves the tool definition (from an in-memory cache, not DB — for performance)
2. Wraps the code with parameter injection: `const PARAMS = { ... };` prepended to tool code
3. Resolves secrets via `SecretResolver`
4. Builds an `ExecutionContext` with the resolved secrets
5. Executes via `CodeRuntime.execute(wrappedCode, toolStubs, context)`
6. Returns the execution result as a `ToolResult`

`src/custom-tool/manager.ts`:

```typescript
// pattern: Imperative Shell

import type { ToolRegistry, Tool, ToolParameter } from '@/tool/types.js';
import type { CodeRuntime } from '@/runtime/types.js';
import type { SecretResolver } from '@/secrets/resolver.js';
import type { CustomToolDefinition, CustomToolStore } from './types.js';

export type CustomToolManagerDeps = {
  readonly store: CustomToolStore;
  readonly registry: ToolRegistry;
  readonly runtime: CodeRuntime;
  readonly secretResolver: SecretResolver;
  readonly owner: string;
};

export type CustomToolManager = {
  create(def: {
    name: string;
    description: string;
    parameters: ReadonlyArray<ToolParameter>;
    code: string;
  }): Promise<CustomToolDefinition>;
  update(name: string, patch: Partial<Pick<CustomToolDefinition, 'description' | 'parameters' | 'code'>>): Promise<CustomToolDefinition>;
  delete(name: string): Promise<void>;
  list(): Promise<ReadonlyArray<CustomToolDefinition>>;
  loadAll(): Promise<void>;
};

export function createCustomToolManager(deps: CustomToolManagerDeps): CustomToolManager {
  const { store, registry, runtime, secretResolver, owner } = deps;
  const definitionCache = new Map<string, CustomToolDefinition>();

  function buildHandler(def: CustomToolDefinition): Tool['handler'] {
    return async (params) => {
      const cached = definitionCache.get(def.name);
      const code = cached?.code ?? def.code;

      const paramsBlock = `const PARAMS = ${JSON.stringify(params)} as const;`;
      const wrappedCode = `${paramsBlock}\n${code}`;

      const allKeys = await secretResolver.listKeys();
      const secrets = await secretResolver.resolve(allKeys);
      const stubs = registry.generateStubs();

      const result = await runtime.execute(wrappedCode, stubs, { secrets });

      if (!result.success) {
        return { success: false, output: '', error: result.error ?? 'execution failed' };
      }
      return { success: true, output: result.output };
    };
  }

  function registerInRegistry(def: CustomToolDefinition): void {
    const tool: Tool = {
      definition: {
        name: def.name,
        description: def.description,
        parameters: [...def.parameters],
      },
      handler: buildHandler(def),
    };
    registry.register(tool);
  }

  return {
    async create(input) {
      const existingDefs = registry.getDefinitions();
      const existingNames = new Set(existingDefs.map(d => d.name));
      if (existingNames.has(input.name)) {
        throw new Error(`tool name conflicts with existing tool: ${input.name}`);
      }

      const id = crypto.randomUUID();
      const def = await store.create({
        id,
        owner,
        name: input.name,
        description: input.description,
        parameters: input.parameters,
        code: input.code,
      });

      definitionCache.set(def.name, def);
      registerInRegistry(def);
      return def;
    },

    async update(name, patch) {
      const updated = await store.update(owner, name, patch);
      if (!updated) {
        throw new Error(`custom tool not found: ${name}`);
      }

      definitionCache.set(name, updated);
      registry.unregister(name);
      registerInRegistry(updated);
      return updated;
    },

    async delete(name) {
      const deleted = await store.delete(owner, name);
      if (!deleted) {
        throw new Error(`custom tool not found: ${name}`);
      }
      definitionCache.delete(name);
      registry.unregister(name);
    },

    async list() {
      return store.list(owner);
    },

    async loadAll() {
      const definitions = await store.list(owner);
      for (const def of definitions) {
        definitionCache.set(def.name, def);
        try {
          registerInRegistry(def);
        } catch {
          // Tool name may conflict with a built-in added since the custom tool was created.
          // Skip silently — the tool remains in the DB but isn't registered.
          console.warn(`[custom-tool] skipped conflicting tool: ${def.name}`);
        }
      }
    },
  };
}
```

`src/custom-tool/index.ts`:

```typescript
export type { CustomToolDefinition, CustomToolStore } from './types.js';
export { createPostgresCustomToolStore } from './postgres-store.js';
export { createCustomToolManager } from './manager.js';
export type { CustomToolManager, CustomToolManagerDeps } from './manager.js';
```

Design notes:
- `buildHandler` creates a closure per tool. The closure reads from `definitionCache` so updates are reflected without re-dispatching.
- `create()` checks `registry.getDefinitions()` for name collisions BEFORE persisting — this covers built-in tools AND other custom tools (AC2.7).
- `update()` uses the Phase 2 `unregister()` method then re-registers with the new definition (AC2.5).
- `loadAll()` silently skips conflicting names — a custom tool created before a built-in was added shouldn't crash startup.
- `PARAMS` const injection: the tool's TypeScript code accesses its arguments via `PARAMS.paramName`.

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(custom-tool): add CustomToolManager with registry integration and Deno execution`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Agent tools (create_tool, list_tools, update_tool, delete_tool)

**Files:**
- Create: `src/tool/builtin/custom-tools.ts`

**Implementation:**

```typescript
// pattern: Imperative Shell

import type { Tool, ToolParameter } from '../types.js';
import type { CustomToolManager } from '@/custom-tool/manager.js';

export function createCustomToolTools(manager: CustomToolManager): ReadonlyArray<Tool> {
  const createTool: Tool = {
    definition: {
      name: 'create_tool',
      description: 'Create a new custom tool. The tool becomes immediately callable as a native tool on the next turn. The code receives parameters via a PARAMS constant (e.g., PARAMS.query). The code can call output() to produce results. Secrets are available as TypeScript constants (e.g., MY_API_KEY).',
      parameters: [
        { name: 'name', type: 'string', description: 'Tool name (snake_case, must not conflict with built-in tools)', required: true },
        { name: 'description', type: 'string', description: 'What the tool does (shown to the model)', required: true },
        { name: 'parameters', type: 'array', description: 'Array of parameter definitions: [{name, type, description, required}]', required: true },
        { name: 'code', type: 'string', description: 'TypeScript code to execute. Access params via PARAMS constant. Call output() to produce results.', required: true },
      ],
    },
    handler: async (params) => {
      const name = params['name'] as string;
      const description = params['description'] as string;
      const rawParams = params['parameters'] as Array<Record<string, unknown>>;
      const code = params['code'] as string;

      const toolParams: Array<ToolParameter> = rawParams.map(p => ({
        name: String(p['name']),
        type: String(p['type']) as ToolParameter['type'],
        description: String(p['description']),
        required: Boolean(p['required']),
      }));

      try {
        const def = await manager.create({ name, description, parameters: toolParams, code });
        return { success: true, output: `Custom tool "${def.name}" created successfully. It is now callable.` };
      } catch (error) {
        return { success: false, output: '', error: error instanceof Error ? error.message : String(error) };
      }
    },
  };

  const listTools: Tool = {
    definition: {
      name: 'list_tools',
      description: 'List all custom tools created by this agent.',
      parameters: [],
    },
    handler: async () => {
      const tools = await manager.list();
      if (tools.length === 0) {
        return { success: true, output: 'No custom tools defined.' };
      }
      const lines = tools.map(t =>
        `- ${t.name}: ${t.description} (${t.parameters.length} params, updated ${t.updated_at.toISOString()})`,
      );
      return { success: true, output: `Custom tools:\n${lines.join('\n')}` };
    },
  };

  const updateTool: Tool = {
    definition: {
      name: 'update_tool',
      description: 'Update an existing custom tool. Only provide fields you want to change.',
      parameters: [
        { name: 'name', type: 'string', description: 'Name of the tool to update', required: true },
        { name: 'description', type: 'string', description: 'New description', required: false },
        { name: 'parameters', type: 'array', description: 'New parameter definitions', required: false },
        { name: 'code', type: 'string', description: 'New TypeScript code', required: false },
      ],
    },
    handler: async (params) => {
      const name = params['name'] as string;
      const patch: Record<string, unknown> = {};
      if ('description' in params) patch['description'] = params['description'];
      if ('code' in params) patch['code'] = params['code'];
      if ('parameters' in params) {
        const rawParams = params['parameters'] as Array<Record<string, unknown>>;
        patch['parameters'] = rawParams.map(p => ({
          name: String(p['name']),
          type: String(p['type']),
          description: String(p['description']),
          required: Boolean(p['required']),
        }));
      }

      try {
        const updated = await manager.update(name, patch as Parameters<CustomToolManager['update']>[1]);
        return { success: true, output: `Custom tool "${updated.name}" updated successfully.` };
      } catch (error) {
        return { success: false, output: '', error: error instanceof Error ? error.message : String(error) };
      }
    },
  };

  const deleteTool: Tool = {
    definition: {
      name: 'delete_tool',
      description: 'Delete a custom tool. It will no longer be callable.',
      parameters: [
        { name: 'name', type: 'string', description: 'Name of the tool to delete', required: true },
      ],
    },
    handler: async (params) => {
      const name = params['name'] as string;
      try {
        await manager.delete(name);
        return { success: true, output: `Custom tool "${name}" deleted.` };
      } catch (error) {
        return { success: false, output: '', error: error instanceof Error ? error.message : String(error) };
      }
    },
  };

  return [createTool, listTools, updateTool, deleteTool];
}
```

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(custom-tool): add create_tool, list_tools, update_tool, delete_tool agent tools`

<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Custom tool tests

**Verifies:** knowledge-autonomy.AC2.2, knowledge-autonomy.AC2.3, knowledge-autonomy.AC2.4, knowledge-autonomy.AC2.5, knowledge-autonomy.AC2.6, knowledge-autonomy.AC2.7, knowledge-autonomy.AC2.8

**Files:**
- Create: `src/custom-tool/postgres-store.test.ts`
- Create: `src/custom-tool/manager.test.ts`

**Testing:**

`postgres-store.test.ts` — Tests against real PostgreSQL:

Tests must verify:
- knowledge-autonomy.AC2.4: `create()` persists a tool definition and `getByName()` retrieves it
- knowledge-autonomy.AC2.4: `list()` returns all tools for owner, sorted by name
- `update()` modifies specific fields and returns updated definition
- `update()` on non-existent tool returns null
- `delete()` removes a tool and returns true; subsequent `getByName()` returns null
- `delete()` on non-existent tool returns false
- Owner isolation: tools from owner A are not visible to owner B

Test setup pattern (following `src/activity/postgres-activity-manager.test.ts`):
- `beforeAll`: connect persistence, run migrations
- Generate unique `TEST_OWNER`: `'test-custom-tool-' + Math.random().toString(36).substring(7)`
- `afterAll`: delete test data, disconnect

`manager.test.ts` — Tests with mock dependencies:

Tests must verify:
- knowledge-autonomy.AC2.2: After `create()`, the tool appears in `registry.getDefinitions()` and `registry.toModelTools()`
- knowledge-autonomy.AC2.3: After `create()`, the tool appears in `registry.generateStubs()`
- knowledge-autonomy.AC2.5: After `update()`, dispatching the tool uses the new handler (new code executes)
- knowledge-autonomy.AC2.6: After `delete()`, the tool is not in `registry.getDefinitions()` and `dispatch()` returns "unknown tool"
- knowledge-autonomy.AC2.7: `create()` with a name that matches an existing tool throws an error
- knowledge-autonomy.AC2.8: The handler passes secrets to `runtime.execute()` in the ExecutionContext
- `loadAll()` registers all persisted tools into the registry
- `loadAll()` silently skips tools that conflict with existing names

Mock setup:
- Use a real `createToolRegistry()` (it's in-memory, no DB needed)
- Mock `CodeRuntime` with a simple handler that captures arguments
- Mock `SecretResolver` returning fixed key/value pairs
- Mock `CustomToolStore` with in-memory implementation

**Verification:**

Run: `bun test src/custom-tool/`
Expected: All tests pass

**Commit:** `test(custom-tool): add store and manager tests`

<!-- END_TASK_6 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_7 -->
### Task 7: Composition root wiring for custom tools

**Files:**
- Modify: `src/index.ts` (add imports, create store/manager, register tools, call loadAll)

**Implementation:**

Add imports near the top of `src/index.ts`:

```typescript
import { createPostgresCustomToolStore, createCustomToolManager } from '@/custom-tool';
import { createCustomToolTools } from '@/tool/builtin/custom-tools';
```

After the secret store/resolver are created (from Phase 1), and after the runtime is created (line ~773), create the custom tool manager:

```typescript
const customToolStore = createPostgresCustomToolStore(persistence);
const customToolManager = createCustomToolManager({
  store: customToolStore,
  registry,
  runtime,
  secretResolver,
  owner: AGENT_OWNER,
});
```

Load persisted custom tools (after all built-in tools are registered, before agent creation):

```typescript
await customToolManager.loadAll();
console.log('custom tools loaded');
```

Register the custom tool management tools (always available — the agent needs these to create/manage custom tools):

```typescript
const customToolTools = createCustomToolTools(customToolManager);
for (const tool of customToolTools) {
  registry.register(tool);
}
console.log('custom tool management tools registered');
```

**Verification:**

Run: `bun run build`
Expected: Type-check passes

Run: `bun test`
Expected: All existing tests still pass

**Commit:** `feat(custom-tool): wire custom tool manager into composition root`

<!-- END_TASK_7 -->
