# Knowledge Autonomy Implementation Plan — Phase 6: Archivist Pipeline

**Goal:** Six-stage knowledge maintenance pipeline with incremental and full modes for autonomous memory curation

**Architecture:** FCIS split — individual stage functions are Functional Core (pure transforms on block snapshots), the pipeline orchestrator is Imperative Shell (I/O, scheduling, budget tracking). Each stage receives a snapshot from scan and returns actions to apply. The pipeline applies actions between stages.

**Tech Stack:** TypeScript 5.7+, PostgreSQL 17 with pgvector, Bun

**Scope:** 7 phases from original design (phase 6 of 7)

**Codebase verified:** 2026-05-17

---

## Acceptance Criteria Coverage

This phase implements and tests:

### knowledge-autonomy.AC4: Archivist
- **knowledge-autonomy.AC4.1 Success:** Scan stage enumerates all mutable (readwrite, non-pinned) blocks in working and archival tiers
- **knowledge-autonomy.AC4.2 Success:** Dedup stage identifies near-duplicate blocks above similarity threshold and returns merge candidates
- **knowledge-autonomy.AC4.3 Success:** Consolidate stage merges duplicate groups into single blocks via summarization model
- **knowledge-autonomy.AC4.4 Success:** Crossref stage appends related block references to block content
- **knowledge-autonomy.AC4.5 Success:** Prune stage removes empty and whitespace-only blocks
- **knowledge-autonomy.AC4.6 Success:** Reflect stage writes observations to `archivist:reflection` working memory block
- **knowledge-autonomy.AC4.10 Failure:** Archivist skips readonly, familiar, pinned, append blocks and archivist:*/diary:* labels
- **knowledge-autonomy.AC4.11 Failure:** Missing embedding provider causes dedup/crossref to be skipped (not crash), other stages continue

---

<!-- START_TASK_1 -->
### Task 1: Archivist config schema

**Files:**
- Modify: `src/config/schema.ts` (add `ArchivistConfigSchema` before `AppConfigSchema`, add `archivist` field, add type export)

**Implementation:**

Add `ArchivistConfigSchema` before `AppConfigSchema` (around line ~245):

```typescript
const ArchivistConfigSchema = z.object({
  enabled: z.boolean().default(true),
  inner_conversation_id: z.string().optional(),
  dedup_threshold: z.number().min(0).max(1).default(0.92),
  crossref_threshold: z.number().min(0).max(1).default(0.75),
  token_budget: z.number().int().positive().default(50000),
  incremental_cron: z.string().default('0 */3 * * *'),
  sleep_offset_hours: z.number().int().nonnegative().default(3),
});
```

Add to `AppConfigSchema`:

```typescript
archivist: ArchivistConfigSchema.optional(),
```

Add type export:

```typescript
export type ArchivistConfig = z.infer<typeof ArchivistConfigSchema>;
```

Also export `ArchivistConfigSchema` for tests.

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(archivist): add archivist config schema`

<!-- END_TASK_1 -->

<!-- START_SUBCOMPONENT_A (tasks 2-4) -->

<!-- START_TASK_2 -->
### Task 2: Archivist types

**Files:**
- Create: `src/archivist/types.ts`

**Implementation:**

```typescript
// pattern: Functional Core

import type { MemoryBlock, MemoryTier } from '@/memory/types.js';

export type BlockSnapshot = {
  readonly id: string;
  readonly label: string;
  readonly tier: MemoryTier;
  readonly content: string;
  readonly contentHash: string;
  readonly embedding: ReadonlyArray<number> | null;
};

export type ScanResult = {
  readonly blocks: ReadonlyArray<BlockSnapshot>;
  readonly scannedAt: Date;
};

export type DedupGroup = {
  readonly canonical: BlockSnapshot;
  readonly duplicates: ReadonlyArray<BlockSnapshot>;
  readonly similarity: number;
};

export type DedupResult = {
  readonly groups: ReadonlyArray<DedupGroup>;
  readonly skipped: boolean;
};

export type ConsolidateAction = {
  readonly group: DedupGroup;
  readonly mergedContent: string;
};

export type ConsolidateResult = {
  readonly actions: ReadonlyArray<ConsolidateAction>;
  readonly tokensUsed: number;
  readonly skipped: boolean;
};

