# MCP Client Implementation Plan

**Goal:** Add MCP (Model Context Protocol) client support to Constellation, allowing it to connect to external MCP servers and surface their tools and prompts as first-class capabilities.

**Architecture:** Standalone `src/mcp/` module wrapping `@modelcontextprotocol/sdk`. Implements existing `ToolProvider` interface for tool discovery, adds skill adapter for MCP prompts, and wires into the composition root following the Bluesky DataSource lifecycle pattern.

**Tech Stack:** TypeScript 5.7+, Bun, Zod, `@modelcontextprotocol/sdk` v1.29+

**Scope:** 5 phases from original design (phases 1-5)

**Codebase verified:** 2026-04-05

---

## Acceptance Criteria Coverage

This phase implements and tests:

### mcp-client.AC1: MCP servers configured in config.toml
- **mcp-client.AC1.1 Success:** Stdio server config with command, args, and env parses correctly
- **mcp-client.AC1.2 Success:** HTTP server config with url parses correctly
- **mcp-client.AC1.3 Success:** Multiple servers of mixed transport types parse correctly
- **mcp-client.AC1.4 Failure:** Stdio config missing `command` is rejected
- **mcp-client.AC1.5 Failure:** HTTP config missing `url` is rejected
- **mcp-client.AC1.6 Failure:** Unknown transport type is rejected
- **mcp-client.AC1.7 Edge:** Empty servers map with `enabled = true` is valid (no servers to connect)
- **mcp-client.AC1.8 Edge:** Env vars with `${VAR}` syntax are expanded from process.env

---

## Phase 1: Config Schema & Types

**Goal:** Define MCP configuration types and Zod schema so MCP servers can be declared in `config.toml`. Add `@modelcontextprotocol/sdk` dependency.

**Verifies:** None (infrastructure phase — verified operationally via `bun run build`)

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Add @modelcontextprotocol/sdk dependency

**Files:**
- Modify: `package.json` (add dependency at line ~29, inside `dependencies` block)

**Step 1: Install the dependency**

Run:
```bash
bun add @modelcontextprotocol/sdk
```

Expected: Package installs successfully, `package.json` updated with `@modelcontextprotocol/sdk` entry.

**Step 2: Verify installation**

Run:
```bash
bun run build
```

Expected: `tsc --noEmit` passes (no type errors introduced).

**Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add @modelcontextprotocol/sdk dependency"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Verify SDK types are accessible

**Step 1: Verify key imports resolve**

Run:
```bash
bun -e "import { Client } from '@modelcontextprotocol/sdk/client/index.js'; console.log('Client:', typeof Client)"
```

Expected: Prints `Client: function` (no import errors).

Run:
```bash
bun -e "import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'; console.log('Stdio:', typeof StdioClientTransport)"
```

Expected: Prints `Stdio: function`.

Run:
```bash
bun -e "import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'; console.log('HTTP:', typeof StreamableHTTPClientTransport)"
```

Expected: Prints `HTTP: function`.

No commit needed (verification only).
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

---

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->
<!-- START_TASK_3 -->
### Task 3: Create MCP domain types

**Files:**
- Create: `src/mcp/types.ts`

**Implementation:**

Create the domain types file. This is a type-only file (no runtime behaviour, no pattern annotation needed).

**Source of truth for config types:** The Zod schemas in `schema.ts` (Task 4) are the source of truth for config-related types. This file (`types.ts`) defines only the non-config domain types that don't have Zod equivalents. Config types (`McpServerConfig`, `McpConfig`) are inferred from Zod and exported from `schema.ts`.

Types to define in this file (non-config domain types only):

1. `McpToolInfo` — readonly type with fields: `name: string`, `description: string | undefined`, `inputSchema: Record<string, unknown>`
2. `McpPromptInfo` — readonly type with fields: `name: string`, `description: string | undefined`, `arguments: ReadonlyArray<{ readonly name: string; readonly description: string | undefined; readonly required: boolean | undefined }>`
3. `McpPromptResult` — readonly type with fields: `description: string | undefined`, `messages: ReadonlyArray<{ readonly role: 'user' | 'assistant'; readonly content: string }>`

Follow the project patterns:
- Use `type` not `interface` (these are value objects, not class contracts)
- All fields `readonly`
- Use `ReadonlyArray<T>` not `Array<T>` for immutable collections
- Use `Readonly<Record<K, V>>` for immutable maps
- Use `string | undefined` for optional fields that come from the SDK (not `null` — matching SDK conventions)

