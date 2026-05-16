# Output Loop Detection Design

## Summary

Constellation's agent loop has no circuit breaker for repetitive output. When the model gets stuck — repeating the same tool call, producing near-identical responses, or cycling through the same reasoning pattern — it burns tokens and time with no escape hatch. This is a known failure mode in agentic systems where the model lacks sufficient grounding to make progress but doesn't recognise the stall.

Output Loop Detection adds a lightweight post-response check that compares each agent response against a sliding window of recent responses using token-bigram Jaccard similarity. When consecutive responses exceed a configurable similarity threshold, a circuit breaker fires. The breaker can warn the model (inject a system message), redirect it (force a different action), or halt the turn with an error.

The similarity metric is deliberately cheap — no embeddings, no model calls. Jaccard on token bigrams runs in microseconds and catches both exact duplicates and paraphrased repetitions. The feature integrates with the existing agent loop post-response hook and records activations as operation traces.

## Definition of Done

1. After each agent response, similarity is computed against a sliding window of recent responses.
2. When M consecutive responses exceed the similarity threshold, the circuit breaker activates.
3. Circuit breaker actions are configurable: warn (inject message), redirect (force tool change), or halt (end turn with error).
4. Activations are recorded via `TraceRecorder` for diagnostics.
5. The feature is enabled by default with conservative thresholds to avoid false positives.
6. Legitimately similar but meaningfully different responses do not trigger false positives.

## Acceptance Criteria

### loop-detection.AC1: Similarity Computation
- **loop-detection.AC1.1 Success:** Exact duplicate responses produce similarity score of 1.0
- **loop-detection.AC1.2 Success:** Completely different responses produce similarity score < 0.2
- **loop-detection.AC1.3 Success:** Paraphrased responses ("I don't know how to do that" vs "I'm not sure how to do that") produce score > 0.7
- **loop-detection.AC1.4 Edge:** Empty response compared to non-empty produces score of 0.0
- **loop-detection.AC1.5 Edge:** Two empty responses produce score of 1.0

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

### loop-detection.AC7: False Positive Resistance
- **loop-detection.AC7.1 Success:** Responses that share a common prefix but diverge in content (e.g., step-by-step instructions) score below threshold
- **loop-detection.AC7.2 Success:** Tool call responses with different arguments but same tool name score below threshold
- **loop-detection.AC7.3 Success:** Responses containing large quoted blocks (user message echo) are compared on agent-generated content only, not quoted portions

## Architecture

### Components

**Bigram Tokeniser** (`src/loop-detection/bigrams.ts`, Functional Core) — Pure function `tokenBigrams(text: string): Set<string>` that lowercases, splits on whitespace, and produces bigram pairs. Cheap and deterministic.

**Jaccard Similarity** (`src/loop-detection/similarity.ts`, Functional Core) — Pure function `jaccardSimilarity(a: Set<string>, b: Set<string>): number` that computes `|A ∩ B| / |A ∪ B|`. Returns 0.0 for empty sets compared to non-empty, 1.0 for two empty sets.

**Response Window** (`src/loop-detection/window.ts`, Functional Core) — Stateful but pure-logic sliding window. `push(response)` adds to window, `checkLoop(threshold, consecutive)` returns whether the breaker should fire. Returns the max similarity score and consecutive count.

**Loop Detector** (`src/loop-detection/detector.ts`, Imperative Shell) — `createLoopDetector(config, traceRecorder?)` factory. Wraps the window logic, dispatches configured action on trigger, records traces. Exposes `check(response: string): LoopDetectionResult`.

**Agent Integration** — The detector is called after each model response in the agent loop. If the result indicates a trigger, the configured action is executed before the next turn.

### Contracts

```typescript
// src/loop-detection/types.ts

type LoopDetectionConfig = {
  readonly enabled: boolean;            // default true
  readonly windowSize: number;          // default 5
  readonly similarityThreshold: number; // default 0.85
  readonly consecutiveTrigger: number;  // default 3
  readonly action: 'warn' | 'redirect' | 'halt';  // default 'warn'
};

type LoopDetectionResult = {
  readonly triggered: boolean;
  readonly similarity: number;
  readonly consecutiveCount: number;
  readonly action: 'warn' | 'redirect' | 'halt' | null;
};

interface LoopDetector {
  check(response: string): LoopDetectionResult;
  reset(): void;
}
```

```typescript
// src/loop-detection/bigrams.ts

function tokenBigrams(text: string): Set<string>;
```

