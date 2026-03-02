# Skills System Implementation Plan — Phase 3: Loader + Registry

**Goal:** Filesystem skill loader with content-hash change detection and the SkillRegistry implementation that ties together loading, in-memory storage, and embedding-based search.

**Architecture:** Loader scans builtin and user directories for SKILL.md files, parses with the Phase 1 parser, computes SHA-256 hashes for change detection, embeds via EmbeddingProvider, and upserts to SkillStore. Registry wraps loader and store into the `SkillRegistry` interface consumed by the agent. Follows `src/memory/manager.ts` factory-closure pattern.

**Tech Stack:** Bun, TypeScript 5.7+ (strict mode), bun:test, node:crypto, node:fs

**Scope:** 5 phases from original design (phase 3 of 5)

**Codebase verified:** 2026-03-01

---

## Acceptance Criteria Coverage

This phase implements and tests:

### skills.AC4: Skill loading and change detection
- **skills.AC4.1 Success:** Loader discovers SKILL.md files in `builtinDir/*/SKILL.md` pattern
- **skills.AC4.2 Success:** Loader discovers SKILL.md files in `userDir/*/SKILL.md` pattern
- **skills.AC4.3 Success:** User skills override builtin skills when names conflict
- **skills.AC4.4 Success:** Unchanged skills (same content hash) are not re-embedded
- **skills.AC4.5 Success:** Changed skills (different content hash) are re-embedded and upserted
- **skills.AC4.6 Success:** Orphaned embeddings (skill removed from disk) are deleted from store
- **skills.AC4.7 Success:** Companion files referenced in metadata are loaded with correct content
- **skills.AC4.8 Failure:** Missing companion file is reported as a warning, skill still loads
- **skills.AC4.9 Success:** Skill IDs follow `skill:${source}:${name}` format

### skills.AC5: Skill registry search
- **skills.AC5.1 Success:** `getRelevant(context)` returns skills above similarity threshold
- **skills.AC5.2 Success:** `getRelevant` respects `limit` parameter
- **skills.AC5.3 Success:** `getAll()` returns all loaded skills
- **skills.AC5.4 Success:** `getByName(name)` returns the skill with matching name, or undefined
- **skills.AC5.5 Success:** `search(query)` returns `SkillSearchResult` array ranked by relevance
- **skills.AC5.6 Success:** `createUserSkill` writes SKILL.md to user dir, parses, embeds, and adds to registry
- **skills.AC5.7 Success:** `updateUserSkill` updates existing user skill on disk and in registry
- **skills.AC5.8 Failure:** `updateUserSkill` on a builtin skill returns error (user skills only)

---

<!-- START_TASK_1 -->
### Task 1: Add SkillRegistry interface to types

**Verifies:** None (infrastructure — type definition)

**Files:**
- Modify: `src/skill/types.ts`

**Implementation:**

Add the `SkillRegistry` interface and `LoadResult` type to `src/skill/types.ts`:

```typescript
export type LoadResult = {
  readonly loaded: ReadonlyArray<SkillDefinition>;
  readonly errors: ReadonlyArray<{ readonly path: string; readonly error: string }>;
};

export interface SkillRegistry {
  load(): Promise<void>;
  getAll(): Array<SkillDefinition>;
  getByName(name: string): SkillDefinition | undefined;
  search(query: string, limit?: number): Promise<Array<SkillSearchResult>>;
  getRelevant(context: string, limit?: number, threshold?: number): Promise<Array<SkillDefinition>>;
  createUserSkill(name: string, description: string, body: string, tags?: ReadonlyArray<string>): Promise<SkillDefinition>;
  updateUserSkill(name: string, description: string, body: string, tags?: ReadonlyArray<string>): Promise<SkillDefinition>;
}
```

Update `src/skill/index.ts` to export the new types:

