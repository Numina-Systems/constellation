# Output Loop Detection Implementation Plan - Phase 2

**Goal:** Implement the sliding window and circuit breaker logic with configurable thresholds, action dispatch, and trace recording.

**Architecture:** Functional Core for window logic (pure state transitions), Imperative Shell for detector factory (trace recording side effect). Factory pattern: `createLoopDetector(config, traceRecorder?)` returns `LoopDetector` interface.

**Tech Stack:** TypeScript (Bun runtime), bun:test

**Scope:** 3 phases from original design (phase 2 of 3)

**Codebase verified:** 2026-05-16

---

## Acceptance Criteria Coverage

This phase implements and tests:

### loop-detection.AC2: Sliding Window
- **loop-detection.AC2.1 Success:** Window holds last N responses (configurable, default 5)
- **loop-detection.AC2.2 Success:** Window is FIFO — oldest entry evicted when full
- **loop-detection.AC2.3 Success:** Window is per-conversation, not global
- **loop-detection.AC2.4 Edge:** Fewer responses than window size does not trigger (not enough data)

### loop-detection.AC3: Circuit Breaker Trigger
- **loop-detection.AC3.1 Success:** Three consecutive responses with > 0.85 similarity triggers the breaker (defaults)
- **loop-detection.AC3.2 Success:** Two high-similarity responses followed by a different response resets the consecutive counter
- **loop-detection.AC3.3 Success:** Single high-similarity response does not trigger (needs M consecutive)
- **loop-detection.AC3.4 Edge:** Similarity is computed against each window entry — the maximum pairwise similarity with any window entry is used for the consecutive check

### loop-detection.AC4: Actions
- **loop-detection.AC4.1 Success:** `warn` action injects a system message: "Your recent responses appear repetitive. Try a different approach."
- **loop-detection.AC4.2 Success:** `redirect` action injects the warning message AND appends a hint to use a different tool or strategy
- **loop-detection.AC4.3 Success:** `halt` action ends the current turn and returns an error to the user indicating the agent is stuck
- **loop-detection.AC4.4 Success:** Action is configurable via `loop_detection.action` config field

### loop-detection.AC5: Trace Recording
- **loop-detection.AC5.1 Success:** Circuit breaker activation records a trace with similarity score, consecutive count, and action taken
- **loop-detection.AC5.2 Success:** Trace is recorded via existing `TraceRecorder` interface
- **loop-detection.AC5.3 Edge:** Non-activation (normal responses) does not record a trace

### loop-detection.AC6: Configuration
- **loop-detection.AC6.1 Success:** `loop_detection.enabled` defaults to `true`
- **loop-detection.AC6.2 Success:** `loop_detection.window_size` defaults to 5
- **loop-detection.AC6.3 Success:** `loop_detection.similarity_threshold` defaults to 0.85
- **loop-detection.AC6.4 Success:** `loop_detection.consecutive_trigger` defaults to 3
- **loop-detection.AC6.5 Success:** `loop_detection.action` defaults to `warn`
- **loop-detection.AC6.6 Success:** `loop_detection.enabled = false` disables all detection

---

## Key Context for Implementor

**TraceRecorder interface** (from `src/reflexion/types.ts`):
```typescript
export type TraceRecorder = {
  record(trace: Omit<OperationTrace, 'id' | 'createdAt'>): Promise<void>;
};
```

**OperationTrace fields to provide:**
- `owner: string` — agent identity
- `conversationId: string` — conversation context
- `toolName: string` — use `'loop_detection'`
- `input: Record<string, unknown>` — metadata about the detection
- `outputSummary: string` — human-readable description (max 500 chars)
- `durationMs: number` — use `0` (detection is fast)
- `success: boolean` — use `false` (activation = abnormal event)
- `error: string | null` — describe what triggered

**Fire-and-forget pattern:** Always `.catch(() => {})` on `record()` calls.

**Mock pattern for tests** (from `src/agent/trace-capture.test.ts`):
```typescript
function createMockTraceRecorder() {
  const traces: Array<Omit<OperationTrace, 'id' | 'createdAt'>> = [];
  return {
    recorder: {
      record: async (trace: Omit<OperationTrace, 'id' | 'createdAt'>) => {
        traces.push(trace);
      },
    } satisfies TraceRecorder,
    traces,
  };
}
```

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Sliding window implementation

**Verifies:** None (implementation only — tests in next task)

**Files:**
- Create: `src/loop-detection/window.ts`

**Implementation:**

Create `src/loop-detection/window.ts`:

