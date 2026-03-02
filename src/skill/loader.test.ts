// pattern: Imperative Shell

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { loadSkills } from './loader.ts';
import { createMockSkillStore, createMockEmbeddingProvider } from './test-helpers.ts';

describe('loadSkills', () => {
  let tempDir: string;
  let builtinDir: string;
  let userDir: string;
  let store: ReturnType<typeof createMockSkillStore>;
  let embedding: ReturnType<typeof createMockEmbeddingProvider>;

  beforeEach(() => {
    tempDir = join(tmpdir(), `skill-loader-test-${randomBytes(8).toString('hex')}`);
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

  describe('skills.AC4.1: Discover builtin skills', () => {
    it('should discover SKILL.md files in builtinDir/*/SKILL.md pattern', async () => {
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

      const result = await loadSkills({ builtinDir, userDir, store, embedding });

      expect(result.loaded).toHaveLength(1);
      expect(result.loaded[0]?.metadata.name).toBe('test-skill');
      expect(result.loaded[0]?.source).toBe('builtin');
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('skills.AC4.2: Discover user skills', () => {
    it('should discover SKILL.md files in userDir/*/SKILL.md pattern', async () => {
      const skillDir = join(userDir, 'user-skill');
      mkdirSync(skillDir);
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: user-skill
description: A user skill
---
# Body

User content`,
      );

      const result = await loadSkills({ builtinDir, userDir, store, embedding });

      expect(result.loaded).toHaveLength(1);
      expect(result.loaded[0]?.metadata.name).toBe('user-skill');
      expect(result.loaded[0]?.source).toBe('user');
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('skills.AC4.3: User skills override builtin skills', () => {
    it('should prefer user skill over builtin skill with same name', async () => {
      // Create builtin skill
      const builtinSkillDir = join(builtinDir, 'overlap');
      mkdirSync(builtinSkillDir);
      writeFileSync(
        join(builtinSkillDir, 'SKILL.md'),
        `---
name: overlap
description: Builtin version
---
# Body

Builtin content`,
      );

      // Create user skill with same name
      const userSkillDir = join(userDir, 'overlap');
      mkdirSync(userSkillDir);
      writeFileSync(
        join(userSkillDir, 'SKILL.md'),
        `---
name: overlap
description: User version
---
# Body

User content`,
      );

      const result = await loadSkills({ builtinDir, userDir, store, embedding });

      expect(result.loaded).toHaveLength(1);
      const skill = result.loaded[0]!;
      expect(skill.metadata.name).toBe('overlap');
      expect(skill.metadata.description).toBe('User version');
      expect(skill.source).toBe('user');
    });
  });

  describe('skills.AC4.4: Skip unchanged skills', () => {
    it('should not re-embed skills with unchanged content hash', async () => {
      const skillDir = join(builtinDir, 'unchanged');
      mkdirSync(skillDir);
      const skillContent = `---
name: unchanged
description: Test skill
---
# Body

Unchanged content`;
      writeFileSync(join(skillDir, 'SKILL.md'), skillContent);

      // First load
      const result1 = await loadSkills({ builtinDir, userDir, store, embedding });
      expect(result1.loaded).toHaveLength(1);
      expect(embedding.callCount).toBeGreaterThan(0);

      // Reset call count
      embedding.callCount = 0;

      // Second load without changes
      const result2 = await loadSkills({ builtinDir, userDir, store, embedding });
      expect(result2.loaded).toHaveLength(1);
      const embedCalls2 = embedding.callCount;

      expect(embedCalls2).toBe(0);
      expect(store.data.size).toBe(1);
    });
  });

  describe('skills.AC4.5: Re-embed changed skills', () => {
    it('should re-embed skills when content hash changes', async () => {
      const skillDir = join(builtinDir, 'changing');
      mkdirSync(skillDir);
      const skillFile = join(skillDir, 'SKILL.md');

      // First version
      writeFileSync(
        skillFile,
        `---
name: changing
description: Version 1
---
# Body

Content v1`,
      );

      const result1 = await loadSkills({ builtinDir, userDir, store, embedding });
      expect(result1.loaded).toHaveLength(1);
      expect(embedding.callCount).toBe(1);

      // Reset and change content
      embedding.callCount = 0;
      writeFileSync(
        skillFile,
        `---
name: changing
description: Version 2
---
# Body

Content v2`,
      );

      const result2 = await loadSkills({ builtinDir, userDir, store, embedding });
      expect(result2.loaded).toHaveLength(1);

      expect(embedding.callCount).toBe(1);
    });
  });

  describe('skills.AC4.6: Remove orphaned embeddings', () => {
    it('should delete embeddings for skills removed from disk', async () => {
      // Create two skills
      const skill1Dir = join(builtinDir, 'skill1');
      const skill2Dir = join(builtinDir, 'skill2');
      mkdirSync(skill1Dir);
      mkdirSync(skill2Dir);

      writeFileSync(
        join(skill1Dir, 'SKILL.md'),
        `---
name: skill1
description: First skill
---
# Body

Content 1`,
      );

      writeFileSync(
        join(skill2Dir, 'SKILL.md'),
        `---
name: skill2
description: Second skill
---
# Body

Content 2`,
      );

      // First load
      const result1 = await loadSkills({ builtinDir, userDir, store, embedding });
      expect(result1.loaded).toHaveLength(2);
      expect(store.data.size).toBe(2);

      // Remove skill1 directory
      rmSync(skill1Dir, { recursive: true });

      // Second load
      const result2 = await loadSkills({ builtinDir, userDir, store, embedding });
      expect(result2.loaded).toHaveLength(1);
      expect(result2.loaded[0]?.metadata.name).toBe('skill2');
      expect(store.data.size).toBe(1);
      expect(store.data.has('skill:builtin:skill1')).toBe(false);
      expect(store.data.has('skill:builtin:skill2')).toBe(true);
    });
  });

  describe('skills.AC4.7: Load companion files', () => {
    it('should load companion files referenced in metadata', async () => {
      const skillDir = join(builtinDir, 'with-companion');
      mkdirSync(skillDir);

      writeFileSync(join(skillDir, 'SKILL.md'), `---
name: with-companion
description: Skill with companion
companions:
  - companion.md
---
# Body

Main content`);

      writeFileSync(join(skillDir, 'companion.md'), 'This is companion content');

      const result = await loadSkills({ builtinDir, userDir, store, embedding });

      expect(result.loaded).toHaveLength(1);
      const skill = result.loaded[0]!;
      expect(skill.companions).toHaveLength(1);
      expect(skill.companions[0]?.name).toBe('companion.md');
      expect(skill.companions[0]?.content).toBe('This is companion content');
    });
  });

  describe('skills.AC4.8: Missing companion file warning', () => {
    it('should log warning and continue when companion file is missing', async () => {
      const skillDir = join(builtinDir, 'missing-companion');
      mkdirSync(skillDir);

      // Track console.warn calls
      let warnCalled = false;
      const originalWarn = console.warn;
      console.warn = () => {
        warnCalled = true;
      };

      try {
        writeFileSync(
          join(skillDir, 'SKILL.md'),
          `---
name: missing-companion
description: Skill with missing companion
companions:
  - nonexistent.md
---
# Body

Main content`,
        );

        const result = await loadSkills({ builtinDir, userDir, store, embedding });

        expect(result.loaded).toHaveLength(1);
        expect(result.errors).toHaveLength(0);
        const skill = result.loaded[0]!;
        expect(skill.companions).toHaveLength(0);
        expect(warnCalled).toBe(true);
      } finally {
        console.warn = originalWarn;
      }
    });
  });

  describe('skills.AC4.9: Skill ID format', () => {
    it('should format skill IDs as skill:${source}:${name}', async () => {
      const builtinSkillDir = join(builtinDir, 'id-test-builtin');
      const userSkillDir = join(userDir, 'id-test-user');
      mkdirSync(builtinSkillDir);
      mkdirSync(userSkillDir);

      writeFileSync(
        join(builtinSkillDir, 'SKILL.md'),
        `---
name: id-test-builtin
description: Builtin test
---
# Body

Content`,
      );

      writeFileSync(
        join(userSkillDir, 'SKILL.md'),
        `---
name: id-test-user
description: User test
---
# Body

Content`,
      );

      const result = await loadSkills({ builtinDir, userDir, store, embedding });

      expect(result.loaded).toHaveLength(2);
      const builtinSkill = result.loaded.find((s) => s.source === 'builtin')!;
      const userSkill = result.loaded.find((s) => s.source === 'user')!;

      expect(builtinSkill.id).toBe('skill:builtin:id-test-builtin');
      expect(userSkill.id).toBe('skill:user:id-test-user');
    });
  });

  describe('error handling', () => {
    it('should report parse errors and continue', async () => {
      const goodSkillDir = join(builtinDir, 'good');
      const badSkillDir = join(builtinDir, 'bad');
      mkdirSync(goodSkillDir);
      mkdirSync(badSkillDir);

      writeFileSync(
        join(goodSkillDir, 'SKILL.md'),
        `---
name: good
description: Good skill
---
# Body

Content`,
      );

      writeFileSync(
        join(badSkillDir, 'SKILL.md'),
        `---
name: bad skill
description: This has invalid name (spaces not allowed)
---
# Body

Content`,
      );

      const result = await loadSkills({ builtinDir, userDir, store, embedding });

      expect(result.loaded).toHaveLength(1);
      expect(result.loaded[0]?.metadata.name).toBe('good');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.error).toContain('validation failed');
    });
  });
});
