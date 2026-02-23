# Memory

Last verified: 2026-02-23

## Purpose
Implements a three-tier memory system (core/working/archival) with permission-based write access, semantic search via pgvector, event sourcing, and a mutation approval flow for human-controlled blocks.

## Contracts
- **Exposes**: `MemoryManager` interface (context building, read/write/list, mutation management), `MemoryStore` port interface, `createMemoryManager(store, embedding, owner)`, `createPostgresMemoryStore(persistence)`, all memory types
- **Guarantees**:
  - `readonly` blocks cannot be written to
  - `familiar`-permissioned blocks queue a `PendingMutation` instead of writing directly (requires human approval)
  - `append` blocks concatenate content; `readwrite` blocks overwrite
  - `read()` performs semantic search via embedding similarity
  - All mutations are event-sourced (`memory_events` table)
  - `buildSystemPrompt()` returns all core blocks formatted for the model system prompt
- **Expects**: `PersistenceProvider` connected with migrations applied. `EmbeddingProvider` available (graceful fallback to null embedding on failure).

## Dependencies
- **Uses**: `src/persistence/` (via `MemoryStore`), `src/embedding/` (via `EmbeddingProvider`)
- **Used by**: `src/tool/builtin/memory.ts`, `src/agent/`, `src/index.ts`
- **Boundary**: Direct SQL access goes through `MemoryStore` only, never through `MemoryManager`.

## Key Decisions
- Three tiers: Core (always in context), Working (active session context), Archival (searchable long-term)
- Permission model: `readonly` (system), `familiar` (human-approved mutations), `append` (log-style), `readwrite` (agent-owned)
- Mutation approval flow: Separates agent intent from human authorization for sensitive blocks
- Owner-scoped: All queries are scoped to an owner string, enabling multi-agent memory isolation

## Invariants
- Memory blocks have a unique `(owner, label)` pair (enforced by DB unique constraint)
- Core blocks are always `pinned: true`
- Every create/update/delete produces a `memory_events` entry
- `PendingMutation` must be explicitly approved or rejected; no auto-approval

## Key Files
- `types.ts` -- `MemoryBlock`, `MemoryEvent`, `PendingMutation`, `MemoryWriteResult`, tier/permission enums
- `store.ts` -- `MemoryStore` port interface
- `postgres-store.ts` -- PostgreSQL + pgvector implementation of `MemoryStore`
- `manager.ts` -- `MemoryManager` interface and implementation (orchestration layer)
