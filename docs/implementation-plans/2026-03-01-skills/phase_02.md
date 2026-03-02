# Skills System Implementation Plan — Phase 2: Database + Postgres Store + Config

**Goal:** Migration for skill_embeddings table, pgvector-backed SkillStore adapter, and SkillConfig schema.

**Architecture:** Migration creates the search index table (source of truth remains SKILL.md files on disk). Postgres store adapter follows `src/memory/postgres-store.ts` patterns exactly — factory function, PersistenceProvider injection, `toSql` for vectors, cosine distance with `<=>`. Config adds optional `[skills]` section to config.toml.

**Tech Stack:** Bun, TypeScript 5.7+ (strict mode), PostgreSQL 17, pgvector, Zod

**Scope:** 5 phases from original design (phase 2 of 5)

**Codebase verified:** 2026-03-01

---

## Acceptance Criteria Coverage

This phase implements and tests:

### skills.AC2: Skill embedding persistence
- **skills.AC2.1 Success:** `upsertEmbedding` inserts a new skill embedding record with vector data
- **skills.AC2.2 Success:** `upsertEmbedding` updates an existing skill embedding when called with same ID
- **skills.AC2.3 Success:** `getByHash` returns the stored content hash for a known skill ID
- **skills.AC2.4 Success:** `getByHash` returns null for an unknown skill ID
- **skills.AC2.5 Success:** `searchByEmbedding` returns skills ranked by cosine similarity, highest first
- **skills.AC2.6 Success:** `searchByEmbedding` filters results below the similarity threshold
- **skills.AC2.7 Success:** `deleteEmbedding` removes a skill's embedding record
- **skills.AC2.8 Success:** `searchByEmbedding` respects the limit parameter

### skills.AC3: Skill configuration
- **skills.AC3.1 Success:** Config parses `[skills]` section with builtin_dir, user_dir, max_per_turn, similarity_threshold
- **skills.AC3.2 Success:** Config defaults are applied when `[skills]` section is present but fields are omitted
- **skills.AC3.3 Success:** Config is fully optional — absence of `[skills]` section results in `undefined`

---

<!-- START_TASK_1 -->
### Task 1: Create skill_embeddings migration

**Verifies:** None (infrastructure — migration file)

**Files:**
- Create: `src/persistence/migrations/003_skill_embeddings.sql`

**Implementation:**

Create `src/persistence/migrations/003_skill_embeddings.sql`:

```sql
CREATE TABLE skill_embeddings (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    embedding vector,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_skill_embeddings_name ON skill_embeddings (name);
```

Notes:
- `embedding vector` without dimension constraint — matches project convention from `001_initial_schema.sql` (pgvector infers dimensions from first write, enabling model hot-swap)
- `id` is the skill's composite ID: `skill:${source}:${name}`
- This table is a search index only — can be dropped and rebuilt from filesystem

**Verification:**

