# Output Loop Detection Implementation Plan - Phase 1

**Goal:** Implement bigram tokenisation and Jaccard similarity as pure, testable functions with supporting types.

**Architecture:** Functional Core pure functions — no I/O, no side effects. Token bigrams provide the feature extraction, Jaccard similarity provides the comparison metric.

**Tech Stack:** TypeScript (Bun runtime), bun:test

**Scope:** 3 phases from original design (phase 1 of 3)

**Codebase verified:** 2026-05-16

---

## Acceptance Criteria Coverage

This phase implements and tests:

### loop-detection.AC1: Similarity Computation
- **loop-detection.AC1.1 Success:** Exact duplicate responses produce similarity score of 1.0
- **loop-detection.AC1.2 Success:** Completely different responses produce similarity score < 0.2
- **loop-detection.AC1.3 Success:** Paraphrased responses ("I don't know how to do that" vs "I'm not sure how to do that") produce score > 0.7
- **loop-detection.AC1.4 Edge:** Empty response compared to non-empty produces score of 0.0
- **loop-detection.AC1.5 Edge:** Two empty responses produce score of 1.0

### loop-detection.AC7: False Positive Resistance
- **loop-detection.AC7.1 Success:** Responses that share a common prefix but diverge in content (e.g., step-by-step instructions) score below threshold
- **loop-detection.AC7.2 Success:** Tool call responses with different arguments but same tool name score below threshold

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Types and bigram tokeniser

**Verifies:** None (types and infrastructure)

**Files:**
- Create: `src/loop-detection/types.ts`
- Create: `src/loop-detection/bigrams.ts`

**Implementation:**

Create `src/loop-detection/types.ts`:

```typescript
// pattern: Functional Core

export type LoopDetectionAction = 'warn' | 'redirect' | 'halt';

export type LoopDetectionConfig = {
  readonly enabled: boolean;
  readonly windowSize: number;
  readonly similarityThreshold: number;
  readonly consecutiveTrigger: number;
  readonly action: LoopDetectionAction;
};

export type LoopDetectionResult = {
  readonly triggered: boolean;
  readonly similarity: number;
  readonly consecutiveCount: number;
  readonly action: LoopDetectionAction | null;
};

export type LoopDetector = {
  check(response: string): LoopDetectionResult;
  reset(): void;
};

export const DEFAULT_LOOP_DETECTION_CONFIG: LoopDetectionConfig = {
  enabled: true,
  windowSize: 5,
  similarityThreshold: 0.85,
  consecutiveTrigger: 3,
  action: 'warn',
};
```

Create `src/loop-detection/bigrams.ts`:

```typescript
// pattern: Functional Core

export function tokenBigrams(text: string): Set<string> {
  const tokens = text.toLowerCase().split(/\s+/).filter(t => t.length > 0);
  if (tokens.length < 2) return new Set(tokens.length === 1 ? [tokens[0]!] : []);
  const bigrams = new Set<string>();
  for (let i = 0; i < tokens.length - 1; i++) {
    bigrams.add(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return bigrams;
}
```

**Verification:**

Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat(loop-detection): add types and bigram tokeniser`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Bigram tokeniser tests

**Verifies:** loop-detection.AC1.4 (partial — empty input produces empty set)

**Files:**
- Create: `src/loop-detection/bigrams.test.ts`

**Testing:**

Tests must verify:
- Empty string produces empty set
- Single word produces a set with just that word (no bigram possible)
- Two words produce one bigram
- Multiple words produce correct bigrams (e.g., "the cat sat" → {"the cat", "cat sat"})
- Case normalisation: "The Cat" and "the cat" produce identical bigrams
- Punctuation attached to words is preserved (bigrams are whitespace-split)
- Multiple spaces / irregular whitespace are handled (split on \s+)

Follow project testing patterns:
- Use `describe()` blocks with AC references where applicable
- Use `it()` for individual cases
- Import from `bun:test`
- Colocate test file with source: `src/loop-detection/bigrams.test.ts`
- Annotate with `// pattern: Functional Core`

**Verification:**

Run: `bun test src/loop-detection/bigrams.test.ts`
Expected: All tests pass

