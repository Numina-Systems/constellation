# OpenRouter Provider Implementation Plan — Phase 6

**Goal:** Wire the OpenRouter adapter into the provider factory and composition root, passing `syncFromServer` when rate limiting is active.

**Architecture:** Add `"openrouter"` case to the factory switch, update barrel exports, and modify the composition root to handle the OpenRouter adapter's need for a `syncFromServer` callback — which requires creating the rate-limited wrapper first, then the adapter (reverse of the current order for other providers).

**Tech Stack:** TypeScript, Bun

**Scope:** 6 phases from original design (phase 6 of 6)

**Codebase verified:** 2026-03-12

---

## Acceptance Criteria Coverage

This phase implements and tests:

### openrouter-provider.AC8: Factory and composition wiring
- **openrouter-provider.AC8.1 Success:** `createModelProvider({ provider: "openrouter", ... })` returns a working `ModelProvider`
- **openrouter-provider.AC8.2 Success:** Composition root passes `syncFromServer` when rate limiting is active for an openrouter provider
- **openrouter-provider.AC8.3 Success:** Composition root passes `undefined` for `onServerRateLimit` when rate limiting is not configured

---

<!-- START_SUBCOMPONENT_A (tasks 1-4) -->

<!-- START_TASK_1 -->
### Task 1: Add `"openrouter"` case to factory

**Verifies:** openrouter-provider.AC8.1

**Files:**
- Modify: `src/model/factory.ts:1-23` (add import and case)

**Implementation:**

In `src/model/factory.ts`:

1. Add import for the OpenRouter adapter:
   ```typescript
   import { createOpenRouterAdapter } from "./openrouter.js";
   ```

2. The factory currently takes `ModelConfig` and returns `ModelProvider`. For OpenRouter, the adapter also accepts an optional `onServerRateLimit` callback. However, the factory signature should stay simple — the `onServerRateLimit` callback is wired at the composition root level, not through the factory.

   The factory creates a "raw" adapter without rate limit integration. Add the case before the `default`:
   ```typescript
   case "openrouter":
     return createOpenRouterAdapter(config);
   ```

3. Update the error message to include `"openrouter"`:
   ```typescript
   throw new Error(
     `Unknown model provider: ${config.provider}. Valid providers are: 'anthropic', 'openai-compat', 'ollama', 'openrouter'`
   );
   ```

**Verification:**

Run: `bun run build`
Expected: Type-check succeeds

**Commit:** `feat: add openrouter to model provider factory`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Update barrel exports

**Files:**
- Modify: `src/model/index.ts` (add openrouter export)

**Implementation:**

Add the OpenRouter adapter export to `src/model/index.ts`:
```typescript
export { createOpenRouterAdapter } from "./openrouter.js";
```

**Verification:**

Run: `bun run build`
Expected: Type-check succeeds

**Commit:** `feat: export openrouter adapter from model barrel`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Wire OpenRouter adapter in composition root

**Verifies:** openrouter-provider.AC8.2, openrouter-provider.AC8.3

**Files:**
- Modify: `src/index.ts:15,29-30,437-453` (imports and model wiring)

**Implementation:**

The current composition root flow (lines 437-453):
1. `rawModel = createModelProvider(config.model)` — creates raw adapter
2. If rate limiting configured, wraps in `createRateLimitedProvider(rawModel, ...)`

For OpenRouter, the flow needs to change because the adapter needs the `syncFromServer` callback from the rate-limited wrapper. This is a chicken-and-egg: the adapter needs a callback from the wrapper, but the wrapper wraps the adapter.

The solution: for `"openrouter"` provider, create the adapter with `undefined` for `onServerRateLimit` initially, wrap it, then inject the callback. But since `createOpenRouterAdapter` captures the callback in a closure at construction time, we need a different approach.

**Approach: Use an indirect callback reference.**

Create a mutable callback holder that the adapter captures, then set it after the rate-limited wrapper is created:

```typescript
// In the model wiring section of src/index.ts (around lines 437-453):

let syncFromServerCallback: ServerRateLimitSync | undefined;

const rawModel = config.model.provider === "openrouter"
  ? createOpenRouterAdapter(config.model, (status) => syncFromServerCallback?.(status))
  : createModelProvider(config.model);

const model = hasRateLimitConfig(config.model)
  ? (() => {
      const rateLimitedModel = createRateLimitedProvider(
        rawModel,
        buildRateLimiterConfig(config.model),
      );
      if (config.model.provider === "openrouter") {
        syncFromServerCallback = rateLimitedModel.syncFromServer;
      }
      contextProviders.push(createRateLimitContextProvider(() => rateLimitedModel.getStatus()));
      // ... existing logging ...
      return rateLimitedModel;
    })()
  : rawModel;
```

This approach:
- AC8.2: When rate limiting is active, `syncFromServerCallback` is set to `rateLimitedModel.syncFromServer`, so the adapter's callback becomes live
- AC8.3: When rate limiting is not configured, `syncFromServerCallback` remains `undefined`, and the adapter's callback is a no-op

Add the necessary imports:
```typescript
import { createOpenRouterAdapter } from '@/model/openrouter.js';
import type { ServerRateLimitSync } from '@/rate-limit/types.js';
```

Also apply the same pattern for the summarization model if it uses `"openrouter"` provider. The summarization model wiring (lines 454-471) follows the same pattern.

**Verification:**

Run: `bun run build`
Expected: Type-check succeeds

**Commit:** `feat: wire openrouter adapter in composition root with syncFromServer`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Factory and wiring tests

**Verifies:** openrouter-provider.AC8.1, openrouter-provider.AC8.2, openrouter-provider.AC8.3

**Files:**
- Modify: `src/model/factory.test.ts` (add openrouter case)

**Implementation:**

Add tests to the existing `src/model/factory.test.ts` file.

Tests must verify:
- openrouter-provider.AC8.1: Call `createModelProvider({ provider: "openrouter", name: "anthropic/claude-sonnet-4" })` and verify it returns a non-null object with `complete` and `stream` methods (same pattern as existing factory tests at lines 9-21)
- openrouter-provider.AC8.2: This is an integration concern best verified at the composition root level. A unit test can verify that `createOpenRouterAdapter` accepts a callback function without error.
- openrouter-provider.AC8.3: Verify that `createOpenRouterAdapter(config)` (without second argument) returns a working adapter without throwing.

Follow the existing factory test pattern in `src/model/factory.test.ts`.

**Verification:**

Run: `bun test src/model/factory.test.ts`
Expected: All tests pass

Run: `bun run build`
Expected: Type-check succeeds

Run: `bun test`
Expected: All tests pass (896+ pass, only DB connection failures expected)

**Commit:** `test: add openrouter factory tests`

<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_A -->
