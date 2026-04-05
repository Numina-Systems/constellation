import { describe, it, expect } from "bun:test";
import { readCredentials, writeCredentials } from "./credentials.ts";
import type { MemoryStore } from "../../memory/store.ts";
import type { EmbeddingProvider } from "../../embedding/types.ts";
import type { MemoryBlock } from "../../memory/types.ts";

// Mock implementations (same pattern as seed.test.ts)
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
    updateBlock: async () => ({
      id: "",
      owner: "",
      tier: "core" as const,
      label: "",
      content: "",
      embedding: null,
      permission: "readonly" as const,
      pinned: false,
      created_at: new Date(),
      updated_at: new Date(),
    }),
    deleteBlock: async () => {},
    searchByEmbedding: async () => [],
    logEvent: async () => ({
      id: "",
      block_id: "",
      event_type: "create" as const,
      old_content: null,
      new_content: null,
      created_at: new Date(),
    }),
    getEvents: async () => [],
    createMutation: async () => ({
      id: "",
      block_id: "",
      proposed_content: "",
      reason: null,
      status: "pending" as const,
      feedback: null,
      created_at: new Date(),
      resolved_at: null,
    }),
    getPendingMutations: async () => [],
    resolveMutation: async () => ({
      id: "",
      block_id: "",
      proposed_content: "",
      reason: null,
      status: "approved" as const,
      feedback: null,
      created_at: new Date(),
      resolved_at: new Date(),
    }),
  };
}

function createMockEmbeddingProvider(): EmbeddingProvider {
  return {
    embed: async (text: string) => {
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

describe("readCredentials", () => {
  describe("spacemolt-auto-register.AC2.1: Returns null when no block exists", () => {
    it("returns null when getBlockByLabel returns null", async () => {
      const store = createMockMemoryStore();

      const result = await readCredentials(store);

      expect(result).toBeNull();
    });
  });

  describe("spacemolt-auto-register.AC2.3: Returns parsed credentials from existing block", () => {
    it("returns parsed Credentials object when block exists with valid JSON content", async () => {
      const store = createMockMemoryStore();

      const credentials = {
        username: "testuser",
        password: "testpass",
        player_id: "player123",
        empire: "empire456",
      };

      const existingBlock: MemoryBlock = {
        id: "block-id",
        owner: "spirit",
        tier: "core",
        label: "spacemolt:credentials",
        content: JSON.stringify(credentials),
        embedding: null,
        permission: "readwrite",
        pinned: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      store.getBlockByLabel = async () => existingBlock;

      const result = await readCredentials(store);

      expect(result).toEqual(credentials);
    });
  });

  describe("spacemolt-auto-register.AC2.4: Returns null on corrupted JSON", () => {
    it("returns null when block content is invalid JSON", async () => {
      const store = createMockMemoryStore();

      const invalidBlock: MemoryBlock = {
        id: "block-id",
        owner: "spirit",
        tier: "core",
        label: "spacemolt:credentials",
        content: "not-json{{",
        embedding: null,
        permission: "readwrite",
        pinned: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      store.getBlockByLabel = async () => invalidBlock;

      const result = await readCredentials(store);

      expect(result).toBeNull();
    });
  });

  it("returns null when JSON is valid but missing required fields", async () => {
    const store = createMockMemoryStore();

    const invalidBlock: MemoryBlock = {
      id: "block-id",
      owner: "spirit",
      tier: "core",
      label: "spacemolt:credentials",
      content: JSON.stringify({ username: "testuser" }),
      embedding: null,
      permission: "readwrite",
      pinned: true,
      created_at: new Date(),
      updated_at: new Date(),
    };

    store.getBlockByLabel = async () => invalidBlock;

    const result = await readCredentials(store);

    expect(result).toBeNull();
  });

  it("returns null when JSON fields are wrong types", async () => {
    const store = createMockMemoryStore();

    const invalidBlock: MemoryBlock = {
      id: "block-id",
      owner: "spirit",
      tier: "core",
      label: "spacemolt:credentials",
      content: JSON.stringify({
        username: 123,
        password: "testpass",
        player_id: "player123",
        empire: "empire456",
      }),
      embedding: null,
      permission: "readwrite",
      pinned: true,
      created_at: new Date(),
      updated_at: new Date(),
    };

    store.getBlockByLabel = async () => invalidBlock;

    const result = await readCredentials(store);

    expect(result).toBeNull();
  });
});

describe("writeCredentials", () => {
  describe("spacemolt-auto-register.AC2.2: Creates pinned core block", () => {
    it("creates block with correct properties when no existing block", async () => {
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

      const credentials = {
        username: "testuser",
        password: "testpass",
        player_id: "player123",
        empire: "empire456",
      };

      await writeCredentials(store, embedding, credentials);

      expect(createdBlocks.length).toBe(1);
      const block = createdBlocks[0];
      if (!block) {
        throw new Error("Expected block to be created");
      }

      expect(block["tier"]).toBe("core");
      expect(block["pinned"]).toBe(true);
      expect(block["permission"]).toBe("readwrite");
      expect(block["owner"]).toBe("spirit");
      expect(block["label"]).toBe("spacemolt:credentials");

      const content = block["content"] as string;
      const parsed = JSON.parse(content);
      expect(parsed.username).toBe("testuser");
      expect(parsed.password).toBe("testpass");
      expect(parsed.player_id).toBe("player123");
      expect(parsed.empire).toBe("empire456");
    });
  });

  it("updates existing block instead of creating duplicate", async () => {
    const store = createMockMemoryStore();
    const embedding = createMockEmbeddingProvider();

    const existingBlock: MemoryBlock = {
      id: "existing-id",
      owner: "spirit",
      tier: "core",
      label: "spacemolt:credentials",
      content: JSON.stringify({
        username: "olduser",
        password: "oldpass",
        player_id: "oldplayer",
        empire: "oldempiré",
      }),
      embedding: null,
      permission: "readwrite",
      pinned: true,
      created_at: new Date(),
      updated_at: new Date(),
    };

    let getBlockByLabelCalls = 0;
    store.getBlockByLabel = async () => {
      getBlockByLabelCalls++;
      return existingBlock;
    };

    const updatedBlocks: Array<Record<string, unknown>> = [];
    store.updateBlock = async (id: string, content: string, embedding) => {
      updatedBlocks.push({ id, content, embedding });
      return {
        id,
        owner: "spirit",
        tier: "core" as const,
        label: "spacemolt:credentials",
        content,
        embedding,
        permission: "readwrite" as const,
        pinned: true,
        created_at: new Date(),
        updated_at: new Date(),
      };
    };

    let createBlockCalls = 0;
    store.createBlock = async () => {
      createBlockCalls++;
      throw new Error("Should not create new block");
    };

    const newCredentials = {
      username: "newuser",
      password: "newpass",
      player_id: "newplayer",
      empire: "newempire",
    };

    await writeCredentials(store, embedding, newCredentials);

    expect(getBlockByLabelCalls).toBe(1);
    expect(createBlockCalls).toBe(0);
    expect(updatedBlocks.length).toBe(1);

    const updated = updatedBlocks[0];
    if (!updated) {
      throw new Error("Expected block to be updated");
    }

    expect(updated["id"]).toBe("existing-id");
    const content = updated["content"] as string;
    const parsed = JSON.parse(content);
    expect(parsed.username).toBe("newuser");
    expect(parsed.password).toBe("newpass");
    expect(parsed.player_id).toBe("newplayer");
    expect(parsed.empire).toBe("newempire");
  });
});
