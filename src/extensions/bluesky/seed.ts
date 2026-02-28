// pattern: Imperative Shell

/**
 * Seeds Bluesky API reference templates into archival memory on first run.
 * Idempotent — checks for existing bluesky:* blocks before writing.
 */

import type { MemoryStore } from "../../memory/store.ts";
import type { EmbeddingProvider } from "../../embedding/types.ts";
import {
  BLUESKY_POST_TEMPLATE,
  BLUESKY_REPLY_TEMPLATE,
  BLUESKY_LIKE_TEMPLATE,
} from "./templates.ts";

/**
 * Seed three Bluesky template blocks into archival memory.
 * Checks for existing templates first (idempotent).
 *
 * AC5.1: Templates seeded on first run
 * AC5.3: Templates not seeded when bluesky.enabled is false (enforced by caller)
 * AC5.4: Re-running is idempotent (checked via getBlockByLabel)
 */
export async function seedBlueskyTemplates(
  store: MemoryStore,
  embedding: EmbeddingProvider,
): Promise<void> {
  // Idempotency check: if any bluesky:* block exists, skip seeding
  const existingBlock = await store.getBlockByLabel("spirit", "bluesky:post");
  if (existingBlock) {
    return;
  }

  // Generate embedding with null fallback (same pattern as seedCoreMemory)
  const generateEmbedding = async (text: string): Promise<Array<number> | null> => {
    try {
      const result = await embedding.embed(text);
      if (!Array.isArray(result)) {
        return null;
      }
      return result;
    } catch {
      return null;
    }
  };

  // Seed bluesky:post template
  const postEmbedding = await generateEmbedding(BLUESKY_POST_TEMPLATE);
  await store.createBlock({
    id: crypto.randomUUID(),
    owner: "spirit",
    tier: "archival",
    label: "bluesky:post",
    content: BLUESKY_POST_TEMPLATE,
    embedding: postEmbedding,
    permission: "readwrite",
    pinned: false,
  });

  // Seed bluesky:reply template
  const replyEmbedding = await generateEmbedding(BLUESKY_REPLY_TEMPLATE);
  await store.createBlock({
    id: crypto.randomUUID(),
    owner: "spirit",
    tier: "archival",
    label: "bluesky:reply",
    content: BLUESKY_REPLY_TEMPLATE,
    embedding: replyEmbedding,
    permission: "readwrite",
    pinned: false,
  });

  // Seed bluesky:like template
  const likeEmbedding = await generateEmbedding(BLUESKY_LIKE_TEMPLATE);
  await store.createBlock({
    id: crypto.randomUUID(),
    owner: "spirit",
    tier: "archival",
    label: "bluesky:like",
    content: BLUESKY_LIKE_TEMPLATE,
    embedding: likeEmbedding,
    permission: "readwrite",
    pinned: false,
  });

  console.log("Bluesky templates seeded into archival memory");
}