export type CrossrefAction = {
  readonly blockId: string;
  readonly relatedLabels: ReadonlyArray<string>;
};

export type CrossrefResult = {
  readonly actions: ReadonlyArray<CrossrefAction>;
  readonly skipped: boolean;
};

export type PruneResult = {
  readonly prunedIds: ReadonlyArray<string>;
};

export type ReflectResult = {
  readonly reflection: string;
  readonly tokensUsed: number;
  readonly skipped: boolean;
};

export type PipelineMode = 'incremental' | 'full';

export type PipelineResult = {
  readonly mode: PipelineMode;
  readonly scanned: number;
  readonly deduped: number;
  readonly consolidated: number;
  readonly crossreffed: number;
  readonly pruned: number;
  readonly reflected: boolean;
  readonly totalTokensUsed: number;
};
```

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(archivist): add archivist pipeline types`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Scan stage

**Files:**
- Create: `src/archivist/stages/scan.ts`

**Implementation:**

The scan stage enumerates all mutable memory blocks, filtering to only `readwrite` permission, non-pinned, in `working` and `archival` tiers, excluding `archivist:*` and `diary:*` labels.

```typescript
// pattern: Imperative Shell

import type { MemoryStore } from '@/memory/store.js';
import type { MemoryBlock } from '@/memory/types.js';
import type { BlockSnapshot, ScanResult } from '../types.js';
import { createHash } from 'node:crypto';

type ScanDeps = {
  readonly memoryStore: MemoryStore;
  readonly owner: string;
};

const EXCLUDED_LABEL_PREFIXES = ['archivist:', 'diary:'];

function isEligible(block: MemoryBlock): boolean {
  if (block.permission !== 'readwrite') return false;
  if (block.pinned) return false;
  for (const prefix of EXCLUDED_LABEL_PREFIXES) {
    if (block.label.startsWith(prefix)) return false;
  }
  return true;
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function toSnapshot(block: MemoryBlock): BlockSnapshot {
  return {
    id: block.id,
    label: block.label,
    tier: block.tier,
    content: block.content,
    contentHash: hashContent(block.content),
    embedding: block.embedding,
  };
}

export async function scan(deps: ScanDeps): Promise<ScanResult> {
  const { memoryStore, owner } = deps;

  const workingBlocks = await memoryStore.getBlocksByTier(owner, 'working');
  const archivalBlocks = await memoryStore.getBlocksByTier(owner, 'archival');
  const allBlocks = [...workingBlocks, ...archivalBlocks];

  const eligible = allBlocks.filter(isEligible).map(toSnapshot);

  return {
    blocks: eligible,
    scannedAt: new Date(),
  };
}
```

Export `isEligible` and `toSnapshot` for unit testing (they are pure functions).

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(archivist): add scan stage`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Scan stage tests

**Verifies:** knowledge-autonomy.AC4.1, knowledge-autonomy.AC4.10

**Files:**
- Create: `src/archivist/stages/scan.test.ts`

**Testing:**

Tests must verify:
- knowledge-autonomy.AC4.1: Scan returns blocks from both `working` and `archival` tiers
- knowledge-autonomy.AC4.1: Scan only includes `readwrite` permission blocks
- knowledge-autonomy.AC4.10: Scan excludes `readonly` permission blocks
- knowledge-autonomy.AC4.10: Scan excludes `familiar` permission blocks
- knowledge-autonomy.AC4.10: Scan excludes `append` permission blocks
- knowledge-autonomy.AC4.10: Scan excludes pinned blocks
- knowledge-autonomy.AC4.10: Scan excludes blocks with `archivist:` label prefix
- knowledge-autonomy.AC4.10: Scan excludes blocks with `diary:` label prefix
- Scan includes `readwrite`, non-pinned blocks without excluded labels
- `contentHash` is deterministic for same content

Use a mock `MemoryStore` that returns configurable blocks. Test the `isEligible` filter function directly (it's pure).

**Verification:**

Run: `bun test src/archivist/stages/scan.test.ts`
Expected: All tests pass

**Commit:** `test(archivist): add scan stage tests`

<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 5-7) -->

<!-- START_TASK_5 -->
### Task 5: Dedup stage

**Files:**
- Create: `src/archivist/stages/dedup.ts`

**Implementation:**

The dedup stage compares all blocks with embeddings pairwise using cosine similarity. Blocks above the threshold are grouped as duplicates.

```typescript
// pattern: Functional Core

