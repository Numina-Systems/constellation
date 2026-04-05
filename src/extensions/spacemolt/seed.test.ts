import { describe, it, expect } from "bun:test";
import { seedSpaceMoltCapabilities } from "./seed.ts";
import type { MemoryStore } from "../../memory/store.ts";
import type { EmbeddingProvider } from "../../embedding/types.ts";
import type { MemoryBlock } from "../../memory/types.ts";

// Mock implementations
function createMockMemoryStore(): MemoryStore {
  const blocks: Array<MemoryBlock> = [];

  return {
    getBlock: async () => null,
    getBlocksByTier: async () => [],
    getBlockByLabel: async () => null,
    createBlock: async (block) => {
      const fullBlock: MemoryBlock = {
        ...block,
        created_at: new Date(),
        updated_at: new Date(),
      };
      blocks.push(fullBlock);
      return fullBlock;
    },
    updateBlock: async () => ({ id: "", owner: "", tier: "core" as const, label: "", content: "", embedding: null, permission: "readonly" as const, pinned: false, created_at: new Date(), updated_at: new Date() }),
    deleteBlock: async () => {},
    searchByEmbedding: async () => [],
    logEvent: async () => ({ id: "", block_id: "", event_type: "create" as const, old_content: null, new_content: null, created_at: new Date() }),
    getEvents: async () => [],
    createMutation: async () => ({ id: "", block_id: "", proposed_content: "", reason: null, status: "pending" as const, feedback: null, created_at: new Date(), resolved_at: null }),
    getPendingMutations: async () => [],
    resolveMutation: async () => ({ id: "", block_id: "", proposed_content: "", reason: null, status: "approved" as const, feedback: null, created_at: new Date(), resolved_at: new Date() }),
  };
}

function createMockEmbeddingProvider(): EmbeddingProvider {
  return {
    embed: async (text: string) => {
      // Return a simple deterministic embedding based on text length
      return new Array(1536).fill(0).map((_, i) => (text.length * (i + 1)) / 1000);
    },
    embedBatch: async (texts: ReadonlyArray<string>) => {
      return texts.map((text) =>
        new Array(1536).fill(0).map((_, i) => (text.length * (i + 1)) / 1000)
      );
    },
    dimensions: 1536,
  };
}

describe("seedSpaceMoltCapabilities", () => {
  it("AC6.1: Seeds spacemolt:capabilities block on first run", async () => {
    const store = createMockMemoryStore();
    const embedding = createMockEmbeddingProvider();

    const createdBlocks: Array<Record<string, unknown>> = [];
    store.createBlock = async (block) => {
      createdBlocks.push(block);
      return {
        ...block,
        created_at: new Date(),
        updated_at: new Date(),
      };
    };

    await seedSpaceMoltCapabilities(store, embedding);

    expect(createdBlocks.length).toBe(1);

    const block = createdBlocks[0];
    expect(block["label"]).toBe("spacemolt:capabilities");
    expect(block["tier"]).toBe("working");
    expect(block["pinned"]).toBe(true);
    expect(block["permission"]).toBe("readonly");
    expect(block["owner"]).toBe("spirit");
  });

  it("AC6.2: Idempotent — does not duplicate block on re-run", async () => {
    const store = createMockMemoryStore();
    const embedding = createMockEmbeddingProvider();

    // Create a mock block to simulate existing capability
    const existingBlock: MemoryBlock = {
      id: "existing-id",
      owner: "spirit",
      tier: "working",
      label: "spacemolt:capabilities",
      content: "existing content",
      embedding: null,
      permission: "readonly",
      pinned: true,
      created_at: new Date(),
      updated_at: new Date(),
    };

    // Mock getBlockByLabel to return existing block
    store.getBlockByLabel = async (_owner: string, label: string) => {
      if (label === "spacemolt:capabilities") {
        return existingBlock;
      }
      return null;
    };

    let createBlockCalls = 0;
    store.createBlock = async (block) => {
      createBlockCalls++;
      return {
        ...block,
        created_at: new Date(),
        updated_at: new Date(),
      };
    };

    await seedSpaceMoltCapabilities(store, embedding);

    // Verify createBlock was NOT called (idempotency)
    expect(createBlockCalls).toBe(0);
  });

  it("AC6.3: Capabilities block contains prediction journaling and memory guidance", async () => {
    const store = createMockMemoryStore();
    const embedding = createMockEmbeddingProvider();

    const createdBlocks: Array<Record<string, unknown>> = [];
    store.createBlock = async (block) => {
      createdBlocks.push(block);
      return {
        ...block,
        created_at: new Date(),
        updated_at: new Date(),
      };
    };

    await seedSpaceMoltCapabilities(store, embedding);

    expect(createdBlocks.length).toBe(1);
    const content = createdBlocks[0]["content"] as string;

    // Verify key strategy words are present
    expect(content.toLowerCase()).toContain("predict");
    expect(content.toLowerCase()).toContain("annotate_prediction");
    expect(content.toLowerCase()).toContain("memory");
    expect(content.toLowerCase()).toContain("memory_write");
  });
});
