# Bluesky DataSource Implementation Plan — Phase 4: Credential Injection

**Goal:** Sandbox code executed from the Bluesky conversation receives Bluesky JWT tokens as constants; REPL sandbox executions receive no Bluesky credentials.

**Architecture:** The `execute()` function on `CodeRuntime` gains an optional `ExecutionContext` parameter. When an `ExecutionContext` with a `bluesky` field is provided, the executor generates a block of `const` declarations (e.g., `const BSKY_ACCESS_TOKEN = "eyJ..."`) and prepends them to the combined script between the runtime bridge and tool stubs. The agent's tool dispatch in `agent.ts` passes the context when dispatching `execute_code` from a Bluesky conversation. A pure function `generateCredentialConstants(context)` builds the constants block for testability.

**Tech Stack:** Bun test

**Scope:** 6 phases from original design (phase 4 of 6)

**Codebase verified:** 2026-02-28

---

## Acceptance Criteria Coverage

This phase implements and tests:

### bsky-datasource.AC3: Credential Injection
- **bsky-datasource.AC3.1 Success:** Sandbox executions from Bluesky conversation receive BSKY_SERVICE, BSKY_ACCESS_TOKEN, BSKY_REFRESH_TOKEN, BSKY_DID, BSKY_HANDLE as constants
- **bsky-datasource.AC3.2 Failure:** Sandbox executions from REPL conversation do not receive Bluesky credentials
- **bsky-datasource.AC3.3 Success:** Injected constants are valid JavaScript/TypeScript that can be referenced by agent-written code

---

<!-- START_SUBCOMPONENT_A (tasks 1-4) -->
<!-- START_TASK_1 -->
### Task 1: Add ExecutionContext type to runtime types

**Verifies:** bsky-datasource.AC3.1

**Files:**
- Modify: `src/runtime/types.ts:26-28`

**Implementation:**

Add `ExecutionContext` type before the `CodeRuntime` interface:

```typescript
export type ExecutionContext = {
  readonly bluesky?: {
    readonly service: string;
    readonly accessToken: string;
    readonly refreshToken: string;
    readonly did: string;
    readonly handle: string;
  };
};
```

Update the `CodeRuntime` interface to accept an optional context:

```typescript
export interface CodeRuntime {
  execute(code: string, toolStubs: string, context?: ExecutionContext): Promise<ExecutionResult>;
}
```

Update barrel export in `src/runtime/index.ts` to include `ExecutionContext`:
```typescript
export type { CodeRuntime, ExecutionResult, ExecutionContext, ... } from './types.ts';
```

No tests needed — TypeScript compiler verifies types.

**Verification:**
Run: `bun run build`
Expected: Type-check may warn about executor.ts needing the new parameter — that's expected, fixed in Task 2.

**Commit:** `feat(runtime): add ExecutionContext type for credential injection`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Implement credential constant generation and injection in executor

**Verifies:** bsky-datasource.AC3.1, bsky-datasource.AC3.2, bsky-datasource.AC3.3

**Files:**
- Modify: `src/runtime/executor.ts:39, 92`

**Implementation:**

1. Update the `execute()` function signature on line 39 to accept the optional context:
   ```typescript
   async execute(code: string, toolStubs: string, context?: ExecutionContext): Promise<ExecutionResult> {
   ```

2. Add a pure function `generateCredentialConstants(context?: ExecutionContext): string` (outside the factory, as a module-level function). This function returns an empty string if no context or no bluesky field is present:

   ```typescript
   function generateCredentialConstants(context?: ExecutionContext): string {
     if (!context?.bluesky) return "";
     const { service, accessToken, refreshToken, did, handle } = context.bluesky;
     return [
       `const BSKY_SERVICE = ${JSON.stringify(service)};`,
       `const BSKY_ACCESS_TOKEN = ${JSON.stringify(accessToken)};`,
       `const BSKY_REFRESH_TOKEN = ${JSON.stringify(refreshToken)};`,
       `const BSKY_DID = ${JSON.stringify(did)};`,
       `const BSKY_HANDLE = ${JSON.stringify(handle)};`,
     ].join("\n");
   }
   ```

   Using `JSON.stringify()` ensures values are properly escaped as valid JS string literals (AC3.3).

