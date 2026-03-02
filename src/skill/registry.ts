// pattern: Imperative Shell

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';
import type { EmbeddingProvider } from '../embedding/types.ts';
import type { SkillStore } from './store.ts';
import type { SkillDefinition, SkillRegistry, SkillSearchResult } from './types.ts';
import { loadSkills } from './loader.ts';
import { parseSkillFile } from './parser.ts';

type CreateSkillRegistryOptions = {
  readonly store: SkillStore;
  readonly embedding: EmbeddingProvider;
  readonly builtinDir: string;
  readonly userDir: string;
};

function computeContentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function buildSkillMarkdown(
  name: string,
  description: string,
  body: string,
  tags?: ReadonlyArray<string>,
): string {
  const yamlParts: string[] = [
    `name: ${name}`,
    `description: ${description}`,
  ];
  if (tags && tags.length > 0) {
    yamlParts.push(`tags: [${tags.map((t) => `"${t}"`).join(', ')}]`);
  }
  return `---\n${yamlParts.join('\n')}\n---\n\n${body}`;
}

export function createSkillRegistry(options: CreateSkillRegistryOptions): SkillRegistry {
  const { store, embedding, builtinDir, userDir } = options;
  const skillsByName = new Map<string, SkillDefinition>();
  const idToName = new Map<string, string>();

  return {
    async load() {
      skillsByName.clear();
      idToName.clear();

      const result = await loadSkills({
        builtinDir,
        userDir,
        store,
        embedding,
      });

      if (result.errors.length > 0) {
        for (const err of result.errors) {
          console.warn(`[skill loader] ${err.path}: ${err.error}`);
        }
      }

      for (const skill of result.loaded) {
        skillsByName.set(skill.metadata.name, skill);
        idToName.set(skill.id, skill.metadata.name);
      }
    },

    getAll(): Array<SkillDefinition> {
      return Array.from(skillsByName.values());
    },

    getByName(name: string): SkillDefinition | undefined {
      return skillsByName.get(name);
    },

    async search(query: string, limit = 10): Promise<Array<SkillSearchResult>> {
      const embeddingVector = await embedding.embed(query);
      const results = await store.searchByEmbedding(embeddingVector, limit, 0);

      return results
        .map((result) => {
          const name = idToName.get(result.id);
          const skill = skillsByName.get(name || '');
          if (!skill) {
            return null;
          }
          return {
            id: result.id,
            name: skill.metadata.name,
            description: skill.metadata.description,
            score: result.score,
          };
        })
        .filter((r): r is SkillSearchResult => r !== null);
    },

    async getRelevant(
      context: string,
      limit = 3,
      threshold = 0.3,
    ): Promise<Array<SkillDefinition>> {
      const embeddingVector = await embedding.embed(context);
      const results = await store.searchByEmbedding(embeddingVector, limit, threshold);

      const resultsByName = new Map(results.map((r) => [idToName.get(r.id), r]));

      return results
        .map((result) => {
          const name = idToName.get(result.id);
          return skillsByName.get(name || '');
        })
        .filter((s): s is SkillDefinition => s !== undefined && (resultsByName.get(s.metadata.name)?.score ?? 0) >= threshold);
    },

    async createUserSkill(
      name: string,
      description: string,
      body: string,
      tags?: ReadonlyArray<string>,
    ): Promise<SkillDefinition> {
      const skillDir = join(userDir, name);
      if (!existsSync(skillDir)) {
        mkdirSync(skillDir, { recursive: true });
      }

      const skillFilePath = join(skillDir, 'SKILL.md');
      const content = buildSkillMarkdown(name, description, body, tags);
      writeFileSync(skillFilePath, content, 'utf-8');

      const parseResult = parseSkillFile(content);
      if (!parseResult.success) {
        throw new Error(`Failed to parse created skill: ${parseResult.error}`);
      }

      const contentHash = computeContentHash(content);
      const id = `skill:user:${name}`;
      const { metadata } = parseResult;

      const embeddingText = [description, ...(tags || []), body.slice(0, 500)].join('\n');
      const embeddingVector = await embedding.embed(embeddingText);

      await store.upsertEmbedding(id, name, description, contentHash, embeddingVector);

      const skill: SkillDefinition = {
        id,
        metadata,
        body,
        companions: [],
        source: 'user',
        filePath: skillFilePath,
        contentHash,
      };

      skillsByName.set(name, skill);
      idToName.set(id, name);

      return skill;
    },

    async updateUserSkill(
      name: string,
      description: string,
      body: string,
      tags?: ReadonlyArray<string>,
    ): Promise<SkillDefinition> {
      const existing = skillsByName.get(name);
      if (!existing) {
        throw new Error(`Skill "${name}" not found`);
      }
      if (existing.source !== 'user') {
        throw new Error(`Cannot update builtin skill "${name}" — user skills only`);
      }

      const skillDir = join(userDir, name);
      const skillFilePath = join(skillDir, 'SKILL.md');
      const content = buildSkillMarkdown(name, description, body, tags);
      writeFileSync(skillFilePath, content, 'utf-8');

      const parseResult = parseSkillFile(content);
      if (!parseResult.success) {
        throw new Error(`Failed to parse updated skill: ${parseResult.error}`);
      }

      const contentHash = computeContentHash(content);
      const id = `skill:user:${name}`;
      const { metadata } = parseResult;

      const embeddingText = [description, ...(tags || []), body.slice(0, 500)].join('\n');
      const embeddingVector = await embedding.embed(embeddingText);

      await store.upsertEmbedding(id, name, description, contentHash, embeddingVector);

      const skill: SkillDefinition = {
        id,
        metadata,
        body,
        companions: [],
        source: 'user',
        filePath: skillFilePath,
        contentHash,
      };

      skillsByName.set(name, skill);
      idToName.set(id, name);

      return skill;
    },
  };
}
