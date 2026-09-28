# Memory

Last verified: 2026-09-09

## Purpose

Implements owner-scoped core, working, and archival memory with permission-aware mutations, semantic search, event sourcing, and protected compaction archives.

## Contracts

- **Exposes**: `MemoryManager` and `MemoryStore`, `createMemoryManager(store, embedding, owner)`, `createPostgresMemoryStore(persistence)`, deletion policy and trusted maintenance operations.
- **Guarantees**:
  - Public deletion requires an owner-scoped manager and rechecks the row under `FOR UPDATE` before event/deletion publication.
  - Missing or foreign IDs return not-found behavior without foreign metadata. Public deletion rejects `readonly`, `familiar`, `append`, pinned, and core blocks. Only owner-owned, unpinned, non-core `readwrite` blocks are eligible.
  - Accepted deletion audit and row removal commit together; rejected or rolled-back deletion creates no event.
  - `familiar` writes queue a `PendingMutation`; `readonly` writes reject; `append` concatenates and `readwrite` overwrites.
  - History-owned archive blocks are persistence-protected, readonly, pinned, and cannot be changed by public memory or ingest/archivist maintenance paths. The dedicated history commit path creates them.
  - `replaceWorkingMemory` is a trusted owner-scoped restore capability and rejects protected existing working blocks.
  - `read()` uses embedding search when available; embedding failures degrade to null embeddings. `buildSystemPrompt()` includes all core blocks.
- **Expects**: A migrated `PersistenceProvider` and an embedding provider or explicit graceful-failure handling.

## Dependencies

- **Uses**: `src/persistence/` through `MemoryStore`, and `src/embedding/`.
- **Used by**: memory tools, agent, compaction, diary, ingest, archivist, checkpoint restore, and composition root.
- **Boundary**: Memory managers do not issue SQL directly; stores enforce owner and transaction boundaries.

## Invariants

- `(owner, label)` is unique.
- Core blocks are pinned.
- Ordinary mutations are event-sourced. Delete events are written before deletion and survive through nullable block references.
- Pending mutations require explicit approval or rejection.
- History-owned archive bytes and their references remain stable for their lifetime.

## Key Files

- `types.ts` -- memory tiers, permissions, blocks, events, and replacement inputs.
- `deletion-policy.ts` -- pure public and maintenance authorization decisions.
- `manager.ts` -- manager orchestration and owner injection.
- `postgres-store.ts` -- locked authorization, atomic events/deletes, maintenance, and restore operations.
- `store.ts` -- owner-scoped store port.