Run: `bun run build`
Expected: Type-check passes (SQL files don't affect TypeScript)

**Commit:** `feat(skill): add skill_embeddings migration`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add SkillConfigSchema to config

**Verifies:** skills.AC3.1, skills.AC3.2, skills.AC3.3

**Files:**
- Modify: `src/config/schema.ts`

**Implementation:**

Add `SkillConfigSchema` in `src/config/schema.ts` following the same pattern as `WebConfigSchema` (optional config section).

Add the schema definition (before `AppConfigSchema`):

```typescript
const SkillConfigSchema = z.object({
  builtin_dir: z.string().default('./skills'),
  user_dir: z.string().default('./user-skills'),
  max_per_turn: z.number().int().positive().default(3),
  similarity_threshold: z.number().min(0).max(1).default(0.3),
});
```

Add to `AppConfigSchema` alongside existing optional sections:

```typescript
skills: SkillConfigSchema.optional(),
```

Add type export:

```typescript
export type SkillConfig = z.infer<typeof SkillConfigSchema>;
```

Add `SkillConfig` to the existing type exports in `src/config/schema.ts` (alongside existing exports like `AppConfig`, `ModelConfig`, etc.).

**Testing:**

Tests must verify each AC listed above. Add tests to `src/config/config.test.ts` (colocated with existing config tests):

- **skills.AC3.1:** Create a TOML config string with `[skills]` section containing all four fields. Parse and verify each field has the specified value.
- **skills.AC3.2:** Create a TOML config string with `[skills]` section but no fields. Parse and verify defaults: `builtin_dir: './skills'`, `user_dir: './user-skills'`, `max_per_turn: 3`, `similarity_threshold: 0.3`.
- **skills.AC3.3:** Create a TOML config string without `[skills]` section. Parse and verify `config.skills` is `undefined`.

**Verification:**

Run: `bun test src/config/`
Expected: All config tests pass (existing + new)

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(skill): add SkillConfigSchema to config`

<!-- END_TASK_2 -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->

<!-- START_TASK_3 -->
### Task 3: Postgres skill store adapter

**Verifies:** skills.AC2.1, skills.AC2.2, skills.AC2.3, skills.AC2.4, skills.AC2.5, skills.AC2.6, skills.AC2.7, skills.AC2.8

**Files:**
- Create: `src/skill/postgres-store.ts`

**Implementation:**

Create `src/skill/postgres-store.ts` following `src/memory/postgres-store.ts` patterns exactly:

```typescript
// pattern: Imperative Shell

import { toSql } from 'pgvector/utils';
import type { PersistenceProvider } from '../persistence/types.ts';
import type { SkillStore } from './store.ts';

export function createPostgresSkillStore(
  persistence: PersistenceProvider,
): SkillStore {
  async function upsertEmbedding(
    id: string,
    name: string,
    description: string,
    contentHash: string,
    embedding: ReadonlyArray<number>,
  ): Promise<void> {
    const embeddingSql = `'${toSql(embedding as Array<number>)}'::vector`;
    await persistence.query(
      `INSERT INTO skill_embeddings (id, name, description, content_hash, embedding, updated_at)
       VALUES ($1, $2, $3, $4, ${embeddingSql}, NOW())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         content_hash = EXCLUDED.content_hash,
         embedding = EXCLUDED.embedding,
         updated_at = NOW()`,
      [id, name, description, contentHash],
    );
  }

  async function deleteEmbedding(id: string): Promise<void> {
    await persistence.query(
      'DELETE FROM skill_embeddings WHERE id = $1',
      [id],
    );
  }

  async function getByHash(id: string): Promise<string | null> {
    const rows = await persistence.query<{ content_hash: string }>(
      'SELECT content_hash FROM skill_embeddings WHERE id = $1',
      [id],
    );
    return rows[0]?.content_hash ?? null;
  }

  async function searchByEmbedding(
    embedding: ReadonlyArray<number>,
    limit: number,
    threshold: number,
  ): Promise<ReadonlyArray<{ id: string; score: number }>> {
    const embeddingSql = `'${toSql(embedding as Array<number>)}'::vector`;
    const rows = await persistence.query<{ id: string; similarity: number }>(
      `SELECT id, (1 - (embedding <=> ${embeddingSql})) as similarity
       FROM skill_embeddings
       WHERE embedding IS NOT NULL
       ORDER BY similarity DESC
       LIMIT $1`,
      [limit],
    );
    return rows
      .filter(r => r.similarity >= threshold)
      .map(r => ({ id: r.id, score: r.similarity }));
  }

  return {
    upsertEmbedding,
    deleteEmbedding,
    getByHash,
    searchByEmbedding,
  };
}
```

Key patterns matched from `src/memory/postgres-store.ts`:
- Factory function accepting `PersistenceProvider`
- `toSql` from `pgvector/utils` for embedding vectors
- `(1 - (embedding <=> ...)) as similarity` for cosine similarity
- `ON CONFLICT ... DO UPDATE` for upsert semantics
- Returns interface object literal

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Postgres skill store tests

**Verifies:** skills.AC2.1, skills.AC2.2, skills.AC2.3, skills.AC2.4, skills.AC2.5, skills.AC2.6, skills.AC2.7, skills.AC2.8

**Files:**
- Create: `src/skill/postgres-store.test.ts`

**Implementation:**

This is an integration test requiring a running PostgreSQL instance with pgvector. **Prerequisite:** Ensure the database is running (`docker compose up -d`) and migrations are applied (`bun run migrate`) before running these tests. The migration from Task 1 must be in place.

Follow the pattern from `src/memory/manager.test.ts`:
- Connect to `postgresql://constellation:constellation@localhost:5432/constellation` in `beforeAll`
- Run migrations
- Truncate `skill_embeddings` in `afterEach`
- Disconnect in `afterAll`
- Use deterministic 768-dimension embedding vectors for reproducible tests

**Testing:**

Tests must verify each AC listed above:

- **skills.AC2.1:** Call `upsertEmbedding` with a new ID, then query the table directly to verify the row exists with correct name, description, content_hash, and non-null embedding.
- **skills.AC2.2:** Call `upsertEmbedding` twice with the same ID but different description/hash. Verify only one row exists and it has the updated values.
- **skills.AC2.3:** Upsert an embedding, then call `getByHash` with its ID. Verify it returns the correct content_hash string.
- **skills.AC2.4:** Call `getByHash` with a non-existent ID. Verify it returns `null`.
- **skills.AC2.5:** Upsert 3 skills with different embeddings. Call `searchByEmbedding` with a query vector closest to skill #1. Verify results are ordered by similarity (skill #1 first).
- **skills.AC2.6:** Upsert skills and search with a very high threshold (e.g., 0.99). Verify results that fall below threshold are excluded.
- **skills.AC2.7:** Upsert an embedding, call `deleteEmbedding`, verify `getByHash` returns null.
- **skills.AC2.8:** Upsert 5 skills, search with limit 2. Verify exactly 2 results returned.

**Verification:**

Run: `bun test src/skill/postgres-store.test.ts`
Expected: All tests pass (requires running PostgreSQL: `docker compose up -d`)

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(skill): implement postgres skill store with integration tests`

<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_5 -->
### Task 5: Update barrel exports

**Verifies:** None (infrastructure)

**Files:**
- Modify: `src/skill/index.ts`

**Implementation:**

Add postgres store factory to barrel exports:

```typescript
export { createPostgresSkillStore } from './postgres-store.ts';
```

**Verification:**

Run: `bun run build`
Expected: Type-check passes

Run: `bun test src/skill/`
Expected: All skill tests pass

**Commit:** `feat(skill): export postgres store from barrel`

<!-- END_TASK_5 -->
