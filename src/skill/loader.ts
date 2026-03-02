// pattern: Imperative Shell

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';
import type { EmbeddingProvider } from '../embedding/types.ts';
import type { SkillStore } from './store.ts';
import type { SkillDefinition, SkillSource, LoadResult, SkillMetadata } from './types.ts';
import { parseSkillFile } from './parser.ts';

type LoadSkillsOptions = {
  readonly builtinDir: string;
  readonly userDir: string;
  readonly store: SkillStore;
  readonly embedding: EmbeddingProvider;
};

function buildEmbeddingText(metadata: SkillMetadata, body: string): string {
  const parts = [metadata.description];
  if (metadata.tags?.length) {
    parts.push(metadata.tags.join(', '));
  }
  parts.push(body.slice(0, 500));
  return parts.join('\n');
}

function computeContentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function loadCompanions(
  skillDir: string,
  companions?: ReadonlyArray<string>,
): ReadonlyArray<{ name: string; content: string }> {
  if (!companions || companions.length === 0) {
    return [];
  }

  const loaded: Array<{ name: string; content: string }> = [];
  for (const companionPath of companions) {
    const fullPath = join(skillDir, companionPath);
    if (existsSync(fullPath)) {
      try {
        const content = readFileSync(fullPath, 'utf-8');
        loaded.push({
          name: companionPath,
          content,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`failed to read companion file ${companionPath}: ${message}`);
      }
    } else {
      console.warn(`companion file not found: ${companionPath} (in ${skillDir})`);
    }
  }
  return loaded;
}

export async function loadSkills(options: LoadSkillsOptions): Promise<LoadResult> {
  const { builtinDir, userDir, store, embedding } = options;
  const errors: Array<{ path: string; error: string }> = [];
  const skillsByName = new Map<string, { skill: SkillDefinition; source: SkillSource }>();

  for (const [source, dir] of [
    ['builtin', builtinDir] as const,
    ['user', userDir] as const,
  ]) {
    if (!existsSync(dir)) {
      continue;
    }

    let dirContents: string[];
    try {
      dirContents = readdirSync(dir);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ path: dir, error: `failed to read directory: ${message}` });
      continue;
    }

    for (const skillName of dirContents) {
      const skillPath = join(dir, skillName);
      const skillFile = join(skillPath, 'SKILL.md');

      if (!existsSync(skillFile)) {
        continue;
      }

      let content: string;
      try {
        content = readFileSync(skillFile, 'utf-8');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ path: skillFile, error: `failed to read file: ${message}` });
        continue;
      }

      const parseResult = parseSkillFile(content);
      if (!parseResult.success) {
        errors.push({ path: skillFile, error: parseResult.error });
        continue;
      }

      const { metadata, body } = parseResult;
      const contentHash = computeContentHash(content);
      const id = `skill:${source}:${metadata.name}`;
      const companions = loadCompanions(skillPath, metadata.companions);

      const skill: SkillDefinition = {
        id,
        metadata,
        body,
        companions,
        source: source as SkillSource,
        filePath: skillFile,
        contentHash,
      };

      skillsByName.set(metadata.name, { skill, source: source as SkillSource });
    }
  }

  // Collect all skills to embed
  const skillsToProcess = Array.from(skillsByName.values()).map(({ skill }) => skill);
  const storedIds = await store.getAllIds();
  const storedIdSet = new Set(storedIds);
  const currentIdSet = new Set(skillsToProcess.map(s => s.id));

  // Embed new or changed skills
  for (const skill of skillsToProcess) {
    const storedHash = await store.getByHash(skill.id);

    if (storedHash === skill.contentHash) {
      // Hash matches, skip embedding
      continue;
    }

    // New or changed skill, need to embed
    const embeddingText = buildEmbeddingText(skill.metadata, skill.body);
    const embeddingVector = await embedding.embed(embeddingText);

    await store.upsertEmbedding(
      skill.id,
      skill.metadata.name,
      skill.metadata.description,
      skill.contentHash,
      embeddingVector,
    );
  }

  // Remove orphaned skills
  for (const storedId of storedIdSet) {
    if (!currentIdSet.has(storedId)) {
      await store.deleteEmbedding(storedId);
    }
  }

  return {
    loaded: skillsToProcess,
    errors,
  };
}
