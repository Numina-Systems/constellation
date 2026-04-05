# OpenRouter Provider Implementation Plan — Phase 4

**Goal:** Implement the OpenRouter adapter's `complete()` method with custom fetch header interception, cost logging, rate limit sync, attribution headers, and provider routing.

**Architecture:** New `src/model/openrouter.ts` adapter using the OpenAI SDK with a custom `fetch` wrapper that intercepts response headers (cost, rate limits) before the SDK processes the body. Uses shared normalization helpers from `openai-shared.ts`.

**Tech Stack:** TypeScript, Bun, OpenAI SDK (custom fetch), OpenRouter API

**Scope:** 6 phases from original design (phase 4 of 6)

**Codebase verified:** 2026-03-12

---

## Acceptance Criteria Coverage

This phase implements and tests:

### openrouter-provider.AC2: Adapter implements ModelProvider
- **openrouter-provider.AC2.1 Success:** `complete()` returns normalized `ModelResponse` with correct content blocks, stop reason, and usage stats
- **openrouter-provider.AC2.2 Success:** `complete()` normalizes tool use responses (tool call ID, name, arguments)
- **openrouter-provider.AC2.3 Success:** `complete()` extracts `reasoning_content` when present

### openrouter-provider.AC3: Cost logging
- **openrouter-provider.AC3.1 Success:** After `complete()`, cost is logged at info level as `[openrouter] cost=$X model=Y tokens=I/O`

### openrouter-provider.AC5: Attribution headers
- **openrouter-provider.AC5.1 Success:** When `referer` is configured, `HTTP-Referer` header is sent with requests
- **openrouter-provider.AC5.2 Success:** When `title` is configured, `X-Title` header is sent with requests

### openrouter-provider.AC6: Provider routing
- **openrouter-provider.AC6.1 Success:** When `sort` is configured, `provider.sort` is included in request body
- **openrouter-provider.AC6.2 Success:** When `allow_fallbacks` is configured, `provider.allow_fallbacks` is included in request body

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Create `src/model/openrouter.ts` with `createOpenRouterAdapter` and `complete()`

**Verifies:** openrouter-provider.AC2.1, openrouter-provider.AC2.2, openrouter-provider.AC2.3, openrouter-provider.AC3.1, openrouter-provider.AC5.1, openrouter-provider.AC5.2, openrouter-provider.AC6.1, openrouter-provider.AC6.2

**Files:**
- Create: `src/model/openrouter.ts`

**Implementation:**

Create the OpenRouter adapter following the existing adapter patterns (`openai-compat.ts`, `anthropic.ts`).

Pattern annotation: `// pattern: Imperative Shell`

**Imports:**
```typescript
import OpenAI from "openai";
import type { ModelConfig } from "../config/schema.js";
import type { ModelProvider, ModelRequest, ModelResponse, StreamEvent } from "./types.js";
import type { ServerRateLimitSync } from "../rate-limit/types.js";
import { ModelError } from "./types.js";
import { callWithRetry } from "./retry.js";
import {
  normalizeMessages,
  normalizeToolDefinitions,
  normalizeContentBlocks,
  normalizeStopReason,
  normalizeUsage,
} from "./openai-shared.js";
```

**Config type:**
The adapter needs access to OpenRouter-specific config. Since `ModelConfig` now includes the optional `openrouter` field (from Phase 2), the factory function signature is:
```typescript
export function createOpenRouterAdapter(
  config: ModelConfig,
  onServerRateLimit?: ServerRateLimitSync,
): ModelProvider {
```

**Custom fetch wrapper:**
Create a closure that captures the last response headers:
```typescript
let lastResponseHeaders: Headers | null = null;

const customFetch: typeof fetch = async (input, init) => {
  // Inject attribution headers into the request
  const headers = new Headers(init?.headers);
  if (config.openrouter?.referer) {
    headers.set("HTTP-Referer", config.openrouter.referer);
  }
  if (config.openrouter?.title) {
    headers.set("X-Title", config.openrouter.title);
  }

  const response = await fetch(input, { ...init, headers });
  lastResponseHeaders = response.headers;
  return response;
};
```

**OpenAI client construction:**
```typescript
const apiKey = config.api_key || "unused";
const client = new OpenAI({
  apiKey,
  baseURL: config.base_url ?? "https://openrouter.ai/api/v1",
  fetch: customFetch,
});
```

**Header extraction helper:**
```typescript
function extractAndLogHeaders(model: string, usage: { input_tokens: number; output_tokens: number }): void {
  if (!lastResponseHeaders) return;

  const cost = lastResponseHeaders.get("x-openrouter-cost");
  if (cost) {
    console.info(`[openrouter] cost=$${cost} model=${model} tokens=${usage.input_tokens}/${usage.output_tokens}`);
  }

  if (onServerRateLimit) {
    const limit = lastResponseHeaders.get("x-ratelimit-limit");
    const remaining = lastResponseHeaders.get("x-ratelimit-remaining");
    const reset = lastResponseHeaders.get("x-ratelimit-reset");

    if (limit && remaining && reset) {
      onServerRateLimit({
        limit: parseInt(limit, 10),
        remaining: parseInt(remaining, 10),
        resetAt: parseInt(reset, 10), // OpenRouter sends Unix timestamp in milliseconds (13-digit format)
      });
    }
  }
}
```