```typescript
export type {
  SkillSource,
  SkillToolDefinition,
  SkillMetadata,
  SkillDefinition,
  SkillSearchResult,
  ParseResult,
  LoadResult,
  SkillRegistry,
} from './types.ts';
```

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(skill): add SkillRegistry interface and LoadResult type`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add getAllIds to SkillStore and postgres-store

**Verifies:** None (infrastructure — interface extension for orphan cleanup)

**Files:**
- Modify: `src/skill/store.ts`
- Modify: `src/skill/postgres-store.ts`

**Implementation:**

The loader needs to know which skill IDs are currently in the store to perform orphan cleanup. Add `getAllIds()` to the SkillStore interface.

Add to `src/skill/store.ts`:

```typescript
getAllIds(): Promise<ReadonlyArray<string>>;
```

Add implementation to `src/skill/postgres-store.ts`:

```typescript
async function getAllIds(): Promise<ReadonlyArray<string>> {
  const rows = await persistence.query<{ id: string }>(
    'SELECT id FROM skill_embeddings',
    [],
  );
  return rows.map(r => r.id);
}
```

Add `getAllIds` to the return object of `createPostgresSkillStore`.

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(skill): add getAllIds to SkillStore interface`

<!-- END_TASK_2 -->

<!-- START_SUBCOMPONENT_A (tasks 3-4) -->

<!-- START_TASK_3 -->
### Task 3: Skill loader implementation

**Verifies:** skills.AC4.1, skills.AC4.2, skills.AC4.3, skills.AC4.4, skills.AC4.5, skills.AC4.6, skills.AC4.7, skills.AC4.8, skills.AC4.9

**Files:**
- Create: `src/skill/loader.ts`

**Implementation:**

Create `src/skill/loader.ts`. This is Imperative Shell — it does filesystem I/O, calls embedding provider, and writes to store.

```typescript
// pattern: Imperative Shell

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';
import type { EmbeddingProvider } from '../embedding/types.ts';
import type { SkillStore } from './store.ts';
import type { SkillDefinition, SkillSource, LoadResult } from './types.ts';
import { parseSkillFile } from './parser.ts';
```

The module exports a single function:

```typescript
type LoadSkillsOptions = {
  readonly builtinDir: string;
  readonly userDir: string;
  readonly store: SkillStore;
  readonly embedding: EmbeddingProvider;
};

export async function loadSkills(options: LoadSkillsOptions): Promise<LoadResult> { ... }
```

**Algorithm:**

1. **Scan directories**: For each dir (builtin, user), find `*/SKILL.md` files using `readdirSync` to list subdirectories, then check for `SKILL.md` in each.

2. **Parse each file**: Read content with `readFileSync`, call `parseSkillFile()`. On parse failure, add to `errors` array and continue.

3. **Build SkillDefinition**: For each parsed skill:
   - `id` = `skill:${source}:${metadata.name}`
   - `contentHash` = SHA-256 of full file content (`crypto.createHash('sha256').update(content).digest('hex')`)
   - Load companions: For each path in `metadata.companions`, read file relative to the SKILL.md directory. If missing, log warning but don't fail.

4. **User overrides builtin**: Collect skills in a Map keyed by name. Process builtin first, then user — user entries overwrite builtin entries with same name.

5. **Change detection**: For each skill, call `store.getByHash(id)`. If returned hash matches `contentHash`, skip embedding. Otherwise, build embedding text (`description + tags joined + first 500 chars of body`), call `embedding.embed(text)`, call `store.upsertEmbedding(...)`.

6. **Orphan cleanup**: Call `store.getAllIds()`, compare against current skill IDs, call `store.deleteEmbedding(id)` for each orphan.

7. **Return**: `{ loaded: Array<SkillDefinition>, errors: Array<{ path, error }> }`

**Embedding text construction:**

