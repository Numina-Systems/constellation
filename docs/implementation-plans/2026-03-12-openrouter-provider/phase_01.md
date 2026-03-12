# OpenRouter Provider Implementation Plan — Phase 1

**Goal:** Extract OpenAI-format normalization helpers from `openai-compat.ts` into a shared module without changing any behaviour.

**Architecture:** Move five normalization functions into `src/model/openai-shared.ts`, update `openai-compat.ts` to import from the new module, and re-export `normalizeMessages` from `openai-compat.ts` for backward compatibility.

**Tech Stack:** TypeScript, Bun, OpenAI SDK types

**Scope:** 6 phases from original design (phase 1 of 6)

**Codebase verified:** 2026-03-12

---

## Acceptance Criteria Coverage

This phase is an infrastructure/refactoring phase with no acceptance criteria. It is verified operationally: all existing tests pass unchanged and `bun run build` succeeds.

**Verifies: None** (mechanical refactor)

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Create `src/model/openai-shared.ts` with extracted helpers

**Files:**
- Create: `src/model/openai-shared.ts`

**Implementation:**

Create the new shared module containing the five normalization functions extracted from `openai-compat.ts` (lines 34-180). The functions to extract are:

1. `normalizeToolDefinitions` (lines 34-45) — converts internal `ToolDefinition` to OpenAI tool format
2. `normalizeContentBlocks` (lines 47-82) — converts OpenAI response content + tool calls to internal `ContentBlock[]`
3. `normalizeStopReason` (lines 84-97) — maps OpenAI `finish_reason` to canonical `StopReason`
4. `normalizeUsage` (lines 99-104) — maps OpenAI usage stats to internal `UsageStats`
5. `normalizeMessages` (lines 106-180) — converts internal `Message[]` to OpenAI message format

All five functions must be exported. The file pattern annotation should be `// pattern: Functional Core` since these are pure transformations.

Import requirements:
- `OpenAI` from `"openai"` (for OpenAI SDK types used in function signatures)
- `ContentBlock`, `Message`, `TextBlock`, `ToolUseBlock`, `ToolResultBlock`, `ToolDefinition`, `UsageStats` from `"./types.js"`
- `ModelError` from `"./types.js"` (used in `normalizeContentBlocks` for JSON parse error)

The function bodies are moved verbatim — no logic changes.

**Verification:**

Run: `bun run build`
Expected: Type-check succeeds (new file compiles)

**Commit:** `refactor: extract openai normalization helpers to openai-shared.ts`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Update `openai-compat.ts` to import from `openai-shared.ts`

**Files:**
- Modify: `src/model/openai-compat.ts:1-180` (remove function definitions, add imports)

**Implementation:**

1. Remove the five function definitions (lines 34-180) from `openai-compat.ts`
2. Add import statement for all five functions from `"./openai-shared.js"`
3. Re-export `normalizeMessages` from `openai-compat.ts` so existing imports (test file at `openai-compat.test.ts:4`) continue to work:
   ```typescript
   export { normalizeMessages } from "./openai-shared.js";
   ```
4. The remaining code in `openai-compat.ts` (lines 21-32 `isRetryableError`, lines 183-405 `createOpenAICompatAdapter`) stays unchanged
5. Remove type imports that are no longer needed directly (only keep types still used in the adapter body). After extraction, `openai-compat.ts` still needs: `ContentBlock`, `Message`, `ModelProvider`, `ModelRequest`, `ModelResponse`, `StreamEvent`, `TextBlock`, `ToolResultBlock`, `ToolUseBlock`, `ToolDefinition`, `UsageStats` from types (some used transitively via shared helpers, but the adapter body itself references `ModelRequest`, `ModelResponse`, `StreamEvent`, `ModelProvider`). The `TextBlock`, `ToolUseBlock`, `ToolResultBlock`, `ToolDefinition`, `UsageStats` imports can be removed from the direct types import since they're only used by the extracted functions. Keep: `ContentBlock`, `Message`, `ModelProvider`, `ModelRequest`, `ModelResponse`, `StreamEvent`.

**Verification:**

Run: `bun run build`
Expected: Type-check succeeds

Run: `bun test src/model/openai-compat.test.ts`
Expected: All tests pass (the test imports `normalizeMessages` from `./openai-compat.js` which re-exports it)

**Commit:** `refactor: update openai-compat to import from openai-shared`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Verify all tests pass and build succeeds

**Files:**
- No changes

**Verification:**

Run: `bun run build`
Expected: Type-check succeeds with no errors

Run: `bun test src/model/`
Expected: All model tests pass (openai-compat.test.ts, anthropic.test.ts, ollama.test.ts, factory.test.ts, retry.test.ts)

Run: `bun test`
Expected: All project tests pass (896+ pass, only DB connection failures expected)

**Commit:** No commit (verification only)

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
