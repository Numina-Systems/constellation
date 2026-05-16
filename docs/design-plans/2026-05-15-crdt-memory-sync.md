# CRDT Memory Sync Design

## Summary

Constellation's memory system is purely database-backed. There is no mechanism for a human to edit memory blocks in a text editor and have those edits flow back into the agent's live memory, nor for agent memory writes to produce human-readable files on disk. Pattern (a sibling Rust project) achieves this via CRDT (loro) with automatic sync to both a database and markdown files. This design ports a simplified version: file-backed core memory blocks using last-write-wins conflict resolution, with a file watcher for bidirectional sync.

**Priority:** Low. Valuable for human-in-the-loop memory editing; not required for autonomous operation.

## Definition of Done

1. **File representation** — Core memory blocks are mirrored as markdown files in a configurable directory. Format: YAML frontmatter (label, tier, permissions) + markdown body.
2. **Agent write → file** — Writing or updating a core memory block also writes the corresponding `.md` file.
3. **File watch → database** — A file watcher detects external edits and syncs changes back to the database.
4. **Conflict resolution** — Last-write-wins using `updated_at` timestamps. No full CRDT required.
5. **Scope** — Core memory tier only. Working and archival memory are excluded.

**Out of scope:**
- Full CRDT / multi-writer merge
- Working or archival memory file sync
- Real-time collaborative editing

## Acceptance Criteria

### crdt-memory.AC1: File Representation
- **crdt-memory.AC1.1 Success:** Writing a core memory block creates a corresponding `.md` file in the sync directory
- **crdt-memory.AC1.2 Success:** File name is derived from the block label, slugified (lowercase, spaces to hyphens, alphanumeric only)
- **crdt-memory.AC1.3 Success:** YAML frontmatter contains `label`, `tier: core`, and `updated_at` (ISO 8601)
- **crdt-memory.AC1.4 Edge:** A label that produces a filename collision with an existing different label results in a suffixed filename (e.g., `-2`)

### crdt-memory.AC2: Agent Write → File
- **crdt-memory.AC2.1 Success:** `memory_write` to core tier writes the database row and the corresponding file atomically (write-then-rename)
- **crdt-memory.AC2.2 Failure:** File write failure logs a warning but does not fail the database write or the tool call
- **crdt-memory.AC2.3 Success:** Deleting a core memory block removes the corresponding file if it exists

### crdt-memory.AC3: File Watch → Database
- **crdt-memory.AC3.1 Success:** Editing the body of a `.md` file in the sync directory updates the database block content within 2 seconds
- **crdt-memory.AC3.2 Success:** Editing frontmatter fields that are read-only (label, tier) logs a warning and ignores the frontmatter change; body change is still applied
- **crdt-memory.AC3.3 Edge:** Deleting a file in the sync directory does not delete the database block (file deletion is not proxied to avoid accidents)
- **crdt-memory.AC3.4 Failure:** A file with unparseable YAML frontmatter logs a warning and skips the sync for that file

### crdt-memory.AC4: Conflict Resolution
- **crdt-memory.AC4.1 Success:** When a file edit and an agent write occur within the same second, the write with the later `updated_at` timestamp wins
- **crdt-memory.AC4.2 Success:** After conflict resolution, both the database and the file reflect the winning content

### crdt-memory.AC5: Configuration & Wiring
- **crdt-memory.AC5.1 Success:** Sync directory path is configurable in `config.toml`; feature is disabled when the key is absent
- **crdt-memory.AC5.2 Success:** Daemon starts normally when the sync directory does not exist; directory is created on startup
- **crdt-memory.AC5.3 Success:** File watcher is shut down cleanly when the daemon stops

## Architecture

```
Agent memory_write (core)
    → database write
    → file write (write-then-rename to sync directory)

External editor modifies .md file
    → FSWatcher detects change
    → parse frontmatter + body
    → compare updated_at with database
    → if file is newer: update database
```

**New files:**
- `src/memory/file-sync-types.ts` — `MemoryFileSync`, `FileSyncConfig` port types (Functional Core)
- `src/memory/file-serializer.ts` — pure functions: `serializeBlock(block): string`, `parseBlockFile(content): ParsedBlock` (Functional Core)
- `src/memory/file-sync.ts` — `createMemoryFileSync(config, persistence)` factory; FSWatcher setup, write helpers, shutdown (Imperative Shell)
- `src/memory/index.ts` — extend barrel export

**Key types:**
```typescript
type FileSyncConfig = {
  readonly syncDir: string;
  readonly debounceMs: number;
};

type ParsedBlock = {
  readonly label: string;
  readonly tier: 'core';
  readonly updatedAt: Date;
  readonly content: string;
};

type MemoryFileSync = {
  writeBlock(block: CoreMemoryBlock): Promise<void>;
  deleteBlock(label: string): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
};
```

## Implementation Phases

### Phase 1: Serialization (Functional Core)
**Goal:** Pure functions for converting between memory blocks and `.md` file content.

**Components:**
- `src/memory/file-serializer.ts` — `serializeBlock`, `parseBlockFile`

**Done when:** Unit tests cover round-trip serialization, label slugification, collision suffix, malformed frontmatter error. Covers `crdt-memory.AC1.2`, `crdt-memory.AC1.3`, `crdt-memory.AC3.4`.

### Phase 2: File Sync Adapter
**Goal:** Imperative Shell adapter wrapping FSWatcher and file I/O.

**Components:**
- `src/memory/file-sync.ts` — `createMemoryFileSync(config, persistence)` with write-then-rename, debounced watcher, conflict resolution

**Done when:** Tests (using a temp directory) cover write → file, external edit → database, conflict resolution, file deletion warning, watcher shutdown. Covers `crdt-memory.AC2.*`, `crdt-memory.AC3.*`, `crdt-memory.AC4.*`.

### Phase 3: Memory Manager Integration & Wiring
**Goal:** Hook file sync into the existing memory manager and composition root.

**Components:**
- `src/memory/memory-manager.ts` — call `fileSync.writeBlock` / `fileSync.deleteBlock` after successful core-tier writes/deletes (if sync is configured)
- `src/index.ts` — optionally construct `MemoryFileSync`, pass to memory manager, call `start()` / `stop()` with daemon lifecycle

**Done when:** Daemon starts with and without sync config; end-to-end write produces file; `bun run build` passes. Covers `crdt-memory.AC5.*`.

## Additional Considerations

**File watcher library:** Bun's built-in `Bun.watch` (or Node's `fs.watch`) is sufficient. A debounce of ~500ms prevents thrashing on rapid saves.

**Large archival tiers:** Archival memory can contain thousands of blocks. Excluding it from file sync is not just a priority call — it's a practical necessity to avoid overwhelming the filesystem.

**Future full CRDT:** If true multi-writer merge is needed (e.g., multiple humans editing simultaneously), the `MemoryFileSync` port is the right extension point. The adapter can be swapped without changing the memory manager.