```typescript
function buildEmbeddingText(metadata: SkillMetadata, body: string): string {
  const parts = [metadata.description];
  if (metadata.tags?.length) {
    parts.push(metadata.tags.join(', '));
  }
  parts.push(body.slice(0, 500));
  return parts.join('\n');
}
```

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(skill): implement skill loader with change detection`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Skill loader tests

**Verifies:** skills.AC4.1, skills.AC4.2, skills.AC4.3, skills.AC4.4, skills.AC4.5, skills.AC4.6, skills.AC4.7, skills.AC4.8, skills.AC4.9

**Files:**
- Create: `src/skill/loader.test.ts`

**Implementation:**

Tests use a temporary directory with mock skill files on the real filesystem, a mock `EmbeddingProvider` (from `src/integration/test-helpers.ts`), and a mock `SkillStore` (in-memory implementation of the interface).

**Testing:**

Create an in-memory mock SkillStore for unit testing (avoids needing Postgres):

```typescript
function createMockSkillStore(): SkillStore & { data: Map<string, { contentHash: string; embedding: ReadonlyArray<number> }> } {
  const data = new Map<string, { contentHash: string; embedding: ReadonlyArray<number> }>();
  return {
    data,
    async upsertEmbedding(id, _name, _desc, contentHash, embedding) {
      data.set(id, { contentHash, embedding });
    },
    async deleteEmbedding(id) { data.delete(id); },
    async getByHash(id) { return data.get(id)?.contentHash ?? null; },
    async searchByEmbedding(_embedding, limit, threshold) {
      return Array.from(data.entries())
        .slice(0, limit)
        .map(([id]) => ({ id, score: threshold + 0.1 }));
    },
    async getAllIds() { return Array.from(data.keys()); },
  };
}
```

Use `mkdirSync`/`writeFileSync` to create temp skill directories in `beforeEach`, `rmSync` in `afterEach`.

Tests to write:

- **skills.AC4.1:** Create `builtinDir/my-skill/SKILL.md` with valid content. Load. Verify skill appears in result with `source: 'builtin'`.
- **skills.AC4.2:** Create `userDir/my-skill/SKILL.md` with valid content. Load. Verify skill appears with `source: 'user'`.
- **skills.AC4.3:** Create both `builtinDir/overlap/SKILL.md` and `userDir/overlap/SKILL.md` with same name but different descriptions. Load. Verify only one skill with that name exists, and its source is `'user'`.
- **skills.AC4.4:** Load skills once (store gets entries). Load again without changing files. Verify `embed()` was NOT called on second load (mock tracks call count).
- **skills.AC4.5:** Load skills once. Modify a SKILL.md file (change description). Load again. Verify `embed()` was called for the changed skill.
- **skills.AC4.6:** Load skills (2 skills). Delete one SKILL.md directory. Load again. Verify the orphan ID was removed from store.
- **skills.AC4.7:** Create a skill with `companions: [companion.md]` and a `companion.md` file next to SKILL.md. Load. Verify the skill's `companions` array contains `{ name: 'companion.md', content: '...' }`.
- **skills.AC4.8:** Create a skill referencing a non-existent companion. Load. Verify skill loads successfully (no error), companion array is empty or missing entry.
- **skills.AC4.9:** Create a builtin skill named `test-skill`. Load. Verify its `id` is `'skill:builtin:test-skill'`.

**Verification:**

Run: `bun test src/skill/loader.test.ts`
Expected: All tests pass

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(skill): add loader tests and getAllIds to store interface`

<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 5-6) -->

<!-- START_TASK_5 -->
### Task 5: Skill registry implementation

**Verifies:** skills.AC5.1, skills.AC5.2, skills.AC5.3, skills.AC5.4, skills.AC5.5, skills.AC5.6, skills.AC5.7, skills.AC5.8

**Files:**
- Create: `src/skill/registry.ts`

**Implementation:**

Create `src/skill/registry.ts` following the factory-closure pattern from `src/memory/manager.ts`:

```typescript
// pattern: Imperative Shell

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { EmbeddingProvider } from '../embedding/types.ts';
import type { SkillStore } from './store.ts';
import type { SkillDefinition, SkillRegistry, SkillSearchResult } from './types.ts';
import { loadSkills } from './loader.ts';
import { parseSkillFile } from './parser.ts';
import crypto from 'node:crypto';
```

Factory function:

```typescript
type CreateSkillRegistryOptions = {
  readonly store: SkillStore;
  readonly embedding: EmbeddingProvider;
  readonly builtinDir: string;
  readonly userDir: string;
};

export function createSkillRegistry(options: CreateSkillRegistryOptions): SkillRegistry { ... }
```

