# Rate Limiter Implementation Plan — Phase 2: RateLimitedProvider Wrapper

**Goal:** ModelProvider wrapper that enforces rate limits using token buckets from Phase 1.

**Architecture:** Imperative Shell decorator wrapping any `ModelProvider`. Maintains three independent token buckets (RPM, ITPM, OTPM). Promise-based mutex serialises concurrent callers. Pre-request estimation via chars/4 heuristic, post-response correction with actual `response.usage` values.

**Tech Stack:** Bun, TypeScript (strict mode), bun:test

**Scope:** 5 phases from original design (phase 2 of 5)

**Codebase verified:** 2026-03-01

---

## Acceptance Criteria Coverage

This phase implements and tests:

### rate-limiter.AC1: Rate limiting prevents 429 errors
- **rate-limiter.AC1.1 Success:** When input token budget is available, requests pass through without delay
- **rate-limiter.AC1.2 Success:** When input token budget is exhausted, subsequent requests wait until budget refills, then succeed
- **rate-limiter.AC1.3 Success:** When RPM budget is exhausted, subsequent requests wait until budget refills
- **rate-limiter.AC1.4 Success:** When OTPM budget is below `minOutputReserve`, requests wait until sufficient output budget exists
- **rate-limiter.AC1.5 Success:** Post-response, buckets are corrected with actual `response.usage` values (not estimates)

### rate-limiter.AC4: REPL remains responsive
- **rate-limiter.AC4.1 Success:** Requests are queued and eventually processed, never dropped
- **rate-limiter.AC4.2 Success:** Concurrent callers (REPL agent + bluesky agent) are serialised by mutex -- both eventually proceed
- **rate-limiter.AC4.3 Edge:** Two concurrent callers cannot both observe sufficient capacity and both consume it (no double-spend)

### rate-limiter.AC5: Retry wrapper coexists
- **rate-limiter.AC5.1 Success:** Rate limiter sits above `retry.ts`; if a 429 sneaks through, retry handles it
- **rate-limiter.AC5.2 Success:** Rate limiter does not interfere with retry's exponential backoff behaviour

---

<!-- START_SUBCOMPONENT_A (tasks 1-4) -->

<!-- START_TASK_1 -->
### Task 1: Input token estimation helper and tests

**Verifies:** None (dependency for Task 3, but estimation accuracy underpins AC1.2, AC1.3, AC1.4)

**Files:**
- Create: `src/rate-limit/estimate.ts`
- Create: `src/rate-limit/estimate.test.ts`

**Implementation:**

Create a pure function to estimate input token count from a `ModelRequest` using the chars/4 heuristic. This function must handle all content types in the request: system prompt, messages (both string and `ContentBlock` array content), and tool definitions.

```typescript
// pattern: Functional Core

import type { ModelRequest, ContentBlock } from '../model/types.js';

function contentBlockToString(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
      return block.text;
    case 'tool_use':
      return `${block.name} ${JSON.stringify(block.input)}`;
    case 'tool_result':
      return typeof block.content === 'string'
        ? block.content
        : JSON.stringify(block.content);
  }
}

export function estimateInputTokens(request: ModelRequest): number {
  let chars = 0;

  if (request.system) {
    chars += request.system.length;
  }

  for (const message of request.messages) {
    if (typeof message.content === 'string') {
      chars += message.content.length;
    } else {
      for (const block of message.content) {
        chars += contentBlockToString(block).length;
      }
    }
  }

  if (request.tools) {
    for (const tool of request.tools) {
      chars += tool.name.length + tool.description.length + JSON.stringify(tool.input_schema).length;
    }
  }

  return Math.ceil(chars / 4);
}
```

**Testing:**

Tests for `estimateInputTokens` in `src/rate-limit/estimate.test.ts`:

- Empty request (no system, no messages, no tools) — returns 0
- System prompt only — returns `Math.ceil(system.length / 4)`
- Single text message — returns `Math.ceil(content.length / 4)`
- Message with `ContentBlock` array containing `TextBlock`, `ToolUseBlock`, and `ToolResultBlock` — estimates all blocks
- `ToolResultBlock` with string content vs array content — both estimated
- Request with `tools` array — includes tool name, description, and JSON-serialised input_schema
- Combined: system + messages + tools — totals are summed before dividing
- Rounding: verify `Math.ceil` is applied (e.g., 5 chars → 2 tokens, not 1)

**Verification:**

Run: `bun test src/rate-limit/estimate.test.ts`
Expected: All tests pass

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(rate-limit): add input token estimation helper with tests`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: RateLimitedProvider wrapper and tests

**Verifies:** rate-limiter.AC1.1, rate-limiter.AC1.2, rate-limiter.AC1.3, rate-limiter.AC1.4, rate-limiter.AC1.5, rate-limiter.AC4.1, rate-limiter.AC4.2, rate-limiter.AC4.3, rate-limiter.AC5.1, rate-limiter.AC5.2

**Files:**
- Create: `src/rate-limit/provider.ts`
- Create: `src/rate-limit/provider.test.ts`

**Implementation:**

Create an Imperative Shell wrapper that implements the `ModelProvider` interface. The factory function accepts a `ModelProvider` and `RateLimiterConfig`, returning a new object that satisfies `ModelProvider` plus a `getStatus()` method.

Key implementation details:

1. **Three token buckets:** Created from `RateLimiterConfig`. RPM bucket has capacity = `requestsPerMinute`, refillRate = `requestsPerMinute / 60000` (per ms). Same pattern for ITPM and OTPM.

2. **Promise-based mutex:** A chain of promises that serialises the check-wait-deduct sequence. Each caller awaits the previous caller's promise, then creates its own that the next caller will await. Pattern:

```typescript
let mutexChain = Promise.resolve();