**Commit:** `test(loop-detection): add bigram tokeniser tests`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->
<!-- START_TASK_3 -->
### Task 3: Jaccard similarity function

**Verifies:** None (implementation only — tests in next task)

**Files:**
- Create: `src/loop-detection/similarity.ts`

**Implementation:**

Create `src/loop-detection/similarity.ts`:

```typescript
// pattern: Functional Core

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1.0;
  if (a.size === 0 || b.size === 0) return 0.0;

  let intersectionSize = 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;

  for (const item of smaller) {
    if (larger.has(item)) intersectionSize++;
  }

  const unionSize = a.size + b.size - intersectionSize;
  return intersectionSize / unionSize;
}
```

**Verification:**

Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat(loop-detection): add Jaccard similarity function`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Jaccard similarity tests

**Verifies:** loop-detection.AC1.1, loop-detection.AC1.2, loop-detection.AC1.3, loop-detection.AC1.4, loop-detection.AC1.5, loop-detection.AC7.1, loop-detection.AC7.2

**Files:**
- Create: `src/loop-detection/similarity.test.ts`

**Testing:**

Tests must verify each AC case:
- **loop-detection.AC1.1:** Identical sets produce 1.0 (exact duplicate text → same bigrams → score 1.0)
- **loop-detection.AC1.2:** Disjoint sets produce 0.0 (completely different text → no shared bigrams → score 0.0). Verify score < 0.2 for realistically different sentences.
- **loop-detection.AC1.3:** Paraphrased text produces > 0.7. Use design examples: "I don't know how to do that" vs "I'm not sure how to do that" — tokenise both, compute Jaccard, assert > 0.7
- **loop-detection.AC1.4:** Empty set vs non-empty set produces 0.0. Use `tokenBigrams("")` vs `tokenBigrams("hello world")`.
- **loop-detection.AC1.5:** Two empty sets produce 1.0. Use `tokenBigrams("")` vs `tokenBigrams("")`.

**loop-detection.AC7.1 (False positive — common prefix divergence):**
- Two responses that share a common prefix but diverge in content should score below 0.85. Example: "Step 1: Open the terminal and navigate to the project directory. Then run the build command." vs "Step 1: Open the terminal and navigate to the project directory. Then check the test results for failures." — shared prefix generates some bigrams but divergent tails keep score below threshold.

**loop-detection.AC7.2 (False positive — same tool name, different args):**
- Two tool call serialisations with the same tool name but different arguments should score below 0.85. Example: `memory_write {"key": "user_name", "value": "Alice"}` vs `memory_write {"key": "project_deadline", "value": "2026-06-01"}` — tool name overlap is small relative to argument content.

Additional cases:
- Partial overlap: known sets with calculable intersection (e.g., {a,b,c} ∩ {b,c,d} = 2/4 = 0.5)
- Single-element sets: {a} vs {a} = 1.0, {a} vs {b} = 0.0

Follow project testing patterns:
- `describe('loop-detection.AC1.1: Exact duplicate responses produce similarity score of 1.0', ...)`
- Import `tokenBigrams` from `./bigrams.js` to compose end-to-end assertions
- Annotate with `// pattern: Functional Core`

**Verification:**

Run: `bun test src/loop-detection/similarity.test.ts`
Expected: All tests pass

**Commit:** `test(loop-detection): add Jaccard similarity tests covering AC1`

<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_5 -->
### Task 5: Barrel export

**Verifies:** None (infrastructure)

**Files:**
- Create: `src/loop-detection/index.ts`

**Implementation:**

Create `src/loop-detection/index.ts`:

```typescript
// pattern: Functional Core (barrel export)

export type {
  LoopDetectionAction,
  LoopDetectionConfig,
  LoopDetectionResult,
  LoopDetector,
} from './types.js';
export { DEFAULT_LOOP_DETECTION_CONFIG } from './types.js';
export { tokenBigrams } from './bigrams.js';
export { jaccardSimilarity } from './similarity.js';
```

**Verification:**

Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat(loop-detection): add barrel export`

<!-- END_TASK_5 -->
