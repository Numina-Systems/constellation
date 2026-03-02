// pattern: Imperative Shell

import type { EmbeddingProvider } from '../embedding/types.ts';
import type { SkillStore } from './store.ts';
import type { SkillDefinition } from './types.ts';

export function createMockSkillStore(): SkillStore & { data: Map<string, { contentHash: string; embedding: ReadonlyArray<number> }> } {
  const data = new Map<string, { contentHash: string; embedding: ReadonlyArray<number> }>();
  return {
    data,
    async upsertEmbedding(id, _name, _desc, contentHash, embedding) {
      data.set(id, { contentHash, embedding });
    },
    async deleteEmbedding(id) {
      data.delete(id);
    },
    async getByHash(id) {
      return data.get(id)?.contentHash ?? null;
    },
    async searchByEmbedding(_embedding, limit, threshold) {
      return Array.from(data.entries())
        .slice(0, limit)
        .map(([id]) => ({ id, score: threshold + 0.1 }));
    },
    async getAllIds() {
      return Array.from(data.keys());
    },
  };
}

export function createMockEmbeddingProvider(): EmbeddingProvider & { callCount: number } {
  const provider: EmbeddingProvider & { callCount: number } = {
    callCount: 0,
    dimensions: 768,
    async embed(text: string) {
      provider.callCount += 1;
      const hash = Array.from(text).reduce((acc, char) => {
        return (acc * 31 + char.charCodeAt(0)) >>> 0;
      }, 0);
      const seed = Math.abs(hash) % 1000;
      return Array.from({ length: 768 }, (_, i) => {
        const val = Math.sin(seed + i) * 0.5 + 0.5;
        return Number.isFinite(val) ? val : 0.5;
      });
    },
    async embedBatch(texts) {
      return Promise.all(texts.map((text) => provider.embed(text)));
    },
  };
  return provider;
}

export function createTestSkill(name: string, description: string, body: string): SkillDefinition {
  return {
    id: `skill:test:${name}`,
    metadata: {
      name,
      description,
      version: '1.0.0',
      tags: ['test'],
    },
    body,
    companions: [],
    source: 'builtin',
    filePath: `/test/${name}.md`,
    contentHash: `hash-${name}`,
  };
}

export function createTestSkillWithCompanions(
  name: string,
  description: string,
  body: string,
  companions: Array<{ name: string; content: string }>,
): SkillDefinition {
  return {
    id: `skill:test:${name}`,
    metadata: {
      name,
      description,
      version: '1.0.0',
      tags: ['test'],
    },
    body,
    companions,
    source: 'builtin',
    filePath: `/test/${name}.md`,
    contentHash: `hash-${name}`,
  };
}
