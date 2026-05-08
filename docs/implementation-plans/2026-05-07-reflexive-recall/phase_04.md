# Reflexive Recall Implementation Plan

**Goal:** Inject recalled context into the system prompt via a stateful `ContextProvider`.

**Architecture:** Functional Core module with a factory function that returns a `ContextProvider` with a `setResult()` state-setter. The agent loop calls `setResult()` each turn before `buildSystemPrompt()` evaluates the provider. Follows patterns from `src/reflexion/context-provider.ts` and `src/subconscious/context.ts`.

**Tech Stack:** TypeScript, Bun

**Scope:** 5 phases from original design (phases 1-5)

**Codebase verified:** 2026-05-07

---

## Acceptance Criteria Coverage

This phase implements and tests:

### reflexive-recall.AC7: Prompt Injection
- **reflexive-recall.AC7.1 Success:** Recalled context section appears via `ContextProvider`, after core memory and before skills
- **reflexive-recall.AC7.2 Success:** Each fragment rendered with label/domain header and content, no score metadata
- **reflexive-recall.AC7.3 Success:** Absent recall result produces no section in prompt

### reflexive-recall.AC4: Token Budget (partial)
- **reflexive-recall.AC4.3 Edge:** Zero matching documents produces no system prompt section

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Context provider implementation

**Verifies:** reflexive-recall.AC7.1, reflexive-recall.AC7.2, reflexive-recall.AC7.3, reflexive-recall.AC4.3

**Files:**
- Create: `src/recall/context.ts`
- Test: `src/recall/context.test.ts` (unit)

**Implementation:**

Create `src/recall/context.ts` with pattern annotation `// pattern: Functional Core`.

Two exports:

1. **`formatRecallSection(result: RecallResult): string`** — Pure function that renders the recall section.

   Format each fragment as:
   ```
   ### [label | domain]
   content
   ```

   Wrap all fragments in a section header:
   ```
   ## Recalled Context
   
   ### [personality | memory]
   This is the content of the fragment...
   
   ### [2024-01-15 conversation | conversations]
   Another fragment's content...
   ```

   No score metadata in output (AC7.2).

2. **`createRecallContextProvider(): ContextProvider & RecallContextState`** — Factory function.

   ```typescript
   import type { ContextProvider } from '@/agent/types.js';
   import type { RecallResult } from './types.js';

   export type RecallContextState = {
     setResult(result: RecallResult | null): void;
   };

   export function createRecallContextProvider(): ContextProvider & RecallContextState {
     let currentResult: RecallResult | null = null;

     const provider = (() => {
       if (!currentResult || currentResult.fragments.length === 0) {
         return undefined;
       }
       return formatRecallSection(currentResult);
     }) as ContextProvider & RecallContextState;

     provider.setResult = (result: RecallResult | null) => {
       currentResult = result;
     };

     return provider;
   }
   ```

   The provider returns `undefined` when no result is set or when fragments are empty (AC7.3, AC4.3). This means `buildSystemPrompt()` will skip appending any section.

**Testing:**

Tests must verify:
- reflexive-recall.AC7.1: Create provider, set a result with fragments, call provider function → verify it returns a string containing `## Recalled Context` header
- reflexive-recall.AC7.2: Verify fragment rendering includes `### [label | domain]` header and content text, and does NOT include score values
- reflexive-recall.AC7.3: Create provider, don't set result → verify returns `undefined`. Also: set result to `null` → verify returns `undefined`
- reflexive-recall.AC4.3: Create provider, set result with empty fragments array → verify returns `undefined`

Additional tests for `formatRecallSection()`:
- Single fragment renders correctly
- Multiple fragments each get their own `### [label | domain]` header
- Fragment with null tier renders without tier info (just label and domain)
- Fragment from memory domain vs conversations domain both render correctly

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/reflexive-recall && bun test src/recall/context.test.ts`
Expected: All tests pass

**Commit:** `feat(recall): implement recall context provider with stateful result setter`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Update barrel export

**Verifies:** None (infrastructure)

**Files:**
- Modify: `src/recall/index.ts`

**Implementation:**

Add context provider exports to the barrel:

```typescript
export { createRecallContextProvider, formatRecallSection } from './context.js';
export type { RecallContextState } from './context.js';
```

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/reflexive-recall && bun run build`
Expected: Type-check passes

**Commit:** `feat(recall): export context provider from barrel`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->