```typescript
// pattern: Functional Core

import { tokenBigrams } from './bigrams.js';
import { jaccardSimilarity } from './similarity.js';

export type WindowEntry = {
  readonly text: string;
  readonly bigrams: Set<string>;
};

export type WindowCheckResult = {
  readonly triggered: boolean;
  readonly maxSimilarity: number;
  readonly consecutiveCount: number;
};

export type ResponseWindow = {
  push(response: string): void;
  check(threshold: number, consecutiveTrigger: number): WindowCheckResult;
  reset(): void;
  readonly size: number;
};

export function createResponseWindow(windowSize: number): ResponseWindow {
  const entries: Array<WindowEntry> = [];
  let consecutiveHighCount = 0;

  function push(response: string): void {
    const bigrams = tokenBigrams(response);
    entries.push({ text: response, bigrams });
    if (entries.length > windowSize) {
      entries.shift();
    }
  }

  function check(threshold: number, consecutiveTrigger: number): WindowCheckResult {
    if (entries.length < 2) {
      return { triggered: false, maxSimilarity: 0, consecutiveCount: 0 };
    }

    const latest = entries[entries.length - 1]!;
    let maxSimilarity = 0;

    for (let i = 0; i < entries.length - 1; i++) {
      const similarity = jaccardSimilarity(latest.bigrams, entries[i]!.bigrams);
      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
      }
    }

    if (maxSimilarity >= threshold) {
      consecutiveHighCount++;
    } else {
      consecutiveHighCount = 0;
    }

    return {
      triggered: consecutiveHighCount >= consecutiveTrigger,
      maxSimilarity,
      consecutiveCount: consecutiveHighCount,
    };
  }

  function reset(): void {
    entries.length = 0;
    consecutiveHighCount = 0;
  }

  return {
    push,
    check,
    reset,
    get size() { return entries.length; },
  };
}
```

**Verification:**

Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat(loop-detection): add sliding window with consecutive tracking`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Sliding window tests

**Verifies:** loop-detection.AC2.1, loop-detection.AC2.2, loop-detection.AC2.3, loop-detection.AC2.4, loop-detection.AC3.1, loop-detection.AC3.2, loop-detection.AC3.3, loop-detection.AC3.4

**Files:**
- Create: `src/loop-detection/window.test.ts`

**Testing:**

Tests must verify each AC case:

**AC2 (Window behaviour):**
- **AC2.1:** Create window with size 5, push 5 responses, verify all retained. Push 6th, verify size stays at 5.
- **AC2.2:** Push responses beyond capacity, verify oldest is evicted (FIFO). Push [A,B,C] with size 2 — only [B,C] remain.
- **AC2.3:** Create two separate windows — mutations to one don't affect the other (per-conversation isolation is structural, each detector gets its own window).
- **AC2.4:** Push only 1 response, call check — should return triggered: false, consecutiveCount: 0.

**AC3 (Trigger logic):**
- **AC3.1:** Push the same response 4 times (first push + 3 checks). With threshold 0.85 and consecutiveTrigger 3, the 4th push should trigger (3 consecutive high-similarity checks).
- **AC3.2:** Push same response twice (consecutive=2), then push a completely different response. Consecutive counter resets to 0.
- **AC3.3:** Push same response twice (consecutive=1 after second push check). Should NOT trigger with consecutiveTrigger=3.
- **AC3.4:** Push responses where one is similar to an older entry but not the immediately preceding one. Max pairwise similarity against ALL window entries is used.

Follow project testing patterns:
- `describe('loop-detection.AC2.1: Window holds last N responses', ...)`
- Import from `bun:test`
- Annotate with `// pattern: Functional Core`

**Verification:**

Run: `bun test src/loop-detection/window.test.ts`
Expected: All tests pass

**Commit:** `test(loop-detection): add sliding window tests covering AC2 and AC3`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->
<!-- START_TASK_3 -->
### Task 3: Loop detector factory

**Verifies:** None (implementation only — tests in next task)

**Files:**
- Create: `src/loop-detection/detector.ts`

**Implementation:**

Create `src/loop-detection/detector.ts`:

```typescript
// pattern: Imperative Shell

import type { TraceRecorder } from '@/reflexion/types.js';
import type { LoopDetectionConfig, LoopDetectionResult, LoopDetector } from './types.js';
import { createResponseWindow } from './window.js';

export type CreateLoopDetectorOptions = {
  readonly config: LoopDetectionConfig;
  readonly traceRecorder?: TraceRecorder;
  readonly owner?: string;
  readonly conversationId?: string;
};

export function createLoopDetector(options: CreateLoopDetectorOptions): LoopDetector {
  const { config, traceRecorder, owner = 'spirit', conversationId = '' } = options;
  const window = createResponseWindow(config.windowSize);

  function check(response: string): LoopDetectionResult {
    if (!config.enabled) {
      return { triggered: false, similarity: 0, consecutiveCount: 0, action: null };
    }

    window.push(response);
    const result = window.check(config.similarityThreshold, config.consecutiveTrigger);

    if (result.triggered) {
      if (traceRecorder) {
        traceRecorder.record({
          owner,
          conversationId,
          toolName: 'loop_detection',
          input: {
            similarity: result.maxSimilarity,
            consecutiveCount: result.consecutiveCount,
            threshold: config.similarityThreshold,
            consecutiveTrigger: config.consecutiveTrigger,
            action: config.action,
          },
          outputSummary: `Loop detected: ${result.consecutiveCount} consecutive similar responses (similarity: ${(result.maxSimilarity * 100).toFixed(0)}%). Action: ${config.action}`,
          durationMs: 0,
          success: false,
          error: `Circuit breaker triggered: ${config.action}`,
        }).catch(() => {});
      }

      return {
        triggered: true,
        similarity: result.maxSimilarity,
        consecutiveCount: result.consecutiveCount,
        action: config.action,
      };
    }

    return {
      triggered: false,
      similarity: result.maxSimilarity,
      consecutiveCount: result.consecutiveCount,
      action: null,
    };
  }

  function reset(): void {
    window.reset();
  }

  return { check, reset };
}
```