**Verification:**

Run:
```bash
bun run build
```

Expected: Type-check passes.

**Commit:**

```bash
git add src/mcp/types.ts
git commit -m "feat(mcp): add domain types for MCP client configuration"
```
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Create MCP Zod config schema

**Files:**
- Create: `src/mcp/schema.ts`

**Implementation:**

Create the Zod schema file following the pattern in `src/config/schema.ts`.

Mark as `// pattern: Functional Core` (pure Zod validation, no I/O).

Import `z` from `zod`.

Define schemas:

1. `McpStdioServerConfigSchema` — `z.object` with:
   - `transport: z.literal('stdio')`
   - `command: z.string().min(1)` (required, non-empty)
   - `args: z.array(z.string()).default([])`
   - `env: z.record(z.string(), z.string()).default({})`

2. `McpHttpServerConfigSchema` — `z.object` with:
   - `transport: z.literal('http')`
   - `url: z.string().url()`

3. `McpServerConfigSchema` — `z.discriminatedUnion('transport', [McpStdioServerConfigSchema, McpHttpServerConfigSchema])`

4. `McpConfigSchema` — `z.object` with:
   - `enabled: z.boolean().default(false)`
   - `servers: z.record(z.string(), McpServerConfigSchema).default({})`

Export all schemas and inferred types (following `src/config/schema.ts` pattern at lines 206-220):
- `export type McpStdioServerConfig = z.infer<typeof McpStdioServerConfigSchema>`
- `export type McpHttpServerConfig = z.infer<typeof McpHttpServerConfigSchema>`
- `export type McpServerConfig = z.infer<typeof McpServerConfigSchema>`
- `export type McpConfig = z.infer<typeof McpConfigSchema>`
- Named exports for all schemas

These Zod-inferred types are the single source of truth for config shapes. Do NOT duplicate these type definitions in `types.ts`.

**Verification:**

Run:
```bash
bun run build
```

Expected: Type-check passes.

**Commit:**

```bash
git add src/mcp/schema.ts
git commit -m "feat(mcp): add Zod config schema with discriminated union for stdio/http transports"
```
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Create barrel export and integrate with AppConfigSchema

**Files:**
- Create: `src/mcp/index.ts`
- Modify: `src/config/schema.ts` (add `mcp` field to `AppConfigSchema` at line ~203)

**Implementation:**

**5a: Create barrel export** (`src/mcp/index.ts`)

Mark as `// pattern: Functional Core (barrel export)`.

Follow the barrel pattern from `src/extensions/index.ts`:
- Type re-exports first: domain types from `./types.ts` (`McpToolInfo`, `McpPromptInfo`, `McpPromptResult`)
- Config types from `./schema.ts` (Zod-inferred: `McpServerConfig`, `McpConfig`, plus the individual `McpStdioServerConfig`, `McpHttpServerConfig` if useful)
- Value re-exports second: all schemas from `./schema.ts`

**5b: Add mcp to AppConfigSchema** (`src/config/schema.ts`)

Import `McpConfigSchema` from `@/mcp/schema.ts` at the top of the file (after existing imports, line ~3).

Add to `AppConfigSchema` at line ~203, between `activity` and the closing `})`:
```typescript
mcp: McpConfigSchema.default({}),
```

This follows the pattern used by `bluesky: BlueskyConfigSchema.default({})` at line 198. The `.default({})` means when `[mcp]` is absent from config.toml, it defaults to `{ enabled: false, servers: {} }`.

Also add the type export at line ~218:
```typescript
export type McpConfig = z.infer<typeof McpConfigSchema>;
```

And add `McpConfigSchema` to the schema named exports at line ~220.

**Verification:**

Run:
```bash
bun run build
```

Expected: Type-check passes. No existing tests broken.

Run:
```bash
bun test
```

Expected: All existing tests pass (the new default config is backward-compatible).

**Commit:**

```bash
git add src/mcp/index.ts src/config/schema.ts
git commit -m "feat(mcp): create barrel export and integrate McpConfigSchema into AppConfigSchema"
```
<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_B -->

---

<!-- START_SUBCOMPONENT_C (tasks 6-7) -->
<!-- START_TASK_6 -->
### Task 6: Create env var expansion utility