import type { BlockSnapshot, DedupGroup, DedupResult } from '../types.js';

function cosineSimilarity(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

export function dedup(
  blocks: ReadonlyArray<BlockSnapshot>,
  threshold: number,
): DedupResult {
  const withEmbeddings = blocks.filter(b => b.embedding !== null);
  if (withEmbeddings.length === 0) {
    return { groups: [], skipped: true };
  }

  const merged = new Set<string>();
  const groups: Array<DedupGroup> = [];

  for (let i = 0; i < withEmbeddings.length; i++) {
    const canonical = withEmbeddings[i]!;
    if (merged.has(canonical.id)) continue;

    const duplicates: Array<BlockSnapshot> = [];
    let maxSim = 0;

    for (let j = i + 1; j < withEmbeddings.length; j++) {
      const candidate = withEmbeddings[j]!;
      if (merged.has(candidate.id)) continue;

      const sim = cosineSimilarity(canonical.embedding!, candidate.embedding!);
      if (sim >= threshold) {
        duplicates.push(candidate);
        merged.add(candidate.id);
        maxSim = Math.max(maxSim, sim);
      }
    }

    if (duplicates.length > 0) {
      merged.add(canonical.id);
      groups.push({ canonical, duplicates, similarity: maxSim });
    }
  }

  return { groups, skipped: false };
}
```

Export `cosineSimilarity` for unit testing.

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(archivist): add dedup stage with cosine similarity`

<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Consolidate, crossref, prune, reflect stages

**Files:**
- Create: `src/archivist/stages/consolidate.ts`
- Create: `src/archivist/stages/crossref.ts`
- Create: `src/archivist/stages/prune.ts`
- Create: `src/archivist/stages/reflect.ts`
- Create: `src/archivist/stages/index.ts`

**Implementation:**

`consolidate.ts` — Uses summarization model to merge duplicate groups (Imperative Shell):

```typescript
// pattern: Imperative Shell

import type { ModelProvider } from '@/model/types.js';
import type { DedupGroup, ConsolidateAction, ConsolidateResult } from '../types.js';

type ConsolidateDeps = {
  readonly model: ModelProvider | null;
  readonly tokenBudget: number;
};

export async function consolidate(
  groups: ReadonlyArray<DedupGroup>,
  deps: ConsolidateDeps,
): Promise<ConsolidateResult> {
  if (!deps.model || groups.length === 0) {
    return { actions: [], tokensUsed: 0, skipped: !deps.model };
  }

  const actions: Array<ConsolidateAction> = [];
  let tokensUsed = 0;

  for (const group of groups) {
    const allContents = [group.canonical, ...group.duplicates]
      .map(b => `[${b.label}]\n${b.content}`)
      .join('\n\n---\n\n');

    const estimatedInputTokens = Math.ceil(allContents.length / 4);
    if (tokensUsed + estimatedInputTokens > deps.tokenBudget) break;

    const response = await deps.model.complete({
      system: 'You are a knowledge consolidation agent. Merge the following duplicate memory blocks into a single coherent block. Preserve all unique information. Be concise.',
      messages: [{ role: 'user', content: allContents }],
      max_tokens: 1024,
    });

    const mergedContent = response.content;
    tokensUsed += estimatedInputTokens + Math.ceil(mergedContent.length / 4);
    actions.push({ group, mergedContent });
  }

  return { actions, tokensUsed, skipped: false };
}
```

Note: The actual `ModelProvider.complete()` signature may differ — check `src/model/types.ts` at implementation time. The compaction module at `src/compaction/compactor.ts` shows the established calling pattern.

`crossref.ts` — Finds related blocks below dedup threshold but above crossref threshold (Functional Core):

```typescript
// pattern: Functional Core

import type { BlockSnapshot, CrossrefAction, CrossrefResult } from '../types.js';

export function crossref(
  blocks: ReadonlyArray<BlockSnapshot>,
  crossrefThreshold: number,
  dedupThreshold: number,
): CrossrefResult {
  const withEmbeddings = blocks.filter(b => b.embedding !== null);
  if (withEmbeddings.length === 0) {
    return { actions: [], skipped: true };
  }

  const actions: Array<CrossrefAction> = [];

  for (const block of withEmbeddings) {
    const related: Array<string> = [];
    for (const other of withEmbeddings) {
      if (other.id === block.id) continue;
      const sim = cosineSimilarity(block.embedding!, other.embedding!);
      if (sim >= crossrefThreshold && sim < dedupThreshold) {
        related.push(other.label);
      }
    }
    if (related.length > 0) {
      actions.push({ blockId: block.id, relatedLabels: related });
    }
  }

  return { actions, skipped: false };
}
```

Uses the same `cosineSimilarity` function from the dedup stage (import it or co-locate in a shared utils file).

`prune.ts` — Removes empty/whitespace-only blocks (Functional Core):

```typescript
// pattern: Functional Core

import type { BlockSnapshot, PruneResult } from '../types.js';

export function prune(blocks: ReadonlyArray<BlockSnapshot>): PruneResult {
  const prunedIds = blocks
    .filter(b => b.content.trim().length === 0)
    .map(b => b.id);
  return { prunedIds };
}
```

`reflect.ts` — Writes archivist observations to working memory (Imperative Shell):

```typescript
// pattern: Imperative Shell

import type { ModelProvider } from '@/model/types.js';
import type { PipelineResult, ReflectResult } from '../types.js';

type ReflectDeps = {
  readonly model: ModelProvider | null;
  readonly tokenBudget: number;
  readonly tokensUsedSoFar: number;
};

export async function reflect(
  stats: PipelineResult,
  deps: ReflectDeps,
): Promise<ReflectResult> {
  if (!deps.model) {
    return { reflection: '', tokensUsed: 0, skipped: true };
  }
  if (deps.tokensUsedSoFar >= deps.tokenBudget) {
    return { reflection: '', tokensUsed: 0, skipped: true };
  }

  const prompt = `Memory maintenance pipeline completed (${stats.mode} mode).
Scanned: ${stats.scanned} blocks
Deduplicated: ${stats.deduped} groups merged
Consolidated: ${stats.consolidated} blocks
Cross-referenced: ${stats.crossreffed} blocks
Pruned: ${stats.pruned} empty blocks

Write a brief (2-3 sentence) observation about the health and organization of this memory system. Note any patterns or concerns.`;

  const response = await deps.model.complete({
    system: 'You are a knowledge archivist reflecting on memory health. Be concise and observational.',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 256,
  });

  return {
    reflection: response.content,
    tokensUsed: Math.ceil(prompt.length / 4) + Math.ceil(response.content.length / 4),
    skipped: false,
  };
}
```

`stages/index.ts` — Barrel exports:

```typescript
export { scan } from './scan.js';
export { dedup } from './dedup.js';
export { consolidate } from './consolidate.js';
export { crossref } from './crossref.js';
export { prune } from './prune.js';
export { reflect } from './reflect.js';
```

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(archivist): add consolidate, crossref, prune, reflect stages`

<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Stage unit tests

**Verifies:** knowledge-autonomy.AC4.2, knowledge-autonomy.AC4.3, knowledge-autonomy.AC4.4, knowledge-autonomy.AC4.5, knowledge-autonomy.AC4.6, knowledge-autonomy.AC4.11

**Files:**
- Create: `src/archivist/stages/dedup.test.ts`
- Create: `src/archivist/stages/consolidate.test.ts`
- Create: `src/archivist/stages/crossref.test.ts`
- Create: `src/archivist/stages/prune.test.ts`
- Create: `src/archivist/stages/reflect.test.ts`

**Testing:**

`dedup.test.ts`:
- knowledge-autonomy.AC4.2: Two blocks with similarity above threshold are grouped together
- knowledge-autonomy.AC4.2: Blocks below threshold are NOT grouped
- knowledge-autonomy.AC4.11: Blocks without embeddings are skipped (result.skipped = true when all null)
- `cosineSimilarity` returns correct values for known vectors
- Multiple duplicate groups are identified independently

`consolidate.test.ts`:
- knowledge-autonomy.AC4.3: Model is called with all block contents from a group
- knowledge-autonomy.AC4.3: Returns merged content from model response
- knowledge-autonomy.AC4.11: Returns `skipped: true` when no model provider
- Token budget: stops processing groups when budget is exhausted

Mock the `ModelProvider` to return fixed consolidation text.

`crossref.test.ts`:
- knowledge-autonomy.AC4.4: Blocks with similarity in `[crossrefThreshold, dedupThreshold)` get related labels
- Blocks at or above dedupThreshold are NOT cross-referenced (they're dedup candidates)
- Blocks below crossrefThreshold are NOT cross-referenced
- knowledge-autonomy.AC4.11: Returns `skipped: true` when no embeddings

`prune.test.ts`:
- knowledge-autonomy.AC4.5: Empty string content blocks are identified for pruning
- knowledge-autonomy.AC4.5: Whitespace-only blocks are identified for pruning
- Blocks with real content are NOT pruned

`reflect.test.ts`:
- knowledge-autonomy.AC4.6: Model is called with pipeline stats summary
- knowledge-autonomy.AC4.6: Reflection text is returned from model response
- knowledge-autonomy.AC4.11: Returns `skipped: true` when no model provider

All stage tests use mock dependencies — no database needed. `dedup`, `crossref`, and `prune` are pure functions. `consolidate` and `reflect` need mock `ModelProvider`.

**Verification:**

Run: `bun test src/archivist/stages/`
Expected: All tests pass

**Commit:** `test(archivist): add stage unit tests`

<!-- END_TASK_7 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 8-10) -->

<!-- START_TASK_8 -->
### Task 8: Pipeline orchestrator

**Files:**
- Create: `src/archivist/pipeline.ts`
- Create: `src/archivist/index.ts`

**Implementation:**

`pipeline.ts` — Imperative Shell orchestrating all six stages:

```typescript
// pattern: Imperative Shell

import type { MemoryStore } from '@/memory/store.js';
import type { MemoryManager } from '@/memory/manager.js';
import type { EmbeddingProvider } from '@/embedding/types.js';
import type { ModelProvider } from '@/model/types.js';
import type { PersistenceProvider } from '@/persistence/types.js';
import type { PipelineMode, PipelineResult } from './types.js';
import { scan } from './stages/scan.js';
import { dedup } from './stages/dedup.js';
import { consolidate } from './stages/consolidate.js';
import { crossref } from './stages/crossref.js';
import { prune } from './stages/prune.js';
import { reflect } from './stages/reflect.js';

export type ArchivistPipelineDeps = {
  readonly memoryStore: MemoryStore;
  readonly memoryManager: MemoryManager;
  readonly embedding: EmbeddingProvider | null;
  readonly summarizationModel: ModelProvider | null;
  readonly persistence: PersistenceProvider;
  readonly owner: string;
  readonly dedupThreshold: number;
  readonly crossrefThreshold: number;
  readonly tokenBudget: number;
};

export type ArchivistPipeline = {
  runIncremental(): Promise<PipelineResult>;
  runFull(): Promise<PipelineResult>;
};

export function createArchivistPipeline(deps: ArchivistPipelineDeps): ArchivistPipeline {
  // Implementation:
  // - runIncremental: scan → dedup → prune (no LLM calls)
  // - runFull: scan → dedup → consolidate → crossref → prune → reflect

  // Both modes:
  // 1. Run scan to get block snapshots
  // 2. Run dedup (skips if no embeddings — AC4.11)
  // 3. (Full only) Run consolidate on dedup groups via summarization model
  //    - Apply consolidation: create merged block, delete originals
  //    - Track token budget, skip remaining LLM stages if exhausted
  // 4. (Full only) Run crossref on remaining blocks
  //    - Apply crossref: append [Related: ...] to block content via memoryStore.updateBlock()
  // 5. Run prune — delete empty/whitespace blocks
  // 6. (Full only) Run reflect — write observations to archivist:reflection working memory

  // Stage failures: catch errors per stage, log, continue to next stage
  // Budget tracking: consolidate and reflect report tokensUsed; sum for total

  // Return PipelineResult with counts of actions taken per stage
}
```

`index.ts` — Barrel exports:

```typescript
export type { ArchivistPipeline, ArchivistPipelineDeps } from './pipeline.js';
export { createArchivistPipeline } from './pipeline.js';
export type {
  BlockSnapshot, ScanResult, DedupGroup, DedupResult,
  ConsolidateAction, ConsolidateResult, CrossrefAction, CrossrefResult,
  PruneResult, ReflectResult, PipelineMode, PipelineResult,
} from './types.js';
```

Key implementation details:
- Consolidation actions are applied within a transaction: delete all duplicates in a group, create one merged block (preserving the canonical's label/tier)
- New merged block gets a fresh embedding via `embedding.embed()` on the merged content
- Crossref actions use `memoryStore.updateBlock()` to append `[Related: ...]` text
- Prune actions use `memoryStore.deleteBlock()` for each pruned block
- Reflect uses `memoryManager.write('archivist:reflection', reflectionText, 'working')` — overwrites previous reflection
- Each stage wrapped in try/catch — stage failure logs and continues

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(archivist): add pipeline orchestrator with incremental and full modes`

<!-- END_TASK_8 -->

<!-- START_TASK_9 -->
### Task 9: Pipeline integration tests

**Verifies:** knowledge-autonomy.AC4.1, knowledge-autonomy.AC4.2, knowledge-autonomy.AC4.3, knowledge-autonomy.AC4.4, knowledge-autonomy.AC4.5, knowledge-autonomy.AC4.6, knowledge-autonomy.AC4.11

**Files:**
- Create: `src/archivist/pipeline.test.ts`

**Testing:**

Integration tests against real PostgreSQL:

Tests must verify:
- knowledge-autonomy.AC4.1 + AC4.2: `runIncremental()` scans eligible blocks and identifies duplicates
- knowledge-autonomy.AC4.5: `runIncremental()` prunes empty blocks (verify via DB query after run)
- knowledge-autonomy.AC4.3: `runFull()` consolidates duplicate groups — original blocks deleted, merged block created (verify via DB)
- knowledge-autonomy.AC4.4: `runFull()` appends related block references (verify block content contains `[Related: ...]`)
- knowledge-autonomy.AC4.6: `runFull()` writes reflection to `archivist:reflection` working memory block
- knowledge-autonomy.AC4.11: With no embedding provider, dedup and crossref are skipped but prune still runs
- knowledge-autonomy.AC4.11: With no summarization model, consolidate and reflect are skipped but other stages run
- Stage failure in one stage doesn't prevent other stages from running

Test setup:
- Connect persistence, run migrations
- Create test memory blocks with known embeddings (use `createMockEmbeddingProvider()` from `src/integration/test-helpers.ts`)
- Some blocks identical/near-identical (for dedup testing)
- Some blocks with similar but not duplicate content (for crossref testing)
- Some empty blocks (for prune testing)
- Some blocks with excluded labels (`diary:*`, `archivist:*`) to verify filtering
- Mock `ModelProvider` for consolidation and reflection
- Generate unique `TEST_OWNER`
- `afterAll`: clean up test data, disconnect

**Verification:**

Run: `bun test src/archivist/pipeline.test.ts`
Expected: All tests pass

**Commit:** `test(archivist): add pipeline integration tests`

<!-- END_TASK_9 -->

<!-- START_TASK_10 -->
### Task 10: Archivist state tracking

**Files:**
- Modify: `src/archivist/pipeline.ts` (add state tracking via `archivist:state` working memory block)

**Implementation:**

After each scan, the pipeline writes the current content hash snapshot to `archivist:state` working memory block. This enables incremental change detection — the next run can compare current hashes against the stored snapshot to identify blocks that changed.

Add to the pipeline:
- After scan: load `archivist:state` block, compare hashes, identify changed blocks
- After pipeline completes: write updated hash snapshot to `archivist:state`
- State format: JSON object mapping `blockId → contentHash`
- Use `memoryManager.write('archivist:state', JSON.stringify(stateMap), 'working')`

This is an optimization for incremental runs — if no blocks changed since last scan, the pipeline can short-circuit.

**Verification:**

Run: `bun run build`
Expected: Type-check passes

Run: `bun test src/archivist/`
Expected: All tests pass

**Commit:** `feat(archivist): add state tracking for incremental change detection`

<!-- END_TASK_10 -->

<!-- END_SUBCOMPONENT_C -->