function withMutex<T>(fn: () => Promise<T>): Promise<T> {
  const prev = mutexChain;
  let resolve: () => void = () => {};
  mutexChain = new Promise<void>(r => { resolve = r; });
  return prev.then(fn).finally(() => resolve());
}
```

3. **Queue depth tracking:** An integer counter incremented when a request enters the mutex queue, decremented when it exits. Exposed via `getStatus()`.

4. **complete() flow:**
   - Estimate input tokens via `estimateInputTokens(request)`
   - Enter mutex
   - Increment queue depth
   - Loop: `tryConsume` RPM (1), ITPM (estimated), OTPM (`minOutputReserve`, default 1024)
   - If any bucket returns `allowed: false`, sleep for `max(waitMs across all buckets)`, then retry the consume check
   - Exit mutex, decrement queue depth
   - Delegate to `provider.complete(request)`
   - `recordConsumption` on all three buckets with actual `response.usage` values
   - Return response unchanged

5. **stream() flow:** Delegate to `provider.stream(request)` — stream does not go through rate limiting (rate limiting is applied per-request, and stream is an alternative consumption of the same request). Note: the design specifies rate limiting on `complete()` only.

6. **getStatus():** Returns `RateLimitStatus` with current remaining/capacity for all three buckets plus queue depth.

7. **Logging:** When wait exceeds 5000ms, log at info level with wait duration. Add inside the wait loop, after computing `maxWaitMs`:

```typescript
if (maxWaitMs > 5000) {
  console.info(`rate limit: waiting ${Math.round(maxWaitMs)}ms for bucket refill`);
}
```

```typescript
// pattern: Imperative Shell
```

The function signature:

```typescript
export function createRateLimitedProvider(
  provider: ModelProvider,
  config: RateLimiterConfig,
): ModelProvider & { getStatus(): RateLimitStatus } {
  // implementation
}
```

**Testing:**

Tests must verify each AC listed above. This is an Imperative Shell test — use mock `ModelProvider` objects.

Create a `createMockProvider()` helper that returns a `ModelProvider` with configurable responses:

```typescript
function createMockProvider(response?: Partial<ModelResponse>): ModelProvider {
  return {
    complete: async () => ({
      content: [{ type: 'text' as const, text: 'response' }],
      stop_reason: 'end_turn' as const,
      usage: { input_tokens: 100, output_tokens: 50 },
      ...response,
    }),
    stream: async function* () { /* no-op */ },
  };
}
```

Tests to write:

- **rate-limiter.AC1.1:** Create provider with high limits. Call `complete()`. Verify response passes through without delay (measure elapsed time < 100ms).
- **rate-limiter.AC1.2:** Create provider with ITPM budget of 200. Send request consuming ~200 input tokens (estimate). Verify first call succeeds. Second call should be delayed until budget refills.
- **rate-limiter.AC1.3:** Create provider with RPM of 1. Call `complete()` twice in quick succession. Second call should wait.
- **rate-limiter.AC1.4:** Create provider with OTPM of 500 and minOutputReserve of 1024. Call `complete()`. Should wait because OTPM (500) < minOutputReserve (1024).
- **rate-limiter.AC1.5:** Create provider with known budget. Call `complete()`. Verify bucket state reflects actual usage from response, not estimate.
- **rate-limiter.AC4.1:** Send multiple concurrent requests. All should eventually resolve (none rejected/dropped).
- **rate-limiter.AC4.2:** Launch two `complete()` calls concurrently. Both should resolve. Verify serialisation via timing or call order.
- **rate-limiter.AC4.3:** Create provider with exact budget for 1 request. Launch two concurrent `complete()` calls. Verify only one proceeds immediately, the other waits.
- **rate-limiter.AC5.1:** Rate limiter wraps provider. If wrapped provider throws a ModelError with `rate_limit` code, it propagates up (retry is inside the adapter, below the rate limiter).
- **rate-limiter.AC5.2:** Verify rate limiter does not catch or transform errors from the underlying provider.

**Verification:**

Run: `bun test src/rate-limit/provider.test.ts`
Expected: All tests pass

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(rate-limit): implement RateLimitedProvider wrapper with mutex`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Update barrel exports

**Verifies:** None (infrastructure)

**Files:**
- Modify: `src/rate-limit/index.ts`

**Implementation:**

Add the new exports to the barrel:

```typescript
export { estimateInputTokens } from './estimate.js';
export { createRateLimitedProvider } from './provider.js';
```

These are added below the existing exports from Phase 1.

**Verification:**

Run: `bun run build`
Expected: Type-check passes

Run: `bun test src/rate-limit/`
Expected: All tests pass

**Commit:** `feat(rate-limit): export provider wrapper and estimation from barrel`

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
