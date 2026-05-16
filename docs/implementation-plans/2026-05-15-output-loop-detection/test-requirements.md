# Output Loop Detection — Test Requirements

Maps each acceptance criterion to automated tests or human verification.

---

## AC1: Similarity Computation

| Criterion | Test Type | Test File | Description |
|-----------|-----------|-----------|-------------|
| loop-detection.AC1.1 | Unit | `src/loop-detection/similarity.test.ts` | Identical sets → 1.0 |
| loop-detection.AC1.2 | Unit | `src/loop-detection/similarity.test.ts` | Disjoint sets → < 0.2 |
| loop-detection.AC1.3 | Unit | `src/loop-detection/similarity.test.ts` | Paraphrased text → > 0.7 |
| loop-detection.AC1.4 | Unit | `src/loop-detection/similarity.test.ts` | Empty vs non-empty → 0.0 |
| loop-detection.AC1.5 | Unit | `src/loop-detection/similarity.test.ts` | Two empty → 1.0 |

---

## AC2: Sliding Window

| Criterion | Test Type | Test File | Description |
|-----------|-----------|-----------|-------------|
| loop-detection.AC2.1 | Unit | `src/loop-detection/window.test.ts` | Window holds N entries (configurable) |
| loop-detection.AC2.2 | Unit | `src/loop-detection/window.test.ts` | FIFO eviction when full |
| loop-detection.AC2.3 | Unit | `src/loop-detection/window.test.ts` | Separate window instances don't share state |
| loop-detection.AC2.4 | Unit | `src/loop-detection/window.test.ts` | Fewer entries than window size → no trigger |

---

## AC3: Circuit Breaker Trigger

| Criterion | Test Type | Test File | Description |
|-----------|-----------|-----------|-------------|
| loop-detection.AC3.1 | Unit | `src/loop-detection/window.test.ts` | 3 consecutive > 0.85 triggers |
| loop-detection.AC3.2 | Unit | `src/loop-detection/window.test.ts` | Different response resets counter |
| loop-detection.AC3.3 | Unit | `src/loop-detection/window.test.ts` | Single high-similarity does not trigger |
| loop-detection.AC3.4 | Unit | `src/loop-detection/window.test.ts` | Max pairwise similarity against all window entries |

---

## AC4: Actions

| Criterion | Test Type | Test File | Description |
|-----------|-----------|-----------|-------------|
| loop-detection.AC4.1 | Unit | `src/loop-detection/detector.test.ts` | `warn` action in result |
| loop-detection.AC4.2 | Unit | `src/loop-detection/detector.test.ts` | `redirect` action in result |
| loop-detection.AC4.3 | Unit | `src/loop-detection/detector.test.ts` | `halt` action in result |
| loop-detection.AC4.4 | Unit | `src/loop-detection/detector.test.ts` | Action matches config |

**Agent-level dispatch (warn injects message, halt ends turn):** Human verification required.

| Criterion | Verification | Justification |
|-----------|-------------|---------------|
| AC4.1 dispatch | Human | Requires running agent with intentional loop trigger; verify system message injected |
| AC4.2 dispatch | Human | Requires running agent; verify redirect hint appended to warning |
| AC4.3 dispatch | Human | Requires running agent; verify turn ends with stuck message |

**Verification approach:** Run the agent with `loop_detection.consecutive_trigger: 2` and a prompt known to produce repetitive output. Observe behaviour for each action setting.

---

## AC5: Trace Recording

| Criterion | Test Type | Test File | Description |
|-----------|-----------|-----------|-------------|
| loop-detection.AC5.1 | Unit | `src/loop-detection/detector.test.ts` | Activation records trace with score, count, action |
| loop-detection.AC5.2 | Unit | `src/loop-detection/detector.test.ts` | Uses TraceRecorder.record() |
| loop-detection.AC5.3 | Unit | `src/loop-detection/detector.test.ts` | Non-activation does not record |

---

## AC6: Configuration

| Criterion | Test Type | Test File | Description |
|-----------|-----------|-----------|-------------|
| loop-detection.AC6.1 | Unit | `src/loop-detection/detector.test.ts` | `enabled` defaults to true |
| loop-detection.AC6.2 | Unit | `src/loop-detection/detector.test.ts` | `window_size` defaults to 5 |
| loop-detection.AC6.3 | Unit | `src/loop-detection/detector.test.ts` | `similarity_threshold` defaults to 0.85 |
| loop-detection.AC6.4 | Unit | `src/loop-detection/detector.test.ts` | `consecutive_trigger` defaults to 3 |
| loop-detection.AC6.5 | Unit | `src/loop-detection/detector.test.ts` | `action` defaults to 'warn' |
| loop-detection.AC6.6 | Unit | `src/loop-detection/detector.test.ts` | `enabled: false` disables detection |

---

## AC7: False Positive Resistance

| Criterion | Test Type | Test File | Description |
|-----------|-----------|-----------|-------------|
| loop-detection.AC7.1 | Unit | `src/loop-detection/similarity.test.ts` | Common prefix + divergent content → below threshold |
| loop-detection.AC7.2 | Unit | `src/loop-detection/similarity.test.ts` | Same tool name, different args → below threshold |
| loop-detection.AC7.3 | Unit | `src/loop-detection/strip-quotes.test.ts` | Quoted content stripped before comparison |

---

## Summary

| Category | Automated | Human Verification |
|----------|-----------|-------------------|
| AC1 (Similarity) | 5 | 0 |
| AC2 (Window) | 4 | 0 |
| AC3 (Trigger) | 4 | 0 |
| AC4 (Actions) | 4 | 3 (dispatch in agent context) |
| AC5 (Tracing) | 3 | 0 |
| AC6 (Config) | 6 | 0 |
| AC7 (False Positives) | 3 | 0 |
| **Total** | **29** | **3** |

The 3 human verification items require running the agent end-to-end with loop-triggering prompts. These cannot be automated without a full agent integration test harness that includes model mocking.
