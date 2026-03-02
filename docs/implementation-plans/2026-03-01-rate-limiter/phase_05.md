# Rate Limiter Implementation Plan — Phase 5: Composition Root Wiring

**Goal:** Wire rate limiter into the application at `src/index.ts`.

**Architecture:** Conditional wrapping at the composition root. When rate limit config fields are present on `ModelConfig`, wrap the provider with `createRateLimitedProvider`. Create a `ContextProvider` closure that reads rate limit status and formats it for the agent's system prompt. Both agents (REPL and Bluesky) share the same wrapped provider instance.

**Tech Stack:** Bun, TypeScript (strict mode), bun:test

**Scope:** 5 phases from original design (phase 5 of 5)

**Codebase verified:** 2026-03-01

---

## Acceptance Criteria Coverage

This phase implements and tests:

### rate-limiter.AC2: Per-model configurable budgets
- **rate-limiter.AC2.1 Success:** Each `ModelProvider` instance gets its own independent rate limit buckets

### rate-limiter.AC3: Spirit sees resource budget in context
- **rate-limiter.AC3.1 Success:** System prompt includes current remaining capacity for input tokens, output tokens, and queue depth
- **rate-limiter.AC3.3 Success:** When no rate limiter is configured, no budget section appears in system prompt

### rate-limiter.AC5: Retry wrapper coexists
- **rate-limiter.AC5.1 Success:** Rate limiter sits above `retry.ts`; if a 429 sneaks through, retry handles it

---

<!-- START_TASK_1 -->
### Task 1: Add rate limit helper and context provider factory

**Verifies:** None (dependency for Task 2)

**Files:**
- Create: `src/rate-limit/context.ts`

**Implementation:**

Create a helper module that provides:

1. `hasRateLimitConfig(config)`: Predicate that checks whether a model config has rate limit fields set. Returns `true` when all three required fields (`requests_per_minute`, `input_tokens_per_minute`, `output_tokens_per_minute`) are present.

2. `buildRateLimiterConfig(config)`: Converts `ModelConfig` rate limit fields (snake_case, TOML convention) to `RateLimiterConfig` (camelCase, TypeScript convention).

3. `createRateLimitContextProvider(getStatus)`: Factory that creates a `ContextProvider` closure. The closure calls `getStatus()` and formats it as a `## Resource Budget` markdown section.

```typescript
// pattern: Functional Core

import type { ContextProvider } from '../agent/types.js';
import type { RateLimiterConfig, RateLimitStatus } from './types.js';

type RateLimitableConfig = {
  requests_per_minute?: number;
  input_tokens_per_minute?: number;
  output_tokens_per_minute?: number;
  min_output_reserve?: number;
};

type WithRateLimits = {
  requests_per_minute: number;
  input_tokens_per_minute: number;
  output_tokens_per_minute: number;
  min_output_reserve?: number;
};

export function hasRateLimitConfig<T extends RateLimitableConfig>(
  config: T,
): config is T & WithRateLimits {
  return (
    config.requests_per_minute !== undefined &&
    config.input_tokens_per_minute !== undefined &&
    config.output_tokens_per_minute !== undefined
  );
}

export function buildRateLimiterConfig(config: WithRateLimits): RateLimiterConfig {
  return {
    requestsPerMinute: config.requests_per_minute,
    inputTokensPerMinute: config.input_tokens_per_minute,
    outputTokensPerMinute: config.output_tokens_per_minute,
    minOutputReserve: config.min_output_reserve,
  };
}

export function createRateLimitContextProvider(
  getStatus: () => RateLimitStatus,
): ContextProvider {
  return () => {
    const status = getStatus();
    return [
      '## Resource Budget',
      `Input tokens: ${status.inputTokens.remaining}/${status.inputTokens.capacity} remaining this minute`,
      `Output tokens: ${status.outputTokens.remaining}/${status.outputTokens.capacity} remaining this minute`,
      `Queued requests: ${status.queueDepth}`,
    ].join('\n');
  };
}
```

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(rate-limit): add config helpers and context provider factory`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Wire rate limiter into composition root

**Verifies:** rate-limiter.AC2.1, rate-limiter.AC3.1, rate-limiter.AC3.3, rate-limiter.AC5.1

**Files:**
- Modify: `src/index.ts:289` (model provider wrapping)
- Modify: `src/index.ts:295-302` (summarization provider wrapping)
- Modify: `src/index.ts:417-431` (main agent contextProviders)
- Modify: `src/index.ts:438-451` (bluesky agent contextProviders)

**Implementation:**

Add imports to `src/index.ts` (in the import section):

```typescript
import { createRateLimitedProvider } from '@/rate-limit/provider.js';
import { hasRateLimitConfig, buildRateLimiterConfig, createRateLimitContextProvider } from '@/rate-limit/context.js';
import type { ContextProvider } from '@/agent/types.js';
```

After line 289 (`const model = createModelProvider(config.model);`), add conditional wrapping:

```typescript
const rawModel = createModelProvider(config.model);
const contextProviders: Array<ContextProvider> = [];