**Internal state:** `Map<string, SkillDefinition>` keyed by skill name (not ID — name is the lookup key since user overrides builtin).

**Methods:**

- `load()`: Call `loadSkills(options)`, populate internal Map from result. Log any errors.

- `getAll()`: Return `Array.from(map.values())`.

- `getByName(name)`: Return `map.get(name)`.

- `search(query, limit = 10)`: Embed query via `options.embedding.embed(query)`, call `options.store.searchByEmbedding(embedding, limit, 0)`, map results to `SkillSearchResult` by resolving IDs against internal Map (need to maintain an ID→name lookup).

- `getRelevant(context, limit = 3, threshold = 0.3)`: Same as search but filtered by threshold, returns `SkillDefinition` objects instead of search results.

- `createUserSkill(name, description, body, tags?)`: Build SKILL.md content string with YAML frontmatter, write to `userDir/${name}/SKILL.md` (create directory if needed), parse, compute hash, embed, upsert to store, add to internal Map. Return the new SkillDefinition.

- `updateUserSkill(name, description, body, tags?)`: Check if skill exists and has `source: 'user'`. If builtin, throw error. Otherwise same as create (overwrite file).

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(skill): implement SkillRegistry with factory-closure pattern`

<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Skill registry tests

**Verifies:** skills.AC5.1, skills.AC5.2, skills.AC5.3, skills.AC5.4, skills.AC5.5, skills.AC5.6, skills.AC5.7, skills.AC5.8

**Files:**
- Create: `src/skill/registry.test.ts`

**Implementation:**

Tests use temp directories (like loader tests), mock EmbeddingProvider (from `src/integration/test-helpers.ts`), and mock SkillStore (same in-memory mock from loader tests — extract to a shared test helper if needed).

Set up: Create temp builtin and user dirs with valid SKILL.md files in `beforeEach`. Clean up in `afterEach`.

**Testing:**

Tests to write:

- **skills.AC5.1:** Load registry with skills. Call `getRelevant(context)` with a query string. Verify returned skills have similarity above threshold (mock store returns scores above threshold for matching skills).
- **skills.AC5.2:** Load 5 skills. Call `getRelevant(context, 2)`. Verify exactly 2 results returned.
- **skills.AC5.3:** Load 3 skills. Call `getAll()`. Verify 3 skills returned with correct metadata.
- **skills.AC5.4:** Load skills including one named `test-skill`. Call `getByName('test-skill')`. Verify correct skill returned. Call `getByName('nonexistent')`. Verify undefined.
- **skills.AC5.5:** Load skills. Call `search(query)`. Verify results are `SkillSearchResult` objects with `id`, `name`, `description`, `score` fields.
- **skills.AC5.6:** Call `createUserSkill('new-skill', 'A new skill', 'body content', ['tag1'])`. Verify: file written to `userDir/new-skill/SKILL.md`, skill appears in `getAll()`, skill has correct metadata.
- **skills.AC5.7:** Create a user skill, then call `updateUserSkill` with new description. Verify file updated, registry reflects new description.
- **skills.AC5.8:** Load a builtin skill. Call `updateUserSkill` on its name. Verify error is thrown indicating builtin skills cannot be updated.

**Verification:**

Run: `bun test src/skill/registry.test.ts`
Expected: All tests pass

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(skill): add registry tests`

<!-- END_TASK_6 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_7 -->
### Task 7: Update barrel exports

**Verifies:** None (infrastructure)

**Files:**
- Modify: `src/skill/index.ts`

**Implementation:**

Add loader and registry to barrel exports:

```typescript
export { loadSkills } from './loader.ts';
export { createSkillRegistry } from './registry.ts';
```

**Verification:**

Run: `bun run build`
Expected: Type-check passes

Run: `bun test src/skill/`
Expected: All skill tests pass

**Commit:** `feat(skill): export loader and registry from barrel`

<!-- END_TASK_7 -->
