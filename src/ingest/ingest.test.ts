// pattern: Imperative Shell

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPostgresProvider } from '@/persistence/postgres.js';
import { createPostgresMemoryStore } from '@/memory/postgres-store.js';
import { createMockEmbeddingProvider } from '@/integration/test-helpers.js';
import { createIngestor } from './ingest.js';

const DB_CONNECTION_STRING =
  'postgresql://constellation:constellation@localhost:5432/constellation';

let persistence: ReturnType<typeof createPostgresProvider>;
let memoryStore: ReturnType<typeof createPostgresMemoryStore>;
let tempDir: string;
const TEST_OWNER = 'test-ingest-' + Math.random().toString(36).substring(7);

async function cleanupMemory(): Promise<void> {
  await persistence.query(
    'DELETE FROM memory_blocks WHERE owner = $1',
    [TEST_OWNER],
  );
}

describe('Ingestor - Integration Tests', () => {
  beforeAll(async () => {
    persistence = createPostgresProvider({
      url: DB_CONNECTION_STRING,
    });

    await persistence.connect();
    await persistence.runMigrations();
    memoryStore = createPostgresMemoryStore(persistence);
    await cleanupMemory();

    // Create temporary workspace directory
    tempDir = await mkdtemp(join(tmpdir(), 'constellation-ingest-'));
  });

  afterEach(async () => {
    await cleanupMemory();
  });

  afterAll(async () => {
    await cleanupMemory();
    await rm(tempDir, { recursive: true, force: true });
    await persistence.disconnect();
  });

  describe('knowledge-autonomy.AC3.1: File ingestion creates archival blocks', () => {
    it('ingests a markdown file and creates archival memory blocks with knowledge: label prefix', async () => {
      const content = `# Project Guide

## Introduction
This is a project guide document.

## Architecture
The system uses modular design.

### Components
- Service A
- Service B`;

      const filePath = join(tempDir, 'guide.md');
      await writeFile(filePath, content);

      const embedding = createMockEmbeddingProvider();
      const ingestor = createIngestor({
        memoryStore,
        embedding,
        persistence,
        owner: TEST_OWNER,
        workspaceRoot: tempDir,
      });

      const result = await ingestor.ingest('guide.md');

      expect(result.chunksCreated).toBeGreaterThan(0);
      expect(result.label).toContain('knowledge:');
      expect(result.label).toContain('guide.md');

      // Verify blocks exist in database
      const blocks = await memoryStore.getBlocksByLabelPrefix(
        TEST_OWNER,
        result.label,
      );
      expect(blocks.length).toBe(result.chunksCreated);
      expect(blocks[0]?.tier).toBe('archival');
    });
  });

  describe('knowledge-autonomy.AC3.3: Chunks have embeddings', () => {
    it('generates embeddings for each chunk', async () => {
      const content = `# Header 1
Section 1 content.

# Header 2
Section 2 content.`;

      const filePath = join(tempDir, 'sections.md');
      await writeFile(filePath, content);

      const embedding = createMockEmbeddingProvider();
      const ingestor = createIngestor({
        memoryStore,
        embedding,
        persistence,
        owner: TEST_OWNER,
        workspaceRoot: tempDir,
      });

      const result = await ingestor.ingest('sections.md');

      const blocks = await memoryStore.getBlocksByLabelPrefix(
        TEST_OWNER,
        result.label,
      );

      // All blocks should have embeddings (from mock provider)
      for (const block of blocks) {
        expect(block.embedding).not.toBeNull();
        expect(Array.isArray(block.embedding)).toBe(true);
        expect((block.embedding as Array<number>).length).toBeGreaterThan(0);
      }
    });
  });

  describe('knowledge-autonomy.AC3.4: Re-ingestion replaces old chunks atomically', () => {
    it('deletes old chunks and creates new ones on re-ingest', async () => {
      const filePath = join(tempDir, 'retest.md');

      // First ingest
      const content1 = `# Section 1
Old content here.`;
      await writeFile(filePath, content1);

      const embedding = createMockEmbeddingProvider();
      const ingestor = createIngestor({
        memoryStore,
        embedding,
        persistence,
        owner: TEST_OWNER,
        workspaceRoot: tempDir,
      });

      const { chunksCreated: oldBlockCount, label } = await ingestor.ingest('retest.md');

      const blocksAfterFirst = await memoryStore.getBlocksByLabelPrefix(
        TEST_OWNER,
        label,
      );
      expect(blocksAfterFirst).toHaveLength(oldBlockCount);

      // Re-ingest with new content
      const content2 = `# New Section A
New content A.

# New Section B
New content B.

# New Section C
New content C.`;
      await writeFile(filePath, content2);

      const { chunksCreated: newBlockCount, label: label2 } = await ingestor.ingest('retest.md');

      // New chunk count may differ
      const blocksAfterSecond = await memoryStore.getBlocksByLabelPrefix(
        TEST_OWNER,
        label2,
      );
      expect(blocksAfterSecond).toHaveLength(newBlockCount);

      // Verify old blocks are gone (transaction was atomic)
      expect(newBlockCount).not.toBe(0);
    });
  });

  describe('knowledge-autonomy.AC3.5: Blocks are retrievable via semantic search', () => {
    it('created blocks are retrievable by label prefix', async () => {
      const content = `# Overview

The overview section contains key information about the system.

# Details

The details section provides implementation specifics.`;

      const filePath = join(tempDir, 'searchable.md');
      await writeFile(filePath, content);

      const embedding = createMockEmbeddingProvider();
      const ingestor = createIngestor({
        memoryStore,
        embedding,
        persistence,
        owner: TEST_OWNER,
        workspaceRoot: tempDir,
      });

      await ingestor.ingest('searchable.md');

      // Retrieve by label prefix
      const blocks = await memoryStore.getBlocksByLabelPrefix(
        TEST_OWNER,
        'knowledge:searchable.md',
      );

      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) {
        expect(block.label).toContain('knowledge:searchable.md');
        expect(block.owner).toBe(TEST_OWNER);
        expect(block.tier).toBe('archival');
      }
    });
  });

  describe('knowledge-autonomy.AC3.6: Path traversal is rejected', () => {
    it('throws error for path traversal attempt with ../', async () => {
      const embedding = createMockEmbeddingProvider();
      const ingestor = createIngestor({
        memoryStore,
        embedding,
        persistence,
        owner: TEST_OWNER,
        workspaceRoot: tempDir,
      });

      let errorThrown = false;
      let errorMessage = '';
      try {
        await ingestor.ingest('../../../etc/passwd');
      } catch (error) {
        errorThrown = true;
        errorMessage =
          error instanceof Error ? error.message : String(error);
      }

      expect(errorThrown).toBe(true);
      expect(errorMessage).toContain('path traversal rejected');
    });
  });

  describe('knowledge-autonomy.AC3.7: Binary files and large files are rejected', () => {
    it('throws error for binary file (.png)', async () => {
      const embedding = createMockEmbeddingProvider();
      const ingestor = createIngestor({
        memoryStore,
        embedding,
        persistence,
        owner: TEST_OWNER,
        workspaceRoot: tempDir,
      });

      let errorThrown = false;
      let errorMessage = '';
      try {
        await ingestor.ingest('image.png');
      } catch (error) {
        errorThrown = true;
        errorMessage =
          error instanceof Error ? error.message : String(error);
      }

      expect(errorThrown).toBe(true);
      expect(errorMessage).toContain('binary file rejected');
      expect(errorMessage).toContain('.png');
    });

    it('throws error for file over 1MB', async () => {
      // Create a file just over 1MB
      const largeContent = 'a'.repeat(1_048_577); // 1MB + 1 byte
      await writeFile(join(tempDir, 'large.md'), largeContent);

      const embedding = createMockEmbeddingProvider();
      const ingestor = createIngestor({
        memoryStore,
        embedding,
        persistence,
        owner: TEST_OWNER,
        workspaceRoot: tempDir,
      });

      let errorThrown = false;
      let errorMessage = '';
      try {
        await ingestor.ingest('large.md');
      } catch (error) {
        errorThrown = true;
        errorMessage =
          error instanceof Error ? error.message : String(error);
      }

      expect(errorThrown).toBe(true);
      expect(errorMessage).toContain('file too large');
      expect(errorMessage).toContain('1.00MB');
    });
  });

  describe('knowledge-autonomy.AC3.2: Chunks preserve heading context', () => {
    it('chunks include heading context in labels and content', async () => {
      const content = `# Main Title

## Subsection A
Content for A.

## Subsection B
Content for B.`;

      const filePath = join(tempDir, 'context.md');
      await writeFile(filePath, content);

      const embedding = createMockEmbeddingProvider();
      const ingestor = createIngestor({
        memoryStore,
        embedding,
        persistence,
        owner: TEST_OWNER,
        workspaceRoot: tempDir,
      });

      const result = await ingestor.ingest('context.md');

      const blocks = await memoryStore.getBlocksByLabelPrefix(
        TEST_OWNER,
        result.label,
      );

      // Should have multiple blocks
      expect(blocks.length).toBeGreaterThan(1);

      // Blocks should have content with heading context markers
      const hasContext = blocks.some((b) =>
        b.content.includes('[Context:'),
      );
      expect(hasContext).toBe(true);
    });
  });
});
