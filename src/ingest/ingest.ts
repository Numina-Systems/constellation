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
      const texts = chunks.map((c) =>
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
      await persistence.withTransaction(async () => {
        // Delete existing chunks with this label prefix
        const existingBlocks = await memoryStore.getBlocksByLabelPrefix(
          owner,
          labelPrefix,
        );
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
