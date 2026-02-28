import { describe, it, expect } from "bun:test";
import { seedBlueskyTemplates } from "./seed.ts";
import type { MemoryStore } from "../../memory/store.ts";
import type { EmbeddingProvider } from "../../embedding/types.ts";
import type { MemoryBlock } from "../../memory/types.ts";

// Mock implementations
function createMockMemoryStore(): MemoryStore {
  const blocks: MemoryBlock[] = [];
  let existingBlock: MemoryBlock | null = null;

  return {
    getBlock: async () => null,
    getBlocksByTier: async () => [],
    getBlockByLabel: async (_owner: string, label: string) => {
      if (label === "bluesky:post" && existingBlock) {
        return existingBlock;
      }
      return null;
    },
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

describe("seedBlueskyTemplates", () => {
  it("AC5.1: Seeds three templates on first run", async () => {
    const store = createMockMemoryStore();
    const embedding = createMockEmbeddingProvider();

    await seedBlueskyTemplates(store, embedding);

    // Verify createBlock was called 3 times
    // We'll track calls by checking the blocks created
    const calls: unknown[] = [];
    const originalCreateBlock = store.createBlock;
    store.createBlock = async (block) => {
      calls.push(block);
      return originalCreateBlock.call(store, block);
    };

    // Reset and run again
    const store2 = createMockMemoryStore();
    store2.createBlock = async (block) => {
      calls.push(block);
      return {
        ...block,
        created_at: new Date(),
        updated_at: new Date(),
      };
    };

    await seedBlueskyTemplates(store2, embedding);

    expect(calls.length).toBe(3);

    // Verify the labels and tier
    const blockCalls = calls as Array<Record<string, unknown>>;
    const labels = blockCalls.map((b) => b["label"]);
    expect(labels).toContain("bluesky:post");
    expect(labels).toContain("bluesky:reply");
    expect(labels).toContain("bluesky:like");

    // Verify all are archival tier
    blockCalls.forEach((b) => {
      expect(b["tier"]).toBe("archival");
    });
  });

  it("AC5.4: Idempotent — does not duplicate templates on re-run", async () => {
    const store = createMockMemoryStore();
    const embedding = createMockEmbeddingProvider();

    // Create a mock block to simulate existing template
    const existingBlock: MemoryBlock = {
      id: "existing-id",
      owner: "spirit",
      tier: "archival",
      label: "bluesky:post",
      content: "existing content",
      embedding: null,
      permission: "readwrite",
      pinned: false,
      created_at: new Date(),
      updated_at: new Date(),
    };

    // Mock the store to return existing block
    let getBlockByLabelCalls = 0;
    store.getBlockByLabel = async (_owner: string, label: string) => {
      getBlockByLabelCalls++;
      if (label === "bluesky:post") {
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

    await seedBlueskyTemplates(store, embedding);

    // Verify getBlockByLabel was called to check for existing blocks
    expect(getBlockByLabelCalls).toBeGreaterThan(0);

    // Verify createBlock was NOT called (idempotency)
    expect(createBlockCalls).toBe(0);
  });

  it("AC5.2: Templates contain expected content", async () => {
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

    await seedBlueskyTemplates(store, embedding);

    // Find each template block
    const postBlock = createdBlocks.find((b) => b["label"] === "bluesky:post");
    const replyBlock = createdBlocks.find((b) => b["label"] === "bluesky:reply");
    const likeBlock = createdBlocks.find((b) => b["label"] === "bluesky:like");

    expect(postBlock).toBeDefined();
    expect(replyBlock).toBeDefined();
    expect(likeBlock).toBeDefined();

    // Verify templates contain expected keywords
    const postContent = String(postBlock?.["content"] ?? "");
    expect(postContent).toContain("AtpAgent");
    expect(postContent).toContain("BSKY_SERVICE");
    expect(postContent).toContain("agent.post");

    const replyContent = String(replyBlock?.["content"] ?? "");
    expect(replyContent).toContain("reply:");
    expect(replyContent).toContain("ROOT_URI");
    expect(replyContent).toContain("PARENT_URI");

    const likeContent = String(likeBlock?.["content"] ?? "");
    expect(likeContent).toContain("agent.like");
    expect(likeContent).toContain("POST_URI");
    expect(likeContent).toContain("POST_CID");
  });

  it("Seeds with readwrite permission and archival tier", async () => {
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

    await seedBlueskyTemplates(store, embedding);

    createdBlocks.forEach((block) => {
      expect(block["tier"]).toBe("archival");
      expect(block["permission"]).toBe("readwrite");
      expect(block["pinned"]).toBe(false);
      expect(block["owner"]).toBe("spirit");
    });
  });
});
