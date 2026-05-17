# Knowledge Autonomy Implementation Plan — Phase 4: File Ingestion

**Goal:** Workspace file reading with semantic chunking into archival memory blocks

**Architecture:** FCIS split — `chunkDocument()` is a pure function (Functional Core) that splits text into semantically coherent chunks preserving heading context. `createIngestor()` is the Imperative Shell factory that orchestrates file reading, validation, chunking, embedding generation, and atomic storage. An `ingest_file` tool exposes this to the agent.

**Tech Stack:** TypeScript 5.7+, PostgreSQL 17, Bun

**Scope:** 7 phases from original design (phase 4 of 7)

**Codebase verified:** 2026-05-17

---

## Acceptance Criteria Coverage

This phase implements and tests:

### knowledge-autonomy.AC3: File Ingestion
- **knowledge-autonomy.AC3.1 Success:** Agent ingests a markdown file and chunks are stored as archival memory blocks with `knowledge:` label prefix
- **knowledge-autonomy.AC3.2 Success:** Each chunk preserves heading hierarchy context
- **knowledge-autonomy.AC3.3 Success:** Chunks have embeddings generated and stored
- **knowledge-autonomy.AC3.4 Success:** Re-ingesting the same file replaces old chunks atomically
- **knowledge-autonomy.AC3.5 Success:** Ingested chunks are retrievable via recall/semantic search
- **knowledge-autonomy.AC3.6 Failure:** Path traversal above workspace root is rejected
- **knowledge-autonomy.AC3.7 Failure:** Binary files and files over 1MB are rejected with descriptive error

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: chunkDocument pure function

**Files:**
- Create: `src/ingest/chunker.ts`

**Implementation:**

`src/ingest/chunker.ts` — Functional Core:

```typescript
// pattern: Functional Core

export type Chunk = {
  readonly content: string;
  readonly headingContext: string;
  readonly index: number;
  readonly tokenEstimate: number;
};

type ChunkOptions = {
  readonly maxChunkTokens?: number;
};

const DEFAULT_MAX_CHUNK_TOKENS = 1500;
const APPROX_CHARS_PER_TOKEN = 4;
```

The function splits markdown text on headings (lines starting with `#`), preserving heading hierarchy as context per chunk. Non-markdown files split on double newlines.

**Chunking algorithm:**

1. Detect if the text is markdown (contains lines starting with `#`)
2. **Markdown path:**
   - Split text into sections at heading boundaries (`/^#{1,6}\s/m`)
   - Track the current heading stack (e.g., `["# Title", "## Section", "### Subsection"]`)
   - When a new heading is encountered at level N, pop headings at level >= N from the stack, push the new heading
   - Each section's `headingContext` is the current heading stack joined with ` > `
   - If a section exceeds `maxChunkTokens`, split it further on double newlines
3. **Non-markdown path:**
   - Split on double newlines (`\n\n`)
   - `headingContext` is empty string
4. Estimate tokens as `content.length / APPROX_CHARS_PER_TOKEN`
5. Return `ReadonlyArray<Chunk>` with sequential indices starting at 0

**Key behaviours:**
- Empty chunks (whitespace-only after trimming) are filtered out
- The heading line itself is included in the chunk content (not just the context)
- Adjacent non-heading paragraphs are grouped together up to the token budget
- A chunk that starts with a heading includes that heading in both `content` and `headingContext`

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(ingest): add chunkDocument pure function for markdown-aware splitting`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: chunkDocument tests

**Verifies:** knowledge-autonomy.AC3.2

**Files:**
- Create: `src/ingest/chunker.test.ts`

**Testing:**

Tests must verify:
- knowledge-autonomy.AC3.2: Markdown with nested headings produces chunks that each carry their heading ancestry in `headingContext`
- Single heading document produces one chunk with heading context
- Multiple headings at same level produce separate chunks
- Nested headings (h1 > h2 > h3) produce correct context chain like `"# Title > ## Section > ### Sub"`
- Heading at same or higher level resets the context stack appropriately
- Non-markdown text splits on double newlines with empty headingContext
- Long sections exceeding `maxChunkTokens` are split further
- Empty/whitespace-only sections are filtered out
- Token estimates are approximately correct
- Chunk indices are sequential starting at 0

These are pure function tests — no database or I/O. Use inline string fixtures.

**Verification:**

Run: `bun test src/ingest/chunker.test.ts`
Expected: All tests pass

**Commit:** `test(ingest): add chunkDocument tests for heading context preservation`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Path validation pure function

**Files:**
- Create: `src/ingest/validate.ts`

**Implementation:**

```typescript
// pattern: Functional Core

import { resolve, relative } from 'node:path';

export type ValidationResult =
  | { valid: true; resolvedPath: string }
  | { valid: false; error: string };

const MAX_FILE_SIZE = 1_048_576; // 1MB

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv',
  '.zip', '.tar', '.gz', '.7z', '.rar',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
]);

