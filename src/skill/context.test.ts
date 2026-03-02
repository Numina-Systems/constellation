// pattern: Functional Core

import { describe, it, expect } from 'bun:test';
import { formatSkillsSection } from './context.ts';
import { createTestSkill, createTestSkillWithCompanions } from './test-helpers.ts';
import type { SkillRegistry } from './types.ts';

describe('formatSkillsSection', () => {
  describe('skills.AC7.1: Format single skill with name and body', () => {
    it('should format a single skill with heading and body', () => {
      const skill = createTestSkill('example-skill', 'An example skill', 'This is the skill body content.');
      const result = formatSkillsSection([skill]);

      expect(result).toBeDefined();
      expect(result).toContain('## Active Skills');
      expect(result).toContain('### example-skill');
      expect(result).toContain('This is the skill body content.');
    });
  });

  describe('skills.AC7.2: Format skill with companions', () => {
    it('should include companion content after skill body', () => {
      const skill = createTestSkillWithCompanions('skill-with-companions', 'Skill with companions', 'Main body', [
        { name: 'Example', content: 'This is an example companion.' },
        { name: 'Reference', content: 'This is a reference companion.' },
      ]);

      const result = formatSkillsSection([skill]);

      expect(result).toBeDefined();
      expect(result).toContain('### skill-with-companions');
      expect(result).toContain('#### Example');
      expect(result).toContain('This is an example companion.');
      expect(result).toContain('#### Reference');
      expect(result).toContain('This is a reference companion.');
    });
  });

  describe('skills.AC7.3: Preserve skill order', () => {
    it('should preserve the order of skills in output', () => {
      const skill1 = createTestSkill('alpha-skill', 'First skill', 'First body');
      const skill2 = createTestSkill('beta-skill', 'Second skill', 'Second body');
      const skill3 = createTestSkill('gamma-skill', 'Third skill', 'Third body');

      const result = formatSkillsSection([skill1, skill2, skill3]);

      expect(result).toBeDefined();
      if (!result) throw new Error('Expected non-empty result');

      const indexAlpha = result.indexOf('### alpha-skill');
      const indexBeta = result.indexOf('### beta-skill');
      const indexGamma = result.indexOf('### gamma-skill');

      expect(indexAlpha).toBeLessThan(indexBeta);
      expect(indexBeta).toBeLessThan(indexGamma);
    });
  });

  describe('skills.AC6.4: Empty array returns undefined', () => {
    it('should return undefined when skills array is empty', () => {
      const result = formatSkillsSection([]);
      expect(result).toBeUndefined();
    });
  });

  describe('formatSkillsSection structure', () => {
    it('should separate multiple skills with divider', () => {
      const skill1 = createTestSkill('skill1', 'First', 'First body');
      const skill2 = createTestSkill('skill2', 'Second', 'Second body');

      const result = formatSkillsSection([skill1, skill2]);

      expect(result).toBeDefined();
      if (!result) throw new Error('Expected non-empty result');
      expect(result).toContain('---');
    });

    it('should format multiple companions with proper heading levels', () => {
      const skill = createTestSkillWithCompanions('multi-companion', 'Multi', 'Body', [
        { name: 'First', content: 'First content' },
        { name: 'Second', content: 'Second content' },
        { name: 'Third', content: 'Third content' },
      ]);

      const result = formatSkillsSection([skill]);

      expect(result).toBeDefined();
      if (!result) throw new Error('Expected non-empty result');

      const firstIdx = result.indexOf('#### First');
      const secondIdx = result.indexOf('#### Second');
      const thirdIdx = result.indexOf('#### Third');

      expect(firstIdx).toBeGreaterThan(0);
      expect(secondIdx).toBeGreaterThan(firstIdx);
      expect(thirdIdx).toBeGreaterThan(secondIdx);
    });
  });
});

// Part 2: Skill injection pipeline tests with mock SkillRegistry

async function buildSystemPromptWithSkills(
  basePrompt: string,
  skills: SkillRegistry | undefined,
  userMessage: string,
  maxSkills: number,
  threshold: number,
): Promise<string> {
  if (!skills) return basePrompt;
  const relevantSkills = await skills.getRelevant(userMessage, maxSkills, threshold);
  const section = formatSkillsSection(relevantSkills);
  return section ? basePrompt + '\n\n' + section : basePrompt;
}

