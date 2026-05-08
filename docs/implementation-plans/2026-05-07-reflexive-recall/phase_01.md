# Reflexive Recall Implementation Plan

**Goal:** Define recall types and implement message decomposition into semantic queries and named entities via the utility model.

**Architecture:** Functional Core module with pure parsing functions and a thin async wrapper for model calls. Follows same patterns as `src/compaction/` and `src/search/`.

**Tech Stack:** TypeScript, Bun, Anthropic SDK (via existing ModelProvider)

**Scope:** 5 phases from original design (phases 1-5)

**Codebase verified:** 2026-05-07

---

## Acceptance Criteria Coverage

This phase implements and tests:

### reflexive-recall.AC1: Decomposition
- **reflexive-recall.AC1.1 Success:** Message "Tell me about the CalDAV project" produces queries like ["CalDAV project"] and entities like ["CalDAV"]
- **reflexive-recall.AC1.2 Success:** Multi-topic message produces 2-4 distinct queries covering each topic
- **reflexive-recall.AC1.3 Edge:** Single-word message produces one query containing that word
- **reflexive-recall.AC1.4 Edge:** Message with no proper nouns produces empty entities array

### reflexive-recall.AC5: Fallback Cascade (partial — decomposition fallbacks only)
- **reflexive-recall.AC5.1 Success:** Utility model failure falls back to raw message as single hybrid search query
- **reflexive-recall.AC5.2 Success:** Malformed JSON from utility model triggers same fallback

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Recall types

**Verifies:** None (type-only, compiler verifies)

**Files:**
- Create: `src/recall/types.ts`

**Implementation:**

```typescript
// pattern: Functional Core

import type { SearchDomainName } from '@/search/types.js';

export type DecompositionResult = {
  readonly queries: ReadonlyArray<string>;
  readonly entities: ReadonlyArray<string>;
};

export type RecallFragment = {
  readonly id: string;
  readonly label: string;
  readonly domain: SearchDomainName;
  readonly content: string;
  readonly score: number;
  readonly source: 'semantic' | 'entity';
  readonly tier: string | null;
};

export type RecallResult = {
  readonly fragments: ReadonlyArray<RecallFragment>;
  readonly totalTokens: number;
  readonly queryCount: number;
  readonly elapsed: number;
};
```

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/reflexive-recall && bun run build`
Expected: Type-check passes with no errors

**Commit:** `feat(recall): add recall domain types`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Decomposition module

**Verifies:** reflexive-recall.AC1.1, reflexive-recall.AC1.2, reflexive-recall.AC1.3, reflexive-recall.AC1.4, reflexive-recall.AC5.1, reflexive-recall.AC5.2

**Files:**
- Create: `src/recall/decompose.ts`
- Test: `src/recall/decompose.test.ts` (unit)

**Implementation:**

Create `src/recall/decompose.ts` with two exported functions:

1. `parseDecompositionResponse(raw: string): DecompositionResult` — Pure function that parses the model's JSON response. Expects `{ "queries": [...], "entities": [...] }`. On parse failure or malformed structure, returns the fallback: `{ queries: [], entities: [] }`.

2. `decomposeMessage(message: string, model: ModelProvider, modelName: string): Promise<DecompositionResult>` — Calls `model.complete()` with a system prompt instructing the model to extract 1-4 semantic queries (2-6 word topic phrases) and named entities (proper nouns) from the user message. Returns parsed result. On model failure (thrown error), returns `{ queries: [], entities: [] }`.

   **Convention:** Empty `queries` AND empty `entities` is the failure signal. The orchestrator (Phase 3) interprets this as "decomposition failed, fall back to raw message as query." A valid decomposition always produces at least one query (the message itself distilled). This convention avoids needing a separate error type while keeping the return type simple.

The system prompt for decomposition should instruct:
- Extract 1-4 short semantic queries (2-6 words each) that capture the topics in the message
- Extract named entities (proper nouns, project names, people, tools)
- Return valid JSON: `{ "queries": ["..."], "entities": ["..."] }`
- If the message is too short or unclear, return fewer queries

Model call pattern (follow `src/compaction/prompt.ts` style):
- Use `model.complete({ messages: [...], system: DECOMPOSE_SYSTEM_PROMPT, model: modelName, max_tokens: 256, temperature: 0 })`
- Extract text content from response `content[0]` (type `text`)
- Pass to `parseDecompositionResponse()`

**Testing:**

Tests must verify each AC listed above:
- reflexive-recall.AC1.1: Parse valid JSON with queries and entities, verify correct extraction for a CalDAV-style message
- reflexive-recall.AC1.2: Parse response with multiple queries covering distinct topics
- reflexive-recall.AC1.3: Verify single-word input produces a single query containing that word (test the full `decomposeMessage` with a mock model that returns appropriate JSON)
- reflexive-recall.AC1.4: Verify a message with no proper nouns produces empty entities array
- reflexive-recall.AC5.1: When model.complete() throws, decomposeMessage returns empty result `{ queries: [], entities: [] }`
- reflexive-recall.AC5.2: When model returns invalid JSON (e.g., plain text, truncated JSON, missing fields), parseDecompositionResponse returns empty result

Mock `ModelProvider` as a plain object with a `complete` method (same pattern as `src/compaction/compactor.test.ts`).

Follow project testing conventions: colocated `*.test.ts`, `bun test`, `expect()` assertions, `describe` blocks referencing ACs.

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/reflexive-recall && bun test src/recall/decompose.test.ts`
Expected: All tests pass

**Commit:** `feat(recall): implement message decomposition with fallback parsing`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Barrel export

**Verifies:** None (infrastructure)

**Files:**
- Create: `src/recall/index.ts`

**Implementation:**

```typescript
// pattern: Functional Core (barrel export)

export type { DecompositionResult, RecallFragment, RecallResult } from './types.js';
export { decomposeMessage, parseDecompositionResponse } from './decompose.js';
```

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/reflexive-recall && bun run build`
Expected: Type-check passes

**Commit:** `feat(recall): add barrel export`
<!-- END_TASK_3 -->