export function validateIngestPath(filePath: string, workspaceRoot: string): ValidationResult {
  const resolved = resolve(workspaceRoot, filePath);
  const rel = relative(workspaceRoot, resolved);

  if (rel.startsWith('..')) {
    return { valid: false, error: `path traversal rejected: "${filePath}" resolves outside workspace root` };
  }

  const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) {
    return { valid: false, error: `binary file rejected: "${filePath}" (extension: ${ext})` };
  }

  return { valid: true, resolvedPath: resolved };
}

export type FileSizeResult =
  | { valid: true }
  | { valid: false; error: string };

export function validateFileSize(sizeBytes: number, filePath: string): FileSizeResult {
  if (sizeBytes > MAX_FILE_SIZE) {
    return { valid: false, error: `file too large: "${filePath}" is ${(sizeBytes / 1_048_576).toFixed(2)}MB (max 1MB)` };
  }
  return { valid: true };
}
```

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(ingest): add path validation for workspace boundary and file type checking`

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-6) -->

<!-- START_TASK_4 -->
### Task 4: createIngestor factory

**Files:**
- Create: `src/ingest/ingest.ts`
- Create: `src/ingest/index.ts`

**Implementation:**

`src/ingest/ingest.ts` — Imperative Shell:

```typescript
// pattern: Imperative Shell

import { readFile, stat } from 'node:fs/promises';
import type { MemoryStore } from '@/memory/store.js';
import type { EmbeddingProvider } from '@/embedding/types.js';
import type { PersistenceProvider } from '@/persistence/types.js';
import { chunkDocument } from './chunker.js';
import { validateIngestPath, validateFileSize } from './validate.js';

export type IngestResult = {
  readonly chunksCreated: number;
  readonly label: string;
};

export type Ingestor = {
  ingest(filePath: string): Promise<IngestResult>;
};

type IngestorDeps = {
  readonly memoryStore: MemoryStore;
  readonly embedding: EmbeddingProvider;
  readonly persistence: PersistenceProvider;
  readonly owner: string;
  readonly workspaceRoot: string;
};

export function createIngestor(deps: IngestorDeps): Ingestor {
  const { memoryStore, embedding, persistence, owner, workspaceRoot } = deps;

  return {
    async ingest(filePath) {
      // Validate path
      const pathResult = validateIngestPath(filePath, workspaceRoot);
      if (!pathResult.valid) {
        throw new Error(pathResult.error);
      }

      // Read and validate file
      const fileStat = await stat(pathResult.resolvedPath);
      const sizeResult = validateFileSize(fileStat.size, filePath);
      if (!sizeResult.valid) {
        throw new Error(sizeResult.error);
      }

      const content = await readFile(pathResult.resolvedPath, 'utf-8');

      // Chunk
      const chunks = chunkDocument(content);
      if (chunks.length === 0) {
        throw new Error(`file produced no chunks: "${filePath}"`);
      }

      // Derive label prefix from filename (strip path, keep name)
      const filename = filePath.replace(/^.*[\\/]/, '');
      const labelPrefix = `knowledge:${filename}`;

      // Generate embeddings in batch
      const texts = chunks.map(c =>
        c.headingContext ? `${c.headingContext}\n\n${c.content}` : c.content,
      );

      let embeddings: Array<Array<number> | null>;
      try {
        const results = await embedding.embedBatch(texts);
        embeddings = results;
      } catch {
        embeddings = chunks.map(() => null);
      }

      // Atomic re-ingestion: delete old + create new in transaction
      await persistence.withTransaction(async (query) => {
        // Delete existing chunks with this label prefix
        const existingBlocks = await memoryStore.getBlocksByLabelPrefix(owner, labelPrefix);
        for (const block of existingBlocks) {
          await memoryStore.deleteBlock(block.id);
        }

        // Create new chunks
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i]!;
          await memoryStore.createBlock({
            id: crypto.randomUUID(),
            owner,
            tier: 'archival',
            label: `${labelPrefix}:${chunk.index}`,
            content: chunk.headingContext
              ? `[Context: ${chunk.headingContext}]\n\n${chunk.content}`
              : chunk.content,
            embedding: embeddings[i] ?? null,
            permission: 'readwrite',
            pinned: false,
          });
        }
      });

      return { chunksCreated: chunks.length, label: labelPrefix };
    },
  };
}
```

Design note: The `withTransaction()` call wraps delete + create for atomicity (AC3.4). The `MemoryStore` methods (`getBlocksByLabelPrefix`, `deleteBlock`, `createBlock`) all use the same `PersistenceProvider.query` function, which checks `AsyncLocalStorage` for an active transaction context (`src/persistence/postgres.ts:89-126`). This means calls inside `withTransaction()` automatically participate in the transaction via transparent nesting — no special handling needed.

`src/ingest/index.ts`:

