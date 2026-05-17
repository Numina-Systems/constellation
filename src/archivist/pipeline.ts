// pattern: Imperative Shell

/**
 * Archivist pipeline orchestrator.
 * Coordinates six stages: scan → dedup → consolidate → crossref → prune → reflect
 * Supports incremental (no LLM) and full (all stages) modes.
 */

import type { MemoryStore } from '@/memory/store.js';
import type { MemoryManager } from '@/memory/manager.js';
import type { EmbeddingProvider } from '@/embedding/types.js';
import type { ModelProvider } from '@/model/types.js';
import type { PersistenceProvider } from '@/persistence/types.js';
import type { PipelineResult } from './types.js';
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
  const {
    memoryStore,
    memoryManager,
    embedding,
    summarizationModel,
    persistence,
    owner,
    dedupThreshold,
    crossrefThreshold,
    tokenBudget,
  } = deps;

  async function runIncremental(): Promise<PipelineResult> {
    // Incremental mode: scan → dedup → prune (no LLM calls)
    let scanned = 0;
    let deduped = 0;
    let pruned = 0;
    let tokensUsed = 0;

    try {
      // Stage 1: Scan
      const scanResult = await scan({ memoryStore, owner });
      scanned = scanResult.blocks.length;

      // Check if any blocks changed since last state snapshot
      const stateBlock = await memoryStore.getBlockByLabel(owner, 'archivist:state');
      const lastState = stateBlock ? JSON.parse(stateBlock.content) : {};
      const currentHashes = new Map(
        scanResult.blocks.map((b) => [b.id, b.contentHash]),
      );

      const changed = scanResult.blocks.filter((b) => lastState[b.id] !== b.contentHash);
      if (changed.length === 0 && Object.keys(lastState).length > 0) {
        // No blocks changed, short-circuit
        return {
          mode: 'incremental',
          scanned,
          deduped,
          consolidated: 0,
          crossreffed: 0,
          pruned,
          reflected: false,
          totalTokensUsed: tokensUsed,
        };
      }

      // Stage 2: Dedup (skip if no embeddings)
      const dedupResult = dedup(scanResult.blocks, dedupThreshold);
      deduped = dedupResult.groups.length;

      // Stage 3: Prune
      const pruneResult = prune(scanResult.blocks);
      pruned = pruneResult.prunedIds.length;

      // Delete pruned blocks
      for (const id of pruneResult.prunedIds) {
        try {
          await memoryStore.deleteBlock(id);
        } catch (error) {
          console.error(`Failed to delete pruned block ${id}:`, error);
        }
      }

      // Update state snapshot
      const stateMap = Object.fromEntries(currentHashes);
      await memoryManager.write(
        'archivist:state',
        JSON.stringify(stateMap),
        'working',
      );

      return {
        mode: 'incremental',
        scanned,
        deduped,
        consolidated: 0,
        crossreffed: 0,
        pruned,
        reflected: false,
        totalTokensUsed: tokensUsed,
      };
    } catch (error) {
      console.error('Incremental pipeline failed:', error);
      throw error;
    }
  }

  async function runFull(): Promise<PipelineResult> {
    // Full mode: scan → dedup → consolidate → crossref → prune → reflect
    let scanned = 0;
    let deduped = 0;
    let consolidated = 0;
    let crossreffed = 0;
    let pruned = 0;
    let reflected = false;
    let tokensUsed = 0;

    try {
      // Stage 1: Scan
      const scanResult = await scan({ memoryStore, owner });
      scanned = scanResult.blocks.length;

      const currentHashes = new Map(
        scanResult.blocks.map((b) => [b.id, b.contentHash]),
      );

      // Stage 2: Dedup (skip if no embeddings)
      const dedupResult = dedup(scanResult.blocks, dedupThreshold);
      deduped = dedupResult.groups.length;

      // Stage 3: Consolidate (uses summarization model)
      const consolidateResult = await consolidate(dedupResult.groups, {
        model: summarizationModel,
        tokenBudget,
      });

      consolidated = consolidateResult.actions.length;
      tokensUsed += consolidateResult.tokensUsed;

      // Apply consolidation actions within a transaction
      for (const action of consolidateResult.actions) {
        try {
          await persistence.withTransaction(async () => {
            const { group, mergedContent } = action;

            // Generate embedding for merged content
            let mergedEmbedding: ReadonlyArray<number> | null = null;
            if (embedding) {
              try {
                mergedEmbedding = await embedding.embed(mergedContent);
              } catch (error) {
                console.warn('Failed to embed merged content:', error);
              }
            }

            // Create merged block using canonical's label and tier
            const mergedBlock = await memoryStore.createBlock({
              id: crypto.randomUUID(),
              owner,
              tier: group.canonical.tier,
              label: group.canonical.label,
              content: mergedContent,
              embedding: mergedEmbedding,
              permission: 'readwrite',
              pinned: false,
            });

            // Delete all duplicates
            for (const duplicate of group.duplicates) {
              await memoryStore.deleteBlock(duplicate.id);
            }

            // Delete canonical
            await memoryStore.deleteBlock(group.canonical.id);

            // Update hashes map
            currentHashes.delete(group.canonical.id);
            for (const dup of group.duplicates) {
              currentHashes.delete(dup.id);
            }
            currentHashes.set(mergedBlock.id, action.mergedContent.slice(0, 16));
          });
        } catch (error) {
          console.error('Failed to consolidate group:', error);
        }
      }

      // Stage 4: Crossref (append related references)
      const crossrefResult = crossref(
        scanResult.blocks,
        crossrefThreshold,
        dedupThreshold,
      );
      crossreffed = crossrefResult.actions.length;

      // Apply crossref actions
      for (const action of crossrefResult.actions) {
        try {
          const block = await memoryStore.getBlock(action.blockId);
          if (block) {
            const relatedText = `[Related: ${action.relatedLabels.join(', ')}]`;
            const updatedContent = `${block.content}\n\n${relatedText}`;

            // Generate embedding for updated content
            let updatedEmbedding: ReadonlyArray<number> | null = null;
            if (embedding) {
              try {
                updatedEmbedding = await embedding.embed(updatedContent);
              } catch (error) {
                console.warn('Failed to embed updated content:', error);
              }
            }

            await memoryStore.updateBlock(
              action.blockId,
              updatedContent,
              updatedEmbedding,
            );
          }
        } catch (error) {
          console.error(`Failed to crossref block ${action.blockId}:`, error);
        }
      }

      // Stage 5: Prune (remove empty/whitespace-only blocks)
      const pruneResult = prune(scanResult.blocks);
      pruned = pruneResult.prunedIds.length;

      // Delete pruned blocks
      for (const id of pruneResult.prunedIds) {
        try {
          await memoryStore.deleteBlock(id);
          currentHashes.delete(id);
        } catch (error) {
          console.error(`Failed to delete pruned block ${id}:`, error);
        }
      }

      // Build intermediate result for reflect stage
      const intermediateResult: PipelineResult = {
        mode: 'full',
        scanned,
        deduped,
        consolidated,
        crossreffed,
        pruned,
        reflected: false,
        totalTokensUsed: tokensUsed,
      };

      // Stage 6: Reflect (write observations to working memory)
      const reflectResult = await reflect(intermediateResult, {
        model: summarizationModel,
        tokenBudget,
        tokensUsedSoFar: tokensUsed,
      });

      reflected = !reflectResult.skipped;
      tokensUsed += reflectResult.tokensUsed;

      if (!reflectResult.skipped) {
        try {
          await memoryManager.write(
            'archivist:reflection',
            reflectResult.reflection,
            'working',
          );
        } catch (error) {
          console.error('Failed to write reflection:', error);
        }
      }

      // Update state snapshot
      const stateMap = Object.fromEntries(currentHashes);
      await memoryManager.write(
        'archivist:state',
        JSON.stringify(stateMap),
        'working',
      );

      return {
        mode: 'full',
        scanned,
        deduped,
        consolidated,
        crossreffed,
        pruned,
        reflected,
        totalTokensUsed: tokensUsed,
      };
    } catch (error) {
      console.error('Full pipeline failed:', error);
      throw error;
    }
  }

  return {
    runIncremental,
    runFull,
  };
}