3. Modify the combined script assembly on line 92 to inject credentials:
   ```typescript
   const credentialBlock = generateCredentialConstants(context);
   const combinedScript = `${runtimeCode}\n\n// Credentials\n${credentialBlock}\n\n// Tool stubs\n${toolStubs}\n\n// User code\n${wrappedUserCode}`;
   ```

   When no context is provided (REPL case), `credentialBlock` is empty string — no credentials in the script (AC3.2).

**Testing:**

Tests must verify each AC listed above:
- bsky-datasource.AC3.1: Call `generateCredentialConstants()` with a bluesky context and verify the output contains all 5 `const` declarations with correct values
- bsky-datasource.AC3.2: Call `generateCredentialConstants()` with `undefined` and verify it returns empty string; call with `{}` (no bluesky field) — same result
- bsky-datasource.AC3.3: Verify the output of `generateCredentialConstants()` is syntactically valid TypeScript by checking that each line matches `const BSKY_* = "...";` format; verify special characters in tokens are properly escaped via JSON.stringify

Test file: `src/runtime/executor.test.ts` (existing file — add new describe block)

Export `generateCredentialConstants` for testing (or test it indirectly through `execute()` by checking the assembled script). Since the function is pure and deterministic, direct unit testing is preferred. Export it as a named export.

**Verification:**
Run: `bun test src/runtime/executor.test.ts`
Expected: All tests pass (existing + new)

**Commit:** `feat(runtime): inject Bluesky credential constants into sandbox script`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Update agent tool dispatch to pass ExecutionContext

**Verifies:** bsky-datasource.AC3.1, bsky-datasource.AC3.2

**Files:**
- Modify: `src/agent/agent.ts:109-115`
- Modify: `src/agent/types.ts` (AgentDependencies)

**Implementation:**

The agent needs to know whether to pass Bluesky credentials when dispatching `execute_code`. Two approaches:

**Approach (chosen):** Add an optional `getExecutionContext` getter function to `AgentDependencies`. The getter is called at execution time (inside the tool dispatch) to obtain fresh tokens, avoiding stale credentials when BskyAgent auto-refreshes:

```typescript
export type AgentDependencies = {
  model: ModelProvider;
  memory: MemoryManager;
  registry: ToolRegistry;
  runtime: CodeRuntime;
  persistence: PersistenceProvider;
  config: AgentConfig;
  getExecutionContext?: () => ExecutionContext;
};
```

Import `ExecutionContext` from `../runtime/types.ts`.

Then update the `execute_code` dispatch in agent.ts (at the `execute_code` special case block, currently lines 109-115):

```typescript
if (toolUse.name === 'execute_code') {
  const code = String(toolUse.input['code']);
  const stubs = deps.registry.generateStubs();
  const context = deps.getExecutionContext?.();
  const result = await deps.runtime.execute(code, stubs, context);
  toolResult = result.success ? result.output : `Error: ${result.error}`;
}
```

The getter is called at execution time, ensuring tokens are fresh. When no getter is provided (REPL agent), `context` is `undefined` and no credentials are injected. The composition root (Phase 6) creates the Bluesky agent with a getter that reads current tokens from the BlueskyDataSource.

**Testing:**

No new tests here — the credential injection is tested in Task 2 (pure function) and the full pipeline is tested in Phase 6 (integration). The agent dispatch change is a one-line addition passing a parameter through.

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(agent): pass ExecutionContext through to runtime for credential injection`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Run full test suite

**Verifies:** None (verification gate)

**Files:** None (read-only)

**Verification:**
Run: `bun test`
Expected: All previously-passing tests still pass plus new Phase 4 tests. Pre-existing PostgreSQL failures expected.

Run: `bun run build`
Expected: Type-check passes with zero errors.

**Commit:** No commit (verification only)
<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_A -->