```typescript
export { chunkDocument } from './chunker.js';
export type { Chunk } from './chunker.js';
export { createIngestor } from './ingest.js';
export type { Ingestor, IngestResult } from './ingest.js';
export { validateIngestPath, validateFileSize } from './validate.js';
```

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(ingest): add createIngestor factory with atomic re-ingestion`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: ingest_file tool

**Files:**
- Create: `src/tool/builtin/ingest.ts`

**Implementation:**

```typescript
// pattern: Imperative Shell

import type { Tool } from '../types.js';
import type { Ingestor } from '@/ingest/ingest.js';

export function createIngestTool(ingestor: Ingestor): Tool {
  return {
    definition: {
      name: 'ingest_file',
      description: 'Read a file from the workspace, split it into semantic chunks, and store the chunks as archival memory blocks with embeddings. Supports markdown (heading-aware chunking) and plain text. Re-ingesting the same file replaces old chunks atomically. Max file size: 1MB.',
      parameters: [
        {
          name: 'path',
          type: 'string',
          description: 'File path relative to workspace root (e.g., "docs/guide.md")',
          required: true,
        },
      ],
    },
    handler: async (params) => {
      const path = params['path'] as string;
      try {
        const result = await ingestor.ingest(path);
        return {
          success: true,
          output: `Ingested "${path}": ${result.chunksCreated} chunks stored with label prefix "${result.label}".`,
        };
      } catch (error) {
        return {
          success: false,
          output: '',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
```

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(ingest): add ingest_file agent tool`

<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Ingestor and validation tests

**Verifies:** knowledge-autonomy.AC3.1, knowledge-autonomy.AC3.3, knowledge-autonomy.AC3.4, knowledge-autonomy.AC3.5, knowledge-autonomy.AC3.6, knowledge-autonomy.AC3.7

**Files:**
- Create: `src/ingest/validate.test.ts`
- Create: `src/ingest/ingest.test.ts`

**Testing:**

`validate.test.ts` — Pure function tests:

Tests must verify:
- knowledge-autonomy.AC3.6: Path traversal with `../` above workspace root returns `{ valid: false }` with descriptive error
- knowledge-autonomy.AC3.6: Absolute paths outside workspace root are rejected
- knowledge-autonomy.AC3.7: Binary file extensions (.png, .pdf, .zip, etc.) are rejected with descriptive error
- knowledge-autonomy.AC3.7: `validateFileSize()` rejects files over 1MB with descriptive error
- Valid relative paths within workspace resolve correctly
- Nested paths like `docs/guide.md` resolve correctly
- Edge cases: empty filename, path with `.` components

`ingest.test.ts` — Integration tests against real PostgreSQL:

Tests must verify:
- knowledge-autonomy.AC3.1: Ingesting a markdown file creates archival memory blocks with `knowledge:` label prefix
- knowledge-autonomy.AC3.3: Created blocks have non-null embeddings (use mock embedding provider from `src/integration/test-helpers.ts`)
- knowledge-autonomy.AC3.4: Re-ingesting the same file deletes old blocks and creates new ones; block count matches new file content
- knowledge-autonomy.AC3.5: Blocks are retrievable via `getBlocksByLabelPrefix(owner, 'knowledge:filename')`
- knowledge-autonomy.AC3.6: Calling `ingest()` with traversal path throws an error
- knowledge-autonomy.AC3.7: Calling `ingest()` with a binary file path throws an error

Test setup:
- Create a temporary workspace directory with test files (use `mkdtemp`)
- Write test markdown file(s) with multiple headings
- Connect persistence, run migrations
- Use `createMockEmbeddingProvider()` from `src/integration/test-helpers.ts`
- Generate unique `TEST_OWNER`
- `afterAll`: clean up test data and temporary directory

**Verification:**

Run: `bun test src/ingest/`
Expected: All tests pass

**Commit:** `test(ingest): add validation and ingestor integration tests`

<!-- END_TASK_6 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_7 -->
### Task 7: Composition root wiring

**Files:**
- Modify: `src/index.ts` (add imports, create ingestor, register tool)

**Implementation:**

Add imports:

```typescript
import { createIngestor } from '@/ingest';
import { createIngestTool } from '@/tool/builtin/ingest';
```

After the memory store and embedding provider are created, create the ingestor:

```typescript
if (embedding) {
  const ingestor = createIngestor({
    memoryStore,
    embedding,
    persistence,
    owner: AGENT_OWNER,
    workspaceRoot: resolve(config.runtime.working_dir),
  });
  registry.register(createIngestTool(ingestor));
  console.log('ingest tool registered');
}
```

The ingest tool is only registered when an embedding provider is configured — without embeddings, chunks would be stored without vectors and semantic search wouldn't work (AC3.5 depends on embeddings).

**Verification:**

Run: `bun run build`
Expected: Type-check passes

Run: `bun test`
Expected: All existing tests still pass

**Commit:** `feat(ingest): wire ingestor and tool into composition root`

<!-- END_TASK_7 -->
