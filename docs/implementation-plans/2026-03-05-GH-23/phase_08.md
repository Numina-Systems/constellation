# Hybrid Search + Multi-Domain Memory Retrieval Implementation Plan

**Goal:** Backfill existing messages with embeddings and wire the search module at the composition root so the search tool is available to the agent.

**Architecture:** Standalone backfill script following `src/scripts/migrate-surreal.ts` and `src/persistence/migrate.ts` patterns (load config, create providers, do work, disconnect). Composition root wiring follows existing tool registration pattern (create store, register tool, log).

**Tech Stack:** TypeScript 5.7+, pgvector, bun:test

**Scope:** 8 phases from original design (phases 1-8)

**Codebase verified:** 2026-03-05

---

## Acceptance Criteria Coverage

This phase implements and tests:

### GH-23.AC3: Message embeddings are generated and backfilled
- **GH-23.AC3.4 Success:** Backfill script processes existing messages in batches and reports progress

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Create backfill-embeddings script

**Verifies:** GH-23.AC3.4

**Files:**
- Create: `src/scripts/backfill-embeddings.ts`

**Implementation:**

Create `src/scripts/backfill-embeddings.ts` with `// pattern: Imperative Shell` annotation.

Follow the existing script patterns from `src/persistence/migrate.ts` and `src/scripts/migrate-surreal.ts`:

```typescript
import { loadConfig } from '../config/config.ts';
import { createPostgresProvider } from '../persistence/postgres.ts';
import { createEmbeddingProvider } from '../embedding/factory.ts';
import { toSql } from 'pgvector/utils';

const BATCH_SIZE = 50;

async function main(): Promise<void> {
  const config = loadConfig();
  const persistence = createPostgresProvider(config.database);
  const embedding = createEmbeddingProvider(config.embedding);

  await persistence.connect();

  try {
    // Count messages needing backfill (user/assistant with null embedding)
    // Process in batches of BATCH_SIZE
    // For each batch:
    //   1. SELECT id, content FROM messages WHERE role IN ('user', 'assistant') AND embedding IS NULL LIMIT $BATCH_SIZE
    //   2. Generate embeddings via embedding.embedBatch()
    //   3. UPDATE each message with its embedding (in a transaction)
    //   4. Log progress: "Batch N: processed M messages (X/Y total)"
    // Handle embedding failures per-message (skip failed, log warning, continue)
    // Report final summary: "Backfill complete: X messages embedded, Y failed, Z total"
  } finally {
    await persistence.disconnect();
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
```

Key implementation details:
- Try `embedBatch()` first for efficiency (batch embedding generation)
- If `embedBatch()` throws (all-or-nothing failure), fall back to individual `embed()` calls for each message in the failed batch, catching per-message failures individually
- Process in batches to avoid loading all messages at once
- Use a transaction per batch for atomicity (via `persistence.withTransaction()`)
- UPDATE embedding with `toSql(embedding)` for pgvector format
- Per-message `embed()` failures: skip the failed message (store null embedding), log warning, continue with remaining messages in the batch
- Report progress after each batch with running totals (embedded count, failed count, total)
- System and tool messages are skipped (WHERE role IN ('user', 'assistant'))

**Verification:**

Run: `bun run build`
Expected: No errors

**Commit:** `feat(scripts): add backfill-embeddings script for existing messages`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add backfill script to package.json

**Files:**
- Modify: `package.json:6-11` (scripts section)

**Implementation:**

Add the backfill script entry to the scripts section:

```json
"backfill-embeddings": "bun run src/scripts/backfill-embeddings.ts"
```

**Verification:**

Run: `bun run backfill-embeddings --help` (or just verify it starts and reports "0 messages to backfill" on an empty/already-backfilled database)

**Commit:** `chore: add backfill-embeddings script to package.json`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Wire SearchStore and search tool at composition root

**Files:**
- Modify: `src/index.ts` (composition root — tool registration section around lines 536-570)

**Implementation:**

After the email tools block (line ~568) and before the runtime creation (line ~570) in `src/index.ts`, add SearchStore creation and search tool registration:

```typescript
// Search tools (always available — uses existing persistence and embedding providers)
const searchStore = createSearchStore(embedding);
const memorySearchDomain = createMemorySearchDomain(persistence, AGENT_OWNER);
const conversationSearchDomain = createConversationSearchDomain(persistence);
searchStore.registerDomain(memorySearchDomain);
searchStore.registerDomain(conversationSearchDomain);

const searchTools = createSearchTools(searchStore);
for (const tool of searchTools) {
  registry.register(tool);
}
console.log('search tools registered');
```

Add the required imports at the top of `src/index.ts`:

```typescript
import { createSearchStore, createMemorySearchDomain, createConversationSearchDomain } from '@/search';
import { createSearchTools } from '@/tool/builtin/search';
```

Note: Unlike web/email tools which are conditional on config, the search tool is always available (it uses the existing `persistence` and `embedding` providers which are always configured).

**Verification:**

Run: `bun run build`
Expected: No errors

**Commit:** `feat: wire SearchStore and search tool at composition root`

<!-- END_TASK_3 -->
