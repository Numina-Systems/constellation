# SpaceMolt Auto-Registration Implementation Plan - Phase 3

**Goal:** Replace hardcoded login in tool provider with register-or-login flow using credential memory.

**Architecture:** Refactor `createSpaceMoltToolProvider` to accept `registrationCode`, optional hints, and `MemoryStore`/`EmbeddingProvider` instead of `username`/`password`. The `discover()` method reads credentials from memory — if found, calls `login`; if not found, calls `register` with username generation fallback, persists returned credentials, then proceeds. `reconnect()` always uses `login` from memory.

**Tech Stack:** TypeScript, Bun

**Scope:** 5 phases from original design (phase 3 of 5)

**Codebase verified:** 2026-04-05

---

## Acceptance Criteria Coverage

This phase implements and tests:

### spacemolt-auto-register.AC3: Tool provider register-or-login flow
- **spacemolt-auto-register.AC3.1 Success:** `discover()` with no credentials in memory calls MCP `register` tool and persists returned credentials
- **spacemolt-auto-register.AC3.2 Success:** `discover()` with existing credentials in memory calls MCP `login` tool
- **spacemolt-auto-register.AC3.3 Success:** Registration uses config `username` hint when provided
- **spacemolt-auto-register.AC3.4 Edge:** `username_taken` error triggers retry with modified name (max 3 retries)
- **spacemolt-auto-register.AC3.5 Failure:** Exhausted registration retries throws descriptive error
- **spacemolt-auto-register.AC3.6 Success:** `reconnect()` always uses `login` path (never `register`)

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Update SpaceMoltToolProviderOptions and factory signature

**Verifies:** None (infrastructure for AC3.1-AC3.6)

**Files:**
- Modify: `src/extensions/spacemolt/tool-provider.ts:8-12`

**Implementation:**

Replace the existing `SpaceMoltToolProviderOptions` type at lines 8-12:

```typescript
import type { MemoryStore } from '../../memory/store.ts';
import type { EmbeddingProvider } from '../../embedding/types.ts';
import { readCredentials, writeCredentials } from './credentials.ts';
import type { Credentials } from './credentials.ts';

export type SpaceMoltToolProviderOptions = {
  readonly mcpUrl: string;
  readonly registrationCode: string;
  readonly usernameHint?: string;
  readonly empireHint?: string;
  readonly store: MemoryStore;
  readonly embedding: EmbeddingProvider;
};
```

Add these imports at the top of the file (after existing imports). The `readCredentials` and `writeCredentials` functions from Phase 2 will be used in the auth flow.

**Verification:**

Run: `bun run build`
Expected: Compile errors in tests (expected — tests still use old options shape). No errors in the provider itself.

**Commit:** `refactor(spacemolt): update tool provider options for registration flow`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Implement register-or-login flow in discover() and reconnect()

**Verifies:** spacemolt-auto-register.AC3.1, spacemolt-auto-register.AC3.2, spacemolt-auto-register.AC3.3, spacemolt-auto-register.AC3.4, spacemolt-auto-register.AC3.5, spacemolt-auto-register.AC3.6

**Files:**
- Modify: `src/extensions/spacemolt/tool-provider.ts:49-143` (the `createSpaceMoltToolProvider` function body)

**Implementation:**

Inside the `createSpaceMoltToolProvider` closure, add a helper to generate random spacey names and random empire selection, then replace the `discover()` and `reconnect()` implementations:

```typescript
const EMPIRES = ['solarian', 'voidborn', 'crimson', 'nebula', 'outerrim'] as const;
const NAME_PREFIXES = ['Spirit', 'Void', 'Nova', 'Nebula', 'Stellar', 'Cosmic', 'Astral', 'Phantom'];
const NAME_SUFFIXES = ['Runner', 'Walker', 'Drift', 'Hawk', 'Blade', 'Spark', 'Wing', 'Shade'];

function generateUsername(): string {
  const prefix = NAME_PREFIXES[Math.floor(Math.random() * NAME_PREFIXES.length)]!;
  const suffix = NAME_SUFFIXES[Math.floor(Math.random() * NAME_SUFFIXES.length)]!;
  const num = Math.floor(Math.random() * 100);
  return `${prefix}-${suffix}-${num}`;
}

function generateEmpire(): string {
  return EMPIRES[Math.floor(Math.random() * EMPIRES.length)]!;
}
```

Replace the `reconnect()` function (lines 80-99):

```typescript
async function reconnect(): Promise<void> {
  if (!mcpClient) {
    throw new Error('Cannot reconnect: MCP client not initialized');
  }

  await mcpClient.close();
  await mcpClient.connect(new URL(options.mcpUrl));

  // reconnect always uses login — credentials guaranteed to exist after first discover()
  const credentials = await readCredentials(options.store);
  if (!credentials) {
    throw new Error('Cannot reconnect: no credentials in memory');
  }

  await mcpClient.callTool({
    name: 'login',
    arguments: {
      username: credentials.username,
      password: credentials.password,
    },
  });
}
```

Replace the `discover()` function (lines 104-143):

