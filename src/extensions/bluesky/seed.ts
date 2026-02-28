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
  // Idempotency check: if all bluesky blocks exist, skip seeding
  const existingPost = await store.getBlockByLabel("spirit", "bluesky:post");
  const existingCapabilities = await store.getBlockByLabel("spirit", "bluesky:capabilities");
  if (existingPost && existingCapabilities) {
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

  // Seed archival templates (only if not already present)
  if (!existingPost) {
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
  }

  // Seed a working memory block so the agent knows about bluesky capabilities.
  // Working memory is always in context, so the agent sees this every turn.
  const capabilitiesContent = `You have a Bluesky account (@BSKY_HANDLE). You can post, reply, and like on Bluesky using execute_code.

To post or reply, first use memory_read("bluesky post") or memory_read("bluesky reply") to find the code templates, then adapt them with execute_code. The sandbox has BSKY_SERVICE, BSKY_ACCESS_TOKEN, BSKY_REFRESH_TOKEN, BSKY_DID, and BSKY_HANDLE constants pre-injected — do not hardcode credentials.

Always use: import { AtpAgent } from "npm:@atproto/api";`;

  const capabilitiesEmbedding = await generateEmbedding(capabilitiesContent);
  await store.createBlock({
    id: crypto.randomUUID(),
    owner: "spirit",
    tier: "working",
    label: "bluesky:capabilities",
    content: capabilitiesContent,
    embedding: capabilitiesEmbedding,
    permission: "readonly",
    pinned: true,
  });

  console.log("Bluesky templates seeded into archival memory");
}