describe('Skill injection pipeline', () => {
  describe('skills.AC6.1: Skills appear in system prompt when matched', () => {
    it('should inject matched skills into system prompt', async () => {
      const basePrompt = 'You are a helpful assistant.';
      const skill1 = createTestSkill('python-skill', 'Python programming', 'Write Python code');
      const skill2 = createTestSkill('js-skill', 'JavaScript programming', 'Write JS code');

      const mockRegistry: SkillRegistry = {
        load: async () => {},
        getAll: () => [],
        getByName: () => null,
        search: async () => [],
        getRelevant: async () => [skill1, skill2],
        createAgentSkill: async () => skill1,
        updateAgentSkill: async () => skill1,
      };

      const result = await buildSystemPromptWithSkills(basePrompt, mockRegistry, 'write python', 3, 0.3);

      expect(result).toContain(basePrompt);
      expect(result).toContain('## Active Skills');
      expect(result).toContain('### python-skill');
      expect(result).toContain('### js-skill');
    });
  });

  describe('skills.AC6.2: Threshold filtering via getRelevant contract', () => {
    it('should respect threshold filtering by calling getRelevant', async () => {
      const basePrompt = 'Base system prompt.';
      const relevantSkill = createTestSkill('relevant', 'Relevant skill', 'This is relevant');

      const mockRegistry: SkillRegistry = {
        load: async () => {},
        getAll: () => [],
        getByName: () => null,
        search: async () => [],
        // Mock contract: only return skills above threshold
        getRelevant: async (_userMessage: string, _limit?: number, threshold?: number) => {
          // Simulate filtering - in real implementation, this filtering happens in registry
          // Here we just verify the contract: threshold is passed and we respect it
          if (threshold !== undefined && threshold > 0.5) {
            // High threshold - no results
            return [];
          }
          return [relevantSkill];
        },
        createAgentSkill: async () => relevantSkill,
        updateAgentSkill: async () => relevantSkill,
      };

      // With low threshold, should include skill
      const resultLow = await buildSystemPromptWithSkills(basePrompt, mockRegistry, 'test', 3, 0.3);
      expect(resultLow).toContain('## Active Skills');

      // With high threshold, should not include skill
      const resultHigh = await buildSystemPromptWithSkills(basePrompt, mockRegistry, 'test', 3, 0.7);
      expect(resultHigh).not.toContain('## Active Skills');
    });
  });

  describe('skills.AC6.3: Respect max_skills_per_turn limit', () => {
    it('should pass maxSkills limit to getRelevant', async () => {
      const basePrompt = 'Base prompt.';
      let receivedLimit: number | undefined;

      const mockRegistry: SkillRegistry = {
        load: async () => {},
        getAll: () => [],
        getByName: () => null,
        search: async () => [],
        getRelevant: async (_userMessage: string, limit?: number) => {
          receivedLimit = limit;
          // Return max limit skills to test limiting
          return limit ? Array.from({ length: limit }, (_, i) => createTestSkill(`skill${i}`, `Skill ${i}`, 'Body')) : [];
        },
        createAgentSkill: async () => createTestSkill('test', 'test', 'test'),
        updateAgentSkill: async () => createTestSkill('test', 'test', 'test'),
      };

      await buildSystemPromptWithSkills(basePrompt, mockRegistry, 'test', 5, 0.3);

      // Verify the limit was passed to getRelevant
      expect(receivedLimit).toBe(5);
    });
  });

  describe('skills.AC6.5: Graceful handling of missing skills dependency', () => {
    it('should return base prompt unchanged when skills is undefined', async () => {
      const basePrompt = 'You are a helpful assistant.';

      const result = await buildSystemPromptWithSkills(basePrompt, undefined, 'test message', 3, 0.3);

      expect(result).toBe(basePrompt);
      expect(result).not.toContain('## Active Skills');
    });
  });

  describe('skills.AC6.4: No section when no skills match', () => {
    it('should not append section when getRelevant returns empty array', async () => {
      const basePrompt = 'Base system prompt.';

      const mockRegistry: SkillRegistry = {
        load: async () => {},
        getAll: () => [],
        getByName: () => null,
        search: async () => [],
        getRelevant: async () => {
          // No matching skills
          return [];
        },
        createAgentSkill: async () => createTestSkill('test', 'test', 'test'),
        updateAgentSkill: async () => createTestSkill('test', 'test', 'test'),
      };

      const result = await buildSystemPromptWithSkills(basePrompt, mockRegistry, 'test', 3, 0.3);

      expect(result).toBe(basePrompt);
      expect(result).not.toContain('## Active Skills');
    });
  });
});