**Files:**
- Create: `src/mcp/env.ts`

**Implementation:**

Mark as `// pattern: Functional Core` (pure string transformation, no I/O).

Create a pure function `resolveEnvVars` that takes a string value and an env record, and expands `${VAR_NAME}` patterns:

```typescript
function resolveEnvVars(value: string, env: Readonly<Record<string, string | undefined>>): string
```

Behaviour:
- Replace `${VAR_NAME}` patterns with the corresponding value from `env`
- If a var is not found in `env`, leave the `${VAR_NAME}` literal as-is (don't fail)
- Non-string values pass through unchanged

Also create a helper that recursively resolves env vars in an `McpServerConfig`:

```typescript
function resolveServerConfigEnv(
  config: McpServerConfig,
  env: Readonly<Record<string, string | undefined>>,
): McpServerConfig
```

For stdio configs: resolve `command`, each item in `args`, and each value in `env` record.
For http configs: resolve `url`.

Import `McpServerConfig` from `./schema.ts` (config types are Zod-inferred, not in `types.ts`).

Export both functions.

Add the re-export to `src/mcp/index.ts`.

**Verification:**

Run:
```bash
bun run build
```

Expected: Type-check passes.

**Commit:**

```bash
git add src/mcp/env.ts src/mcp/index.ts
git commit -m "feat(mcp): add pure env var expansion utility for config values"
```
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Tests for MCP config schema and env expansion

**Verifies:** mcp-client.AC1.1, mcp-client.AC1.2, mcp-client.AC1.3, mcp-client.AC1.4, mcp-client.AC1.5, mcp-client.AC1.6, mcp-client.AC1.7, mcp-client.AC1.8

**Files:**
- Create: `src/mcp/schema.test.ts`
- Create: `src/mcp/env.test.ts`

**Testing:**

Tests follow the project pattern from `src/config/schema.test.ts`: `describe`/`it` blocks with AC labels, using `bun:test` imports (`describe`, `it`, `expect`).

**schema.test.ts** — Tests for `McpConfigSchema` and `McpServerConfigSchema`:

- mcp-client.AC1.1: Test that a stdio server config with `transport: 'stdio'`, `command`, `args`, and `env` parses correctly via `McpConfigSchema.parse()`. Verify typed result fields.
- mcp-client.AC1.2: Test that an HTTP server config with `transport: 'http'` and `url` parses correctly. Verify typed result.
- mcp-client.AC1.3: Test that a config with multiple servers of mixed types (one stdio, one http) in the `servers` record parses correctly.
- mcp-client.AC1.4: Test that stdio config missing `command` throws on parse (`expect(() => ...).toThrow()`).
- mcp-client.AC1.5: Test that HTTP config missing `url` throws on parse.
- mcp-client.AC1.6: Test that a server with `transport: 'websocket'` (unknown) throws on parse.
- mcp-client.AC1.7: Test that `{ enabled: true, servers: {} }` parses successfully (empty servers map is valid).
- Also test that `McpConfigSchema.parse({})` returns `{ enabled: false, servers: {} }` (defaults).
- Also test that the `mcp` field in `AppConfigSchema` defaults correctly when absent.

**env.test.ts** — Tests for `resolveEnvVars` and `resolveServerConfigEnv`:

- mcp-client.AC1.8: Test that `resolveEnvVars('${HOME}/bin', { HOME: '/Users/test' })` returns `'/Users/test/bin'`.
- Test that unresolvable vars pass through: `resolveEnvVars('${MISSING}', {})` returns `'${MISSING}'`.
- Test that multiple vars in one string resolve: `resolveEnvVars('${A}:${B}', { A: 'x', B: 'y' })` returns `'x:y'`.
- Test that strings without `${}` pass through unchanged.
- Test `resolveServerConfigEnv` for stdio config: resolves `command`, `args`, and `env` values.
- Test `resolveServerConfigEnv` for HTTP config: resolves `url`.

**Verification:**

Run:
```bash
bun test src/mcp/
```

Expected: All tests pass.

Run:
```bash
bun test
```

Expected: All existing tests still pass (no regressions).

**Commit:**

```bash
git add src/mcp/schema.test.ts src/mcp/env.test.ts
git commit -m "test(mcp): add config schema and env expansion tests covering AC1.1-AC1.8"
```
<!-- END_TASK_7 -->
<!-- END_SUBCOMPONENT_C -->
