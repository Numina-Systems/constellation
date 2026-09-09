# Compaction

Last verified: 2026-09-09

## Purpose

Prepares bounded summaries from complete conversation exchanges and publishes them through the revisioned history store without deleting retained transcript or source archives.

## Contracts

- **Exposes**: `Compactor`, durable preparation/commit results, exchange grouping/projection, continuation derivation, breaker status/reset, scoring, prompt builders, and compaction errors.
- **Guarantees**:
  - Durable compaction is read/prepare -> model summarize -> one history-store commit. A durable `historyStore` is required; no-store legacy destructive compaction is not an active path.
  - Empty, whitespace-only, and non-text-only summaries return typed `summary_empty` and cannot commit. Unfittable required context returns `unfittable` before that provider call. Recursive summaries use the same fit/deadline/retry contract.
  - Complete assistant tool-call/result exchanges remain intact and chronological. Projection carries bounded IDs, names, arguments, statuses, timestamps, omission markers, and provenance. Metadata spans use actual timestamp extrema.
  - Initial and recursive work share one operation deadline. `compaction_timeout` defaults to 120000 ms and `compaction_max_retries` defaults to 2 (at most three attempts per unit). `max_chunk_tokens` is an optional soft payload cap.
  - Compaction commits archive blocks, summary, active membership, provenance, receipt, and revision atomically. Originals and recursive source archives remain retained; recursive replacement records supersession lineage.
  - Commit ambiguity returns `history_state_unknown`; stale membership/revision and intervention faults remain typed and can latch intervention-required state. No in-memory/cache publication occurs before durable success.
  - The breaker is `CLOSED`/`OPEN`/`HALF_OPEN`, defaults to threshold 3 and cooldown 60000 ms, and admits one half-open probe. Unfittable is not a transient failure. Trusted status/reset is exposed through the operator composition seam only.
- **Expects**: `ModelProvider`, memory/context dependencies as needed, and `ConversationHistoryStore` for production compaction.

## Dependencies

- **Uses**: model, persistence history, memory types, and agent conversation messages.
- **Used by**: agent and composition root.
- **Boundary**: compaction is the only summary-provider caller; history mutation is delegated to the history store.

## Key files

- `compactor.ts` -- compatibility port and factory.
- `durable.ts` -- durable prepare/summarize/commit orchestration.
- `grouping.ts`, `continuation.ts` -- pure exchange/provenance policy.
- `breaker.ts` -- breaker state and trusted status/reset.
- `prompt.ts`, `scoring.ts`, `types.ts` -- summary requests, selection, and result contracts.
