# SpaceMolt Integration — Phase 6: Memory Seeding & Strategy Wiring

**Goal:** Seed capabilities into agent memory and wire strategy through existing systems.

**Architecture:** Follows Bluesky `seedBlueskyTemplates()` pattern. One pinned working memory block describing SpaceMolt capabilities, gameplay hints, and encouragement to use prediction journaling.

**Tech Stack:** TypeScript, existing MemoryStore and EmbeddingProvider

**Scope:** 8 phases from original design (phase 6 of 8)

**Codebase verified:** 2026-04-04

---

## Acceptance Criteria Coverage

This phase implements and tests:

### spacemolt-integration.AC6: Memory seeding and strategy
- **spacemolt-integration.AC6.1 Success:** Pinned working memory block `spacemolt:capabilities` seeded on first run
- **spacemolt-integration.AC6.2 Success:** Re-running seed is idempotent (no duplicate blocks)
- **spacemolt-integration.AC6.3 Success:** Capabilities block mentions prediction journaling and memory-based tracking

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: SpaceMolt capabilities seeding

**Verifies:** spacemolt-integration.AC6.1, spacemolt-integration.AC6.2, spacemolt-integration.AC6.3

**Files:**
- Create: `src/extensions/spacemolt/seed.ts`
- Test: `src/extensions/spacemolt/seed.test.ts`

**Implementation:**

Create `src/extensions/spacemolt/seed.ts` with `// pattern: Imperative Shell`. Export `seedSpaceMoltCapabilities(store, embedding)`.

Follow the exact pattern from `src/extensions/bluesky/seed.ts`:

```typescript
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
```

**Testing:**

Use a mock MemoryStore that tracks created blocks and returns blocks by label.

- AC6.1: After `seedSpaceMoltCapabilities()`, store has a block with label `spacemolt:capabilities`, tier `working`, pinned `true`, permission `readonly`
- AC6.2: Call `seedSpaceMoltCapabilities()` twice. Store should have exactly one `spacemolt:capabilities` block (second call is no-op). Mock `getBlockByLabel` to return the block on second call. Note: Only one block is seeded so a single `getBlockByLabel` check is sufficient for idempotency (unlike Bluesky which seeds multiple blocks and checks two).
- AC6.3: The capabilities block content includes the words "predict", "annotate_prediction", "memory_write", and "memory" (verifying strategy guidance is present)

**Verification:**
Run: `bun test src/extensions/spacemolt/seed.test.ts`
Expected: All tests pass

**Commit:** `feat: add spacemolt capabilities memory seeding`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Update barrel exports

**Files:**
- Modify: `src/extensions/spacemolt/index.ts`

**Implementation:**

Add to barrel exports:
```typescript
export { seedSpaceMoltCapabilities } from "./seed.ts";
```

**Verification:**
Run: `bun run build`
Expected: No errors

**Commit:** `feat: export spacemolt seed from barrel`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->