```typescript
async function discover(): Promise<Array<ToolDefinition>> {
  if (discovered) {
    return toolCache;
  }

  if (!mcpClient) {
    throw new Error('MCP client not initialized');
  }

  await mcpClient.connect(new URL(options.mcpUrl));

  // Check memory for existing credentials
  const existingCredentials = await readCredentials(options.store);

  if (existingCredentials) {
    // Login path
    await mcpClient.callTool({
      name: 'login',
      arguments: {
        username: existingCredentials.username,
        password: existingCredentials.password,
      },
    });
  } else {
    // Register path
    const empire = options.empireHint ?? generateEmpire();
    const baseUsername = options.usernameHint ?? generateUsername();
    let username = baseUsername;
    let registered = false;
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const result = await mcpClient.callTool({
        name: 'register',
        arguments: {
          username,
          empire,
          registration_code: options.registrationCode,
        },
      });

      const responseText = flattenMcpContent(result.content);

      if (result.isError && responseText.includes('username_taken')) {
        // Retry with suffix on the same base name
        username = `${baseUsername}-${Math.floor(Math.random() * 1000)}`;
        continue;
      }

      if (result.isError) {
        throw new Error(`SpaceMolt registration failed: ${responseText}`);
      }

      // Parse registration response
      const parsed: unknown = JSON.parse(responseText);
      if (
        typeof parsed !== 'object' || parsed === null ||
        !('player_id' in parsed) || !('password' in parsed)
      ) {
        throw new Error(`SpaceMolt registration returned unexpected response: ${responseText}`);
      }

      const response = parsed as Record<string, unknown>;
      const credentials: Credentials = {
        username,
        password: String(response['password']),
        player_id: String(response['player_id']),
        empire,
      };

      await writeCredentials(options.store, options.embedding, credentials);
      registered = true;
      break;
    }

    if (!registered) {
      throw new Error(`SpaceMolt registration failed: username taken after ${maxRetries} retries`);
    }
  }

  // Paginate through tool list and cache
  const allTools = await paginateTools();
  toolCache = allTools;
  discovered = true;

  if (!subscribed) {
    subscribed = true;
    mcpClient.on('notifications/tools/list_changed', async () => {
      await refreshTools();
    });
  }

  return toolCache;
}
```

Key changes:
- `discover()` checks memory for credentials first, then either logs in or registers
- Registration uses `usernameHint`/`empireHint` from config with random fallbacks
- `username_taken` triggers retry with modified name (max 3 retries)
- On successful registration, credentials are persisted to memory via `writeCredentials`
- `reconnect()` reads credentials from memory and always uses `login`
- The `execute()` method is unchanged — it still handles session expiry with reconnect-and-retry

**Verification:**

Run: `bun run build`
Expected: Type-check passes for tool-provider.ts. Test file will have errors (expected — updated in Task 3).

**Commit:** `feat(spacemolt): implement register-or-login auth flow in tool provider`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Update tool provider tests

**Verifies:** spacemolt-auto-register.AC3.1, spacemolt-auto-register.AC3.2, spacemolt-auto-register.AC3.3, spacemolt-auto-register.AC3.4, spacemolt-auto-register.AC3.5, spacemolt-auto-register.AC3.6

**Files:**
- Modify: `src/extensions/spacemolt/tool-provider.test.ts`

**Testing:**

The test file needs significant updates. The `options` object changes shape, and the mock MCP client needs to handle `register` calls. Additionally, mock `MemoryStore` and `EmbeddingProvider` must be provided.

Reuse the `createMockMemoryStore()` and `createMockEmbeddingProvider()` patterns from `src/extensions/spacemolt/seed.test.ts`.

Update the `createMockMcpClient()` to also handle `register` tool calls:

```typescript
callTool: async (request) => {
  if (request.name === 'login') {
    return {
      content: [{ type: 'text', text: 'Logged in' }],
      isError: false,
    };
  }
  if (request.name === 'register') {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          player_id: 'player-123',
          password: 'a'.repeat(64), // 256-bit hex
        }),
      }],
      isError: false,
    };
  }
  // ... rest of tool handlers
}
```

Update the `options` object to match new shape:

```typescript
const store = createMockMemoryStore();
const embedding = createMockEmbeddingProvider();
const options: SpaceMoltToolProviderOptions = {
  mcpUrl: 'http://localhost:3000',
  registrationCode: 'test-reg-code',
  store,
  embedding,
};
```

Tests must verify:

- **spacemolt-auto-register.AC3.1:** When store has no credentials, `discover()` calls `register` tool and then `writeCredentials` persists credentials to store. Verify `createBlock` was called with `label: "spacemolt:credentials"`, `tier: "core"`, `pinned: true`.
- **spacemolt-auto-register.AC3.2:** When store has existing credentials block (override `getBlockByLabel` to return a block), `discover()` calls `login` tool with those credentials. Verify `register` is NOT called.
- **spacemolt-auto-register.AC3.3:** When `usernameHint` is provided in options, `register` call uses that username. Verify the `register` call's `arguments.username` matches the hint.
- **spacemolt-auto-register.AC3.4:** When first `register` call returns `isError: true` with text containing `username_taken`, a retry is made with a modified username. Verify at least 2 `register` calls.
- **spacemolt-auto-register.AC3.5:** When all 3 registration retries fail with `username_taken`, `discover()` throws with message containing `username taken after 3 retries`.
- **spacemolt-auto-register.AC3.6:** `reconnect()` reads credentials from memory and calls `login` (not `register`). Test by discovering first (to init client), then simulating session expiry in `execute()` which triggers `reconnect()`. Verify the login call uses memory credentials.

Existing tests for tool execution, pagination, tool caching, session expiry handling, and MCP content flattening should be updated to use the new options shape but their core assertions remain the same. For these tests, pre-populate the mock store with credentials so `discover()` takes the login path (simpler).

**Verification:**

Run: `bun test src/extensions/spacemolt/tool-provider.test.ts`
Expected: All tests pass

**Commit:** `test(spacemolt): update tool provider tests for register-or-login flow`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
