// pattern: Imperative Shell

/**
 * Backfill embeddings for existing messages in the database.
 *
 * Processes messages with role IN ('user', 'assistant') that have null embedding,
 * generating embeddings via the configured embedding provider, and updating the
 * database with the results.
 *
 * Uses batch processing for efficiency and falls back to per-message embedding on
 * batch failures. Handles per-message failures gracefully (skip failed, log warning, continue).
 *
 * Usage: bun run src/scripts/backfill-embeddings.ts
 * Or:    bun run backfill-embeddings (via package.json script)
 */

import { loadConfig } from '../config/config.ts';
import { createPostgresProvider } from '../persistence/postgres.ts';
import { createEmbeddingProvider } from '../embedding/factory.ts';
import { toSql } from 'pgvector/utils';
import type { QueryFunction } from '../persistence/types.ts';

const BATCH_SIZE = 50;

async function main(): Promise<void> {
  const config = loadConfig();
  const persistence = createPostgresProvider(config.database);
  const embedding = createEmbeddingProvider(config.embedding);

  await persistence.connect();

  try {
    // Count messages needing backfill
    const countResult = await persistence.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM messages WHERE role IN ('user', 'assistant') AND embedding IS NULL`,
    );
    const totalCount = countResult.length > 0 ? parseInt(countResult[0]!.count, 10) : 0;

    if (totalCount === 0) {
      console.log('No messages to backfill');
      return;
    }

    console.log(`Starting backfill of ${totalCount} messages...`);

    let processed = 0;
    let embedded = 0;
    let failed = 0;
    let batchNumber = 0;

    while (processed < totalCount) {
      batchNumber++;

      // Fetch batch of messages needing backfill
      const batch = await persistence.query<{ id: string; content: string }>(
        `SELECT id, content FROM messages WHERE role IN ('user', 'assistant') AND embedding IS NULL LIMIT $1`,
        [BATCH_SIZE],
      );

      if (batch.length === 0) break;

      const contents = batch.map((row) => row.content);
      const embeddings: Array<Array<number> | null> = [];

      // Try batch embedding first
      try {
        const batchEmbeds = await embedding.embedBatch(contents);
        embeddings.push(...batchEmbeds);
      } catch (batchError) {
        // Batch failed, fall back to per-message embedding
        console.warn(`Batch ${batchNumber} embedBatch failed, falling back to individual embed calls`);

        for (let i = 0; i < contents.length; i++) {
          try {
            const content = contents[i]!;
            const vec = await embedding.embed(content);
            embeddings.push(vec);
          } catch (itemError) {
            const msg = batch[i]!;
            console.warn(`  Message ${msg.id}: embedding failed, skipping`);
            embeddings.push(null);
            failed++;
          }
        }
      }

      // Update messages in transaction
      let batchEmbedded = 0;
      await persistence.withTransaction(async (query: QueryFunction) => {
        for (let i = 0; i < batch.length; i++) {
          const msg = batch[i];
          const vec = embeddings[i];

          if (msg && vec) {
            const embeddingSql = toSql(vec);
            await query(
              `UPDATE messages SET embedding = $1::vector WHERE id = $2`,
              [embeddingSql, msg.id],
            );
            batchEmbedded++;
          }
        }
      });
      embedded += batchEmbedded;

      processed += batch.length;
      console.log(`Batch ${batchNumber}: processed ${batch.length} messages (${processed}/${totalCount} total)`);
    }

    const summary = `Backfill complete: ${embedded} messages embedded, ${failed} failed, ${totalCount} total`;
    console.log(summary);
  } finally {
    await persistence.disconnect();
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
