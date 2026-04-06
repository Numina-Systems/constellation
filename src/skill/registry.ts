// pattern: Imperative Shell

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import type { EmbeddingProvider } from '../embedding/types.ts';
import type { SkillStore } from './store.ts';
import type { SkillDefinition, SkillRegistry, SkillSearchResult } from './types.ts';
import { loadSkills, buildEmbeddingText, computeContentHash } from './loader.ts';
import { parseSkillFile } from './parser.ts';

type CreateSkillRegistryOptions = {
  readonly store: SkillStore;
  readonly embedding: EmbeddingProvider;
  readonly builtinDir: string;
  readonly agentDir: string;
};

const SKILL_NAME_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

function validateSkillName(name: string): { valid: true } | { valid: false; error: string } {
  if (!SKILL_NAME_REGEX.test(name)) {
    return {
      valid: false,
      error: 'name must be kebab-case (lowercase letters, numbers, hyphens)',
    };
  }
  return { valid: true };
}

function buildSkillMarkdown(
  name: string,
  description: string,
  body: string,
  tags?: ReadonlyArray<string>,
): string {
  const frontmatter: Record<string, unknown> = { name, description };
  if (tags && tags.length > 0) {
    frontmatter['tags'] = [...tags];
  }
  return `---\n${stringifyYaml(frontmatter)}---\n\n${body}`;
}

export function createSkillRegistry(options: CreateSkillRegistryOptions): SkillRegistry {
  const { store, embedding, builtinDir, agentDir } = options;
  const skillsByName = new Map<string, SkillDefinition>();
  const idToName = new Map<string, string>();

  return {
    async load() {
      skillsByName.clear();
      idToName.clear();

      const result = await loadSkills({
        builtinDir,
        agentDir,
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

    getByName(name: string): SkillDefinition | null {
      return skillsByName.get(name) ?? null;
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

      return results
        .map((result) => {
          const name = idToName.get(result.id);
          return skillsByName.get(name || '');
        })
        .filter((s): s is SkillDefinition => s !== undefined);
    },

    async createAgentSkill(
      name: string,
      description: string,
      body: string,
      tags?: ReadonlyArray<string>,
    ): Promise<SkillDefinition> {
      const nameValidation = validateSkillName(name);
      if (!nameValidation.valid) {
        throw new Error(`invalid skill name: ${nameValidation.error}`);
      }

      const skillDir = join(agentDir, name);
      mkdirSync(skillDir, { recursive: true });

      const skillFilePath = join(skillDir, 'SKILL.md');
      const content = buildSkillMarkdown(name, description, body, tags);
      writeFileSync(skillFilePath, content, 'utf-8');

      const parseResult = parseSkillFile(content);
      if (!parseResult.success) {
        throw new Error(`failed to parse created skill: ${parseResult.error}`);
      }

      const contentHash = computeContentHash(content);
      const id = `skill:agent:${name}`;
      const { metadata } = parseResult;

      const embeddingText = buildEmbeddingText(metadata, body);
      const embeddingVector = await embedding.embed(embeddingText);

      await store.upsertEmbedding(id, name, description, contentHash, embeddingVector);

      const skill: SkillDefinition = {
        id,
        metadata,
        body,
        companions: [],
        source: 'agent',
        filePath: skillFilePath,
        contentHash,
      };

      skillsByName.set(name, skill);
      idToName.set(id, name);

      return skill;
    },

    async updateAgentSkill(
      name: string,
      description: string,
      body: string,
      tags?: ReadonlyArray<string>,
    ): Promise<SkillDefinition> {
      const existing = skillsByName.get(name);
      if (!existing) {
        throw new Error(`skill "${name}" not found`);
      }
      if (existing.source !== 'agent') {
        throw new Error(`cannot update ${existing.source} skill "${name}" — only agent skills can be updated`);
      }

      const skillDir = join(agentDir, name);
      const skillFilePath = join(skillDir, 'SKILL.md');
      const content = buildSkillMarkdown(name, description, body, tags);
      writeFileSync(skillFilePath, content, 'utf-8');

      const parseResult = parseSkillFile(content);
      if (!parseResult.success) {
        throw new Error(`failed to parse updated skill: ${parseResult.error}`);
      }

      const contentHash = computeContentHash(content);
      const id = `skill:agent:${name}`;
      const { metadata } = parseResult;

      const embeddingText = buildEmbeddingText(metadata, body);
      const embeddingVector = await embedding.embed(embeddingText);

      await store.upsertEmbedding(id, name, description, contentHash, embeddingVector);

      const skill: SkillDefinition = {
        id,
        metadata,
        body,
        companions: [],
        source: 'agent',
        filePath: skillFilePath,
        contentHash,
      };

      skillsByName.set(name, skill);
      idToName.set(id, name);

      return skill;
    },
  };
}