**Error classification:**
Follow the same pattern as `openai-compat.ts` (lines 213-235):
```typescript
function classifyError(error: unknown): never {
  if (error instanceof OpenAI.AuthenticationError) {
    throw new ModelError("auth", false, error.message || "authentication failed");
  }
  if (error instanceof OpenAI.RateLimitError) {
    throw new ModelError("rate_limit", true, error.message || "rate limit exceeded");
  }
  if (error instanceof OpenAI.APIError) {
    throw new ModelError("api_error", false, error.message || "api error");
  }
  throw error;
}
```

**Retry predicate:**
Same as `openai-compat.ts` (lines 21-32):
```typescript
function isRetryableError(error: unknown): boolean {
  if (error instanceof OpenAI.RateLimitError) return true;
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("timeout") || message.includes("econnrefused")) return true;
  }
  return false;
}
```

**`complete()` method:**
Follow the `openai-compat.ts` pattern but with OpenRouter-specific additions:

1. Build messages array with system prompt + normalized messages (same as openai-compat lines 195-204)
2. Build request body including provider routing params:
   ```typescript
   const body: Record<string, unknown> = {
     model: request.model,
     max_tokens: request.max_tokens,
     tools: request.tools ? normalizeToolDefinitions(request.tools) : undefined,
     temperature: request.temperature,
     messages,
   };

   // Add OpenRouter provider routing
   if (config.openrouter?.sort || config.openrouter?.allow_fallbacks !== undefined) {
     body.provider = {
       ...(config.openrouter.sort ? { sort: config.openrouter.sort } : {}),
       ...(config.openrouter.allow_fallbacks !== undefined ? { allow_fallbacks: config.openrouter.allow_fallbacks } : {}),
     };
   }
   ```
3. Call `client.chat.completions.create()` with the body, wrapped in `callWithRetry`
4. After response, extract reasoning_content, normalize content blocks/stop reason/usage (same as openai-compat lines 239-256)
5. Call `extractAndLogHeaders()` with model and usage

**`stream()` method:**
Return a placeholder that throws for now — Phase 5 implements it:
```typescript
async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
  throw new ModelError("api_error", false, "streaming not yet implemented for openrouter adapter");
}
```

**Verification:**

Run: `bun run build`
Expected: Type-check succeeds

**Commit:** `feat: add openrouter adapter with complete() method`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: OpenRouter adapter tests for `complete()`

**Verifies:** openrouter-provider.AC2.1, openrouter-provider.AC2.2, openrouter-provider.AC2.3, openrouter-provider.AC3.1, openrouter-provider.AC5.1, openrouter-provider.AC5.2, openrouter-provider.AC6.1, openrouter-provider.AC6.2

**Files:**
- Create: `src/model/openrouter.test.ts`

**Implementation:**

Create tests using `bun:test`.

**Test strategy: Local `Bun.serve()` mock server.** Start a local HTTP server in `beforeAll()` that captures incoming requests (headers, body) and returns configurable responses with custom headers. Pass the server's URL as `base_url` in the adapter config. This approach:
- Avoids mutating `globalThis.fetch`
- Provides real request/response inspection
- Works naturally with the adapter's custom fetch wrapper
- Supports both streaming and non-streaming responses

The mock server should:
1. Capture each request's headers and parsed JSON body into a `lastRequest` variable
2. Return configurable response bodies (text completion, tool calls, reasoning_content)
3. Set configurable response headers (`x-openrouter-cost`, `x-ratelimit-*`)
4. Be cleaned up in `afterAll()`

This lets tests verify both outgoing request shape (attribution headers, provider routing in body) and incoming response normalization.

Tests must verify each AC:
- openrouter-provider.AC2.1: Mock a completion response with text content, verify `ModelResponse` has correct `content` blocks, `stop_reason`, and `usage`
- openrouter-provider.AC2.2: Mock a response with tool calls, verify tool call ID, name, and parsed arguments in content blocks
- openrouter-provider.AC2.3: Mock a response with `reasoning_content` field on the choice message, verify it appears in `ModelResponse.reasoning_content`
- openrouter-provider.AC3.1: Mock response with `x-openrouter-cost` header, capture `console.info` output, verify log format matches `[openrouter] cost=$X model=Y tokens=I/O`
- openrouter-provider.AC5.1: Capture the request headers sent by the adapter when `referer` is configured, verify `HTTP-Referer` is present
- openrouter-provider.AC5.2: Capture the request headers sent by the adapter when `title` is configured, verify `X-Title` is present
- openrouter-provider.AC6.1: Capture the request body, verify `provider.sort` is included when `sort` is configured
- openrouter-provider.AC6.2: Capture the request body, verify `provider.allow_fallbacks` is included when configured

Follow the project's testing pattern: colocated test file, `describe`/`it` blocks, environment-gated integration tests for real API calls (skipped if no `OPENROUTER_API_KEY`).

**Verification:**

Run: `bun test src/model/openrouter.test.ts`
Expected: All tests pass

**Commit:** `test: add openrouter adapter complete() tests`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->
