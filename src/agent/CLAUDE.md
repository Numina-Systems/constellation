# Agent

Last verified: 2026-09-09

## Purpose

Runs serialized conversation turns: persists input and outcomes, assembles provider context, dispatches tools, performs bounded compaction, and captures checkpoint state.

## Contracts

- **Exposes**: `createAgent`, `Agent`, `processMessage`, `processEvent`, checkpoint codecs/restore, context and snapshot helpers, and lifecycle composition types.
- **Guarantees**:
  - One FIFO ingress executor owns a complete turn, including persistence, tool batches, compaction, final response, and checkpoint capture. Queued cancellation is side-effect-free; reentrant acquisition fails with typed `REENTRANT_INGRESS`.
  - Tool outcomes remain typed as `success`, `error`, `cancelled`, or `outcome_unknown` through persistence/reload and provider lowering. Legacy rows decode as `legacy_unknown` without substring classification.
  - An interrupted batch records unstarted calls as `cancelled` and started/uncertain calls as `outcome_unknown`. Persistence failure marks the conversation recovery-required and blocks further provider/handler execution for it.
  - Admission budgets the fully assembled request before each provider call. Irreducible mandatory context returns `context_unfittable` without a knowingly oversized call.
  - `compact_context` is deferred until the correlated tool batch is complete; cache/snapshot reset publishes only after durable compaction commit.
  - Checkpoints use v2 with ordered active IDs, revision, archive IDs, and provenance. v1 decodes through an explicit migration marker. Unknown versions and missing native-v2 IDs fail before mutation.
  - `auto_resume` reads durable active history and does not rewind later commits. Explicit restore replaces active membership transactionally, advances revision, and publishes working-memory restoration after durable success.
  - Recovery-required unfinished effects are never replayed automatically. Independent conversations can continue.
  - Interval checkpoints fire only after successfully completed turns divisible by positive `checkpoint_interval`; shutdown capture is serialized and owned by the agent shutdown seam when supplied.
- **Expects**: injected model, persistence/history store, memory, registry, optional runtime/compactor/skills/recall/checkpoint dependencies.

## Dependencies

- **Uses**: model, memory, tool, runtime, persistence/history, compaction, skills, recall, and tracing ports.
- **Used by**: `src/index.ts` composition root and external/scheduled/REPL ingress.
- **Boundary**: the agent is the primary caller of inference providers; compaction owns summary-provider calls.

## Key decisions

- `CHECKPOINT_VERSION` is `2`.
- Estimates use serialized provider-shaped values and a four-characters-per-token heuristic; they are not tokenizer guarantees.
- Durable history is authoritative for automatic continuation; checkpoints are recovery metadata, not a rewind command.

## Key files

- `agent.ts` -- queued turn runner, tool batches, admission, and checkpoint triggers.
- `integrity-lifecycle.ts` -- durable batch/counter/recovery state.
- `checkpoint-types.ts`, `checkpoint-serializer.ts`, `checkpoint-create.ts`, `checkpoint-restore.ts` -- versioned checkpoint lifecycle.
- `context.ts`, `snapshot.ts`, `messages.ts` -- context and dynamic attachment shaping.
- `index.ts` -- public exports.
