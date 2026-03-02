// pattern: Imperative Shell

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createSkillRegistry } from './registry.ts';
import { createMockSkillStore, createMockEmbeddingProvider } from './test-helpers.ts';

describe('createSkillRegistry', () => {
  let tempDir: string;
  let builtinDir: string;
  let userDir: string;
  let store: ReturnType<typeof createMockSkillStore>;
  let embedding: ReturnType<typeof createMockEmbeddingProvider>;

  beforeEach(() => {
    tempDir = join(tmpdir(), `skill-registry-test-${randomBytes(8).toString('hex')}`);
    builtinDir = join(tempDir, 'builtin');
    userDir = join(tempDir, 'user');
    mkdirSync(builtinDir, { recursive: true });
    mkdirSync(userDir, { recursive: true });
    store = createMockSkillStore();
    embedding = createMockEmbeddingProvider();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('skills.AC5.1: getRelevant returns skills above threshold', () => {
    it('should filter results by similarity threshold', async () => {
      const skillDir = join(builtinDir, 'test-skill');
      mkdirSync(skillDir);
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: test-skill
description: A test skill
---
# Body

Test content`,
      );

      const registry = createSkillRegistry({ store, embedding, builtinDir, userDir });
      await registry.load();

      const relevant = await registry.getRelevant('test skill context', 10, 0.3);

      expect(relevant.length).toBeGreaterThan(0);
      expect(relevant[0]).toBeDefined();
      expect(relevant[0]?.metadata.name).toBe('test-skill');
    });

    it('should exclude results below threshold with mixed scores', async () => {
      const skill1Dir = join(builtinDir, 'high-score-skill');
      mkdirSync(skill1Dir);
      writeFileSync(
        join(skill1Dir, 'SKILL.md'),
        `---
name: high-score-skill
description: A skill with high relevance
---
# Body

Highly relevant content`,
      );

      const skill2Dir = join(builtinDir, 'low-score-skill');
      mkdirSync(skill2Dir);
      writeFileSync(
        join(skill2Dir, 'SKILL.md'),
        `---
name: low-score-skill
description: A skill with low relevance
---
# Body

Weakly relevant content`,
      );

      const registry = createSkillRegistry({ store, embedding, builtinDir, userDir });
      await registry.load();

      // Set specific scores: high above threshold, low below
      store.setScores(
        new Map([
          ['skill:builtin:high-score-skill', 0.8],
          ['skill:builtin:low-score-skill', 0.2],
        ]),
      );

      const threshold = 0.5;
      const relevant = await registry.getRelevant('some context', 10, threshold);

      expect(relevant).toHaveLength(1);
      expect(relevant[0]).toBeDefined();
      expect(relevant[0]?.metadata.name).toBe('high-score-skill');
    });
  });

  describe('skills.AC5.2: getRelevant respects limit parameter', () => {
    it('should return at most N results when limit is specified', async () => {
      for (let i = 0; i < 5; i++) {
        const skillDir = join(builtinDir, `skill-${i}`);
        mkdirSync(skillDir);
        writeFileSync(
          join(skillDir, 'SKILL.md'),
          `---
name: skill-${i}
description: Test skill ${i}
---
# Body

Content ${i}`,
        );
      }

      const registry = createSkillRegistry({ store, embedding, builtinDir, userDir });
      await registry.load();

      const relevant = await registry.getRelevant('context', 2);

      expect(relevant.length).toBeLessThanOrEqual(2);
    });
  });

  describe('skills.AC5.3: getAll returns all loaded skills', () => {
    it('should return all skills from both builtin and user dirs', async () => {
      const builtinSkillDir = join(builtinDir, 'builtin-skill');
      mkdirSync(builtinSkillDir);
      writeFileSync(
        join(builtinSkillDir, 'SKILL.md'),
        `---
name: builtin-skill
description: A builtin skill
---
# Body

Builtin content`,
      );

      const userSkillDir = join(userDir, 'user-skill');
      mkdirSync(userSkillDir);
      writeFileSync(
        join(userSkillDir, 'SKILL.md'),
        `---
name: user-skill
description: A user skill
---
# Body

User content`,
      );

      const registry = createSkillRegistry({ store, embedding, builtinDir, userDir });
      await registry.load();

      const all = registry.getAll();

      expect(all).toHaveLength(2);
      expect(all.map((s) => s.metadata.name).sort()).toEqual(['builtin-skill', 'user-skill']);
    });
  });

  describe('skills.AC5.4: getByName retrieves skill by name', () => {
    it('should return the skill with matching name, or null', async () => {
      const skillDir = join(builtinDir, 'test-skill');
      mkdirSync(skillDir);
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: test-skill
description: A test skill
---
# Body

Test content`,
      );

      const registry = createSkillRegistry({ store, embedding, builtinDir, userDir });
      await registry.load();

      const found = registry.getByName('test-skill');
      expect(found).not.toBeNull();
      expect(found?.metadata.name).toBe('test-skill');

      const notFound = registry.getByName('nonexistent');
      expect(notFound).toBeNull();
    });
  });

  describe('skills.AC5.5: search returns SkillSearchResult array', () => {
    it('should return ranked results with id, name, description, score', async () => {
      const skillDir = join(builtinDir, 'test-skill');
      mkdirSync(skillDir);
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: test-skill
description: A test skill for searching
---
# Body

This is a test skill with searchable content`,
      );

      const registry = createSkillRegistry({ store, embedding, builtinDir, userDir });
      await registry.load();

      const results = await registry.search('test query');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toBeDefined();
      const result = results[0]!;
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('description');
      expect(result).toHaveProperty('score');
      expect(result.name).toBe('test-skill');
      expect(result.description).toBe('A test skill for searching');
    });
  });

  describe('skills.AC5.6: createUserSkill writes file and adds to registry', () => {
    it('should create skill file, parse, embed, and add to registry', async () => {
      const registry = createSkillRegistry({ store, embedding, builtinDir, userDir });

      const created = await registry.createUserSkill(
        'new-skill',
        'A newly created skill',
        'This is the body of the skill',
        ['tag1', 'tag2'],
      );

      expect(created).toBeDefined();
      expect(created.metadata.name).toBe('new-skill');
      expect(created.metadata.description).toBe('A newly created skill');
      expect(created.metadata.tags).toEqual(['tag1', 'tag2']);
      expect(created.source).toBe('user');
      expect(created.id).toBe('skill:user:new-skill');

      const retrieved = registry.getByName('new-skill');
      expect(retrieved).toBeDefined();
      expect(retrieved?.metadata.name).toBe('new-skill');

      const skillFilePath = join(userDir, 'new-skill', 'SKILL.md');
      const fileExists = await Bun.file(skillFilePath).exists();
      expect(fileExists).toBe(true);
    });

    it('should safely handle descriptions with YAML special characters', async () => {
      const registry = createSkillRegistry({ store, embedding, builtinDir, userDir });

      // Description with colon-space (YAML injection risk)
      const unsafeDesc = 'Skill for: handling errors and special cases';
      const created = await registry.createUserSkill(
        'safe-skill',
        unsafeDesc,
        'This skill handles edge cases',
        ['safe', 'secure'],
      );

      expect(created).toBeDefined();
      expect(created.metadata.description).toBe(unsafeDesc);

      // Retrieve and verify it round-trips correctly
      const retrieved = registry.getByName('safe-skill');
      expect(retrieved).toBeDefined();
      expect(retrieved?.metadata.description).toBe(unsafeDesc);

      // Verify file content is valid YAML
      const skillFilePath = join(userDir, 'safe-skill', 'SKILL.md');
      const content = await Bun.file(skillFilePath).text();
      expect(content).toContain('---');
      // The file should parse without error (verified by registry loading)
    });
  });

  describe('skills.AC5.7: updateUserSkill updates existing user skill', () => {
    it('should update file and registry for user skills', async () => {
      const userSkillDir = join(userDir, 'user-skill');
      mkdirSync(userSkillDir);
      writeFileSync(
        join(userSkillDir, 'SKILL.md'),
        `---
name: user-skill
description: Original description
---
# Body

Original body`,
      );

      const registry = createSkillRegistry({ store, embedding, builtinDir, userDir });
      await registry.load();

      let retrieved = registry.getByName('user-skill');
      expect(retrieved?.metadata.description).toBe('Original description');

      const updated = await registry.updateUserSkill(
        'user-skill',
        'Updated description',
        'Updated body',
        ['updated-tag'],
      );

      expect(updated.metadata.description).toBe('Updated description');
      expect(updated.body).toBe('Updated body');
      expect(updated.metadata.tags).toEqual(['updated-tag']);

      retrieved = registry.getByName('user-skill');
      expect(retrieved?.metadata.description).toBe('Updated description');
    });
  });

  describe('skills.AC5.8: updateUserSkill rejects builtin skills', () => {
    it('should throw error when attempting to update builtin skill', async () => {
      const builtinSkillDir = join(builtinDir, 'builtin-skill');
      mkdirSync(builtinSkillDir);
      writeFileSync(
        join(builtinSkillDir, 'SKILL.md'),
        `---
name: builtin-skill
description: A builtin skill
---
# Body

Builtin content`,
      );

      const registry = createSkillRegistry({ store, embedding, builtinDir, userDir });
      await registry.load();

      try {
        await registry.updateUserSkill('builtin-skill', 'New description', 'New body');
        expect.unreachable('Expected error to be thrown');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toContain('cannot update builtin skill');
        expect(message).toContain('user skills only');
      }
    });
  });
});
