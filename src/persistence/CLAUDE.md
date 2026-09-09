# Persistence

Last verified: 2026-09-09

## Purpose

Provides PostgreSQL ports and adapters for migrations, owner-scoped data, revisioned active history, retained transcripts, checkpoints, and transaction truth/reconciliation.

## Contracts

- **Exposes**: `PersistenceProvider`, transaction scopes/outcomes, `createPostgresProvider`, `ConversationHistoryStore`, `CheckpointStore`, `MessageStore`, and their factories.
- **Guarantees**:
  - Migrations run in filename order, transactionally, and existing migration files are immutable. New history migrations follow the current sequence.
  - Transaction state is scoped to its owning provider. Nested scopes use savepoints and are provisional; only the outermost owner can publish durable state.
  - Transaction outcomes distinguish confirmed commit, confirmed rollback, and unknown acknowledgement. A commit error is preserved if rollback also fails; broken clients are invalidated and unknown outcomes reconcile outside the ambient transaction.
  - `ConversationHistoryStore` appends messages and active membership with a monotonic conversation revision. `readActive` returns one consistent active projection and revision. Retained `readHistorical` rows are labeled `historical` or `superseded`; `readByIds` enforces conversation membership and requested order.
  - Compaction commits archives, summary, membership, provenance, receipt, and revision in one operation. It performs no model/embedding network call inside that transaction and fails closed as `history_state_unknown` when truth cannot be established.
  - `saveAndPruneCheckpoint` atomically saves and count-prunes checkpoints. Pruning never deletes retained transcript rows or referenced archive blocks.
  - History-owned archive blocks are protected by database state/constraints and retain canonical bytes for their references.
- **Expects**: PostgreSQL with pgvector and migrations applied. Integration tests require `TEST_DATABASE_ADMIN_URL` and use a dedicated disposable database; they never fall back to `DATABASE_URL`.

## Dependencies

- **Uses**: `pg`, `pgvector`, config, agent/history types, and contract outcomes.
- **Used by**: memory, agent, compaction, search, skills, reflexion, scheduling, activity, custom tools, and composition root.
- **Boundary**: domain modules use `PersistenceProvider`; no direct `pg` imports outside adapters.

## Invariants

- Existing migrations are append-only.
- Active membership cannot point to a message from another conversation.
- Durable publication and in-memory publication occur only after confirmed/reconciled commit.
- Ambiguous history state blocks affected execution rather than claiming rollback or unchanged state.

## Key files

- `types.ts`, `postgres.ts` -- provider and transaction boundary.
- `conversation-history-store.ts` -- active/retained history and compaction/restore commits.
- `checkpoint-store.ts`, `message-store.ts` -- checkpoint and active-message access.
- `migrations/016_conversation_history.sql`, `migrations/017_scope_history_summary_fk.sql` -- history schema additions.