const model = hasRateLimitConfig(config.model)
  ? (() => {
      const rateLimitedModel = createRateLimitedProvider(
        rawModel,
        buildRateLimiterConfig(config.model),
      );
      contextProviders.push(createRateLimitContextProvider(() => rateLimitedModel.getStatus()));
      console.log(`rate limiting active for model ${config.model.name} (${config.model.requests_per_minute} RPM, ${config.model.input_tokens_per_minute} ITPM, ${config.model.output_tokens_per_minute} OTPM)`);
      return rateLimitedModel;
    })()
  : rawModel;
```

Note: The IIFE is needed because we need to both create the provider and register the context provider in one expression. An alternative is a simple `if` block — the implementor should choose whichever is cleaner.

For the summarization model (lines 295-302), apply the same pattern:

```typescript
const summarizationModel: ModelProvider = config.summarization
  ? (() => {
      const rawSummarizationModel = createModelProvider({
        provider: config.summarization.provider,
        name: config.summarization.name,
        api_key: config.summarization.api_key,
        base_url: config.summarization.base_url,
      });
      if (hasRateLimitConfig(config.summarization)) {
        const rateLimited = createRateLimitedProvider(
          rawSummarizationModel,
          buildRateLimiterConfig(config.summarization),
        );
        console.log(`rate limiting active for summarization model ${config.summarization.name}`);
        return rateLimited;
      }
      return rawSummarizationModel;
    })()
  : model;
```

Note: The summarization model does NOT get a context provider — the spirit only needs to see the primary model's budget. The summarization model runs in the background (compaction) and doesn't need user-visible budget info.

Add `contextProviders` to both agent creation calls:

For the main agent (line 417-431), add `contextProviders` to the dependency object:

```typescript
const agent = createAgent({
  model,
  memory,
  registry,
  runtime,
  persistence,
  config: { ... },
  getExecutionContext,
  compactor,
  contextProviders: contextProviders.length > 0 ? contextProviders : undefined,
});
```

For the bluesky agent (line 438-451), add the same:

```typescript
const blueskyAgent = createAgent({
  model,
  memory,
  registry,
  runtime,
  persistence,
  config: { ... },
  getExecutionContext,
  contextProviders: contextProviders.length > 0 ? contextProviders : undefined,
}, blueskyConversationId);
```

**Testing:**

This phase is primarily integration wiring. Verify via the existing test suite and type checking:

- `bun run build` passes (type check confirms all wiring is correct)
- `bun test` passes (all existing tests unaffected since rate limit config is absent from test configs)
- AC2.1 is verified structurally: each model provider gets its own `createRateLimitedProvider` call with independent buckets
- AC3.3 is verified structurally: when `hasRateLimitConfig` returns false, no context provider is added, so no budget section appears
- AC5.1 is verified structurally: rate limiter wraps the provider above the adapter (which contains retry logic internally)

**Verification:**

Run: `bun run build`
Expected: Type-check passes

Run: `bun test`
Expected: All tests pass

**Commit:** `feat: wire rate limiter into composition root`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Update barrel exports and CLAUDE.md

**Verifies:** None (infrastructure/documentation)

**Files:**
- Modify: `src/rate-limit/index.ts` (add context exports)
- Modify: `src/rate-limit/CLAUDE.md` (update with final module documentation)
- Modify: `src/agent/CLAUDE.md` (document contextProviders field)

**Implementation:**

Add to `src/rate-limit/index.ts`:

```typescript
export { hasRateLimitConfig, buildRateLimiterConfig, createRateLimitContextProvider } from './context.js';
```

Update `src/rate-limit/CLAUDE.md` to include `context.ts` in the Key Files section:

```markdown
- `context.ts` -- Config helpers (`hasRateLimitConfig`, `buildRateLimiterConfig`) and `createRateLimitContextProvider` factory (Functional Core)
```

Also update `src/agent/CLAUDE.md` to document the new `contextProviders` field in the contracts section, noting that `AgentDependencies` now includes an optional `contextProviders?: ReadonlyArray<ContextProvider>` field.

**Verification:**

Run: `bun run build`
Expected: Type-check passes

Run: `bun test`
Expected: All tests pass

**Commit:** `docs: update module documentation for rate limiter integration`

<!-- END_TASK_3 -->
