// pattern: Functional Core

import type { MemoryStore } from "../../memory/store.ts";
import type { EmbeddingProvider } from "../../embedding/types.ts";

export type Credentials = {
  readonly username: string;
  readonly password: string;
  readonly player_id: string;
  readonly empire: string;
};

const CREDENTIALS_LABEL = "spacemolt:credentials";
const CREDENTIALS_OWNER = "spirit";

export async function readCredentials(store: MemoryStore): Promise<Credentials | null> {
  const block = await store.getBlockByLabel(CREDENTIALS_OWNER, CREDENTIALS_LABEL);
  if (!block) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(block.content);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "username" in parsed &&
      "password" in parsed &&
      "player_id" in parsed &&
      "empire" in parsed &&
      typeof (parsed as Record<string, unknown>)["username"] === "string" &&
      typeof (parsed as Record<string, unknown>)["password"] === "string" &&
      typeof (parsed as Record<string, unknown>)["player_id"] === "string" &&
      typeof (parsed as Record<string, unknown>)["empire"] === "string"
    ) {
      return {
        username: (parsed as Record<string, unknown>)["username"] as string,
        password: (parsed as Record<string, unknown>)["password"] as string,
        player_id: (parsed as Record<string, unknown>)["player_id"] as string,
        empire: (parsed as Record<string, unknown>)["empire"] as string,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function writeCredentials(
  store: MemoryStore,
  embedding: EmbeddingProvider,
  credentials: Credentials,
): Promise<void> {
  const content = JSON.stringify(credentials);

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

  const existing = await store.getBlockByLabel(CREDENTIALS_OWNER, CREDENTIALS_LABEL);
  if (existing) {
    const emb = await generateEmbedding(content);
    await store.updateBlock(existing.id, content, emb);
    return;
  }

  const emb = await generateEmbedding(content);
  await store.createBlock({
    id: crypto.randomUUID(),
    owner: CREDENTIALS_OWNER,
    tier: "core",
    label: CREDENTIALS_LABEL,
    content,
    embedding: emb,
    permission: "readwrite",
    pinned: true,
  });
}
