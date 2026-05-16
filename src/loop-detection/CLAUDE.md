# Loop Detection

Last verified: 2026-05-16

Circuit breaker that detects when the agent produces repetitive output, indicating a stuck loop.

## Purpose

Identifies consecutive similar responses using token bigram Jaccard similarity over a sliding window. When similarity exceeds threshold for N consecutive turns, triggers a configurable action (warn, redirect, or halt).

## Contracts

- **Exposes:** `LoopDetector` interface with `check(response)` and `reset()`
- **Exposes:** `createLoopDetector(config)` factory, `createResponseWindow(size)` sliding window
- **Exposes:** Pure utilities: `tokenBigrams`, `jaccardSimilarity`, `stripQuotedContent`
- **Guarantees:** All core logic is pure (Functional Core); no I/O, no side effects
- **Guarantees:** `check()` returns `LoopDetectionResult` with `triggered`, `similarity`, `consecutiveCount`, `action`
- **Expects:** Caller strips tool-use content before passing response text (quote stripping handles `<result>` blocks)

## Dependencies

- **Uses:** Nothing external (pure module, zero imports outside this domain)
- **Used by:** `src/agent/` (post-response check in agent loop), `src/config/` (schema defines `loop_detection` config section)
- **Config:** `[loop_detection]` section in config.toml (enabled, window_size, similarity_threshold, consecutive_trigger, action)

## Key Decisions

- Bigram tokenization over raw string comparison: more robust to minor wording changes while catching structural repetition
- Quoted content stripping: prevents tool results from inflating similarity scores
- Sliding window (not unbounded history): bounded memory, recent-biased detection
- Optional dependency in AgentDependencies (`loopDetector?: LoopDetector`): graceful degradation when disabled