**Verification:**

Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat(loop-detection): add detector factory with trace recording`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Loop detector tests

**Verifies:** loop-detection.AC4.1, loop-detection.AC4.2, loop-detection.AC4.3, loop-detection.AC4.4, loop-detection.AC5.1, loop-detection.AC5.2, loop-detection.AC5.3, loop-detection.AC6.1, loop-detection.AC6.2, loop-detection.AC6.3, loop-detection.AC6.4, loop-detection.AC6.5, loop-detection.AC6.6

**Files:**
- Create: `src/loop-detection/detector.test.ts`

**Testing:**

Tests must verify each AC case:

**AC4 (Actions):**
- **AC4.1:** Configure action `'warn'`. Trigger the breaker. Verify result has `action: 'warn'`. (The action dispatch — injecting messages — happens in the agent loop, Phase 3. Detector just reports which action to take.)
- **AC4.2:** Configure action `'redirect'`. Trigger the breaker. Verify result has `action: 'redirect'`.
- **AC4.3:** Configure action `'halt'`. Trigger the breaker. Verify result has `action: 'halt'`.
- **AC4.4:** Change config.action between tests. Verify each produces the matching action in result.

**AC5 (Trace recording):**
- **AC5.1:** Create detector with mock TraceRecorder. Trigger the breaker. Verify `record()` was called with trace containing similarity score, consecutive count, and action.
- **AC5.2:** Verify the trace was recorded via the `TraceRecorder` interface (mock captures the call).
- **AC5.3:** Create detector with mock TraceRecorder. Push responses that do NOT trigger. Verify `record()` was NOT called.

**AC6 (Configuration):**
- **AC6.1:** Create detector with `DEFAULT_LOOP_DETECTION_CONFIG`. Verify it's enabled by default (non-disabled behaviour when responses are checked).
- **AC6.2-AC6.5:** Verify default config values match: windowSize=5, similarityThreshold=0.85, consecutiveTrigger=3, action='warn'. Test by importing `DEFAULT_LOOP_DETECTION_CONFIG` and asserting field values.
- **AC6.6:** Create detector with `enabled: false`. Push duplicate responses many times. Verify `check()` never returns triggered: true.

**Mock TraceRecorder setup:**
```typescript
function createMockTraceRecorder() {
  const traces: Array<Omit<OperationTrace, 'id' | 'createdAt'>> = [];
  return {
    recorder: {
      record: async (trace: Omit<OperationTrace, 'id' | 'createdAt'>) => {
        traces.push(trace);
      },
    } satisfies TraceRecorder,
    traces,
  };
}
```

Import `TraceRecorder` type from `@/reflexion/types.js` and `OperationTrace` for the Omit type.

Follow project testing patterns:
- `describe('loop-detection.AC4.1: warn action', ...)`
- Import from `bun:test`
- Annotate with `// pattern: Imperative Shell` (tests an imperative shell component)

**Verification:**

Run: `bun test src/loop-detection/detector.test.ts`
Expected: All tests pass

**Commit:** `test(loop-detection): add detector tests covering AC4, AC5, AC6`

<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_5 -->
### Task 5: Update barrel export

**Verifies:** None (infrastructure)

**Files:**
- Modify: `src/loop-detection/index.ts`

**Implementation:**

Update `src/loop-detection/index.ts` to include window and detector exports:

```typescript
// pattern: Imperative Shell (barrel export)

export type {
  LoopDetectionAction,
  LoopDetectionConfig,
  LoopDetectionResult,
  LoopDetector,
} from './types.js';
export { DEFAULT_LOOP_DETECTION_CONFIG } from './types.js';
export { tokenBigrams } from './bigrams.js';
export { jaccardSimilarity } from './similarity.js';
export type { WindowEntry, WindowCheckResult, ResponseWindow } from './window.js';
export { createResponseWindow } from './window.js';
export type { CreateLoopDetectorOptions } from './detector.js';
export { createLoopDetector } from './detector.js';
```

**Verification:**

Run: `bun run build`
Expected: Type-checks without errors

Run: `bun test src/loop-detection/`
Expected: All loop-detection tests pass

**Commit:** `feat(loop-detection): update barrel export with window and detector`

<!-- END_TASK_5 -->