```typescript
// src/loop-detection/similarity.ts

function jaccardSimilarity(a: Set<string>, b: Set<string>): number;
```

```typescript
// src/loop-detection/detector.ts

function createLoopDetector(
  config: LoopDetectionConfig,
  traceRecorder?: TraceRecorder,
): LoopDetector;
```

### Similarity Strategy

Jaccard on token bigrams was chosen over alternatives for specific reasons:

- **Embedding similarity** — Too expensive. Recall already uses the embedding provider per-turn; loop detection should be free.
- **Levenshtein / edit distance** — O(n*m) on raw strings is too slow for long responses. Bigram Jaccard is O(n) tokenisation + O(min(|A|,|B|)) intersection.
- **Exact match** — Catches only identical responses, misses paraphrased loops which are the more common failure mode.
- **Token unigrams** — Too coarse. "The cat sat" and "Sat the cat" would score 1.0. Bigrams preserve word-order signal.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Similarity Primitives

**Goal:** Implement bigram tokenisation and Jaccard similarity as pure, testable functions.

**Components:**
- `src/loop-detection/types.ts` (Functional Core) — `LoopDetectionConfig`, `LoopDetectionResult`, `LoopDetector` interface
- `src/loop-detection/bigrams.ts` (Functional Core) — `tokenBigrams()` function
- `src/loop-detection/similarity.ts` (Functional Core) — `jaccardSimilarity()` function
- `src/loop-detection/bigrams.test.ts` — Tests for tokenisation edge cases (empty, single word, punctuation, case normalisation)
- `src/loop-detection/similarity.test.ts` — Tests for exact match (1.0), disjoint (0.0), partial overlap, empty set handling

**Dependencies:** None

**Covers:** loop-detection.AC1 (similarity computation)

**Done when:** Bigram tokenisation and Jaccard similarity produce correct scores across all test cases. All tests pass.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Window and Detector

**Goal:** Implement the sliding window and circuit breaker logic with configurable thresholds.

**Components:**
- `src/loop-detection/window.ts` (Functional Core) — Sliding window with push/check operations
- `src/loop-detection/detector.ts` (Imperative Shell) — `createLoopDetector()` factory, trace recording on activation
- `src/loop-detection/index.ts` (Imperative Shell) — Barrel exports
- `src/loop-detection/window.test.ts` — Tests for FIFO eviction, consecutive counting, reset on dissimilar response, under-window-size behaviour
- `src/loop-detection/detector.test.ts` — Tests for each action type (warn/redirect/halt), disabled config, trace recording

**Dependencies:** Phase 1

**Covers:** loop-detection.AC2 (window), loop-detection.AC3 (trigger), loop-detection.AC4 (actions), loop-detection.AC5 (tracing), loop-detection.AC6 (config)

**Done when:** Detector correctly identifies loops, respects configuration, dispatches actions, and records traces. All tests pass.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Agent Loop Integration

**Goal:** Wire loop detection into the agent loop's post-response processing and add config fields.

**Components:**
- `src/agent/agent.ts` — After model response, call `detector.check(responseText)`. On `warn`/`redirect`, inject system message into conversation. On `halt`, end the turn with an error result. Reset detector on new user message.
- `src/config/schema.ts` — Add `loop_detection` config section with all fields from `LoopDetectionConfig`
- `src/config/config.ts` — Map config section to `LoopDetectionConfig`
- `src/index.ts` — Create detector at startup, pass to agent

**Dependencies:** Phase 2

**Covers:** loop-detection.AC4 (action dispatch in context), loop-detection.AC7 (false positive resistance validated through integration)

**Done when:** Loop detection fires in the agent loop, actions are dispatched correctly, config is wired end-to-end. Build succeeds (`bun run build`).
<!-- END_PHASE_3 -->

## Additional Considerations

**Quoted content filtering (AC7.3):** Agent responses often echo back portions of the user's message. To avoid inflated similarity from shared quoted content, the similarity check should strip content within blockquotes or code fences before tokenising. This is a heuristic — perfect separation isn't needed, just enough to avoid obvious false positives.

**Tool call responses:** When the model makes tool calls, the "response" for loop detection purposes is the tool call name + arguments serialised, not the tool result. This catches the common loop pattern of repeatedly calling the same tool with the same arguments.

**Memory overhead:** A window of 5 bigram sets for typical agent responses (500-2000 tokens) uses roughly 50-200KB. Negligible relative to conversation history.
