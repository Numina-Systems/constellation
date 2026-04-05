// pattern: Imperative Shell

/**
 * Seeds SpaceMolt capabilities into working memory on first run.
 * Idempotent — checks for existing spacemolt:capabilities block before writing.
 */

import type { MemoryStore } from "../../memory/store.ts";
import type { EmbeddingProvider } from "../../embedding/types.ts";

/**
 * Seed SpaceMolt capabilities block into working memory.
 * Checks for existing block first (idempotent).
 *
 * AC6.1: Capabilities block seeded on first run
 * AC6.2: Re-running is idempotent (no duplicate blocks)
 * AC6.3: Capabilities block mentions prediction journaling and memory-based tracking
 */
export async function seedSpaceMoltCapabilities(
  store: MemoryStore,
  embedding: EmbeddingProvider,
): Promise<void> {
  // Idempotency check
  const existing = await store.getBlockByLabel("spirit", "spacemolt:capabilities");
  if (existing) {
    return;
  }

  const capabilitiesContent = `You are playing SpaceMolt, a multiplayer space game. You have tools prefixed with spacemolt: for game actions.

**What you can do:** Navigate star systems, mine resources, trade at stations, engage in combat, join factions, craft items, complete missions, and interact with other players via chat and trade.

**How to play well:**
- Use spacemolt:get_status and spacemolt:get_ship frequently to understand your current state
- Use spacemolt:analyze_market and spacemolt:find_route before trading — they cost no game time
- Use spacemolt:catalog to look up items, ships, and recipes
- Dock at stations to buy, sell, repair, and refuel
- Track profitable trade routes, good mining spots, and combat outcomes in memory using memory_write
- When you discover something useful (a profitable route, a dangerous system, a good mining location), save it to memory

**Strategy and learning:**
- Use the predict tool to record predictions about outcomes ("Mining iron at Sol will yield 200+ credits after selling at Alpha Centauri")
- Annotate predictions with actual results using annotate_prediction
- The review-predictions system will evaluate your accuracy over time — learn from it
- Build up memory about the game world: which resources are valuable, which systems are safe, where to find good missions

**Combat:** If attacked, prioritise survival. Dock if possible. Check get_battle_status for combat state.

**Game pace:** Actions take ~10 seconds (one per tick). Query tools (get_status, analyze_market, catalog) are free and instant — use them liberally.`;

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

  const capabilitiesEmbedding = await generateEmbedding(capabilitiesContent);
  await store.createBlock({
    id: crypto.randomUUID(),
    owner: "spirit",
    tier: "working",
    label: "spacemolt:capabilities",
    content: capabilitiesContent,
    embedding: capabilitiesEmbedding,
    permission: "readonly",
    pinned: true,
  });

  console.log("SpaceMolt capabilities seeded into working memory");
}
