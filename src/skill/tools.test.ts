// pattern: Imperative Shell

import { describe, it, expect } from 'bun:test';
import type { SkillDefinition, SkillRegistry } from './types.ts';
import { createSkillTools } from './tools.ts';
import { createTestSkill, createTestSkillWithCompanions } from './test-helpers.ts';

describe('Skill management tools', () => {
  function createMockRegistry(skills: Array<SkillDefinition>): SkillRegistry {
    const map = new Map(skills.map((s) => [s.metadata.name, s]));

    return {
      async load() {},
      getAll: () => Array.from(map.values()),
      getByName: (name) => map.get(name) ?? null,
      async search() {
        return [];
      },
      async getRelevant() {
        return [];
      },
      async createAgentSkill(name, description, body, tags) {
        if (!/^[a-z0-9-]+$/.test(name)) {
          throw new Error('invalid name format');
        }
        const skill: SkillDefinition = {
          id: `skill:agent:${name}`,
          metadata: {
            name,
            description,
            version: '1.0.0',
            tags: Array.isArray(tags) ? tags : [],
          },
          body,
          companions: [],
          source: 'agent',
          filePath: `/agent/${name}/SKILL.md`,
          contentHash: `hash-${name}`,
        };
        map.set(name, skill);
        return skill;
      },
      async updateAgentSkill(name, description, body, tags) {
        const existing = map.get(name);
        if (!existing) {
          throw new Error('skill not found');
        }
        if (existing.source === 'builtin') {
          throw new Error('cannot update builtin skill');
        }
        const updated: SkillDefinition = {
          ...existing,
          metadata: {
            ...existing.metadata,
            description,
            tags: Array.isArray(tags) ? tags : [],
          },
          body,
          contentHash: `hash-${name}-updated`,
        };
        map.set(name, updated);
        return updated;
      },
      async injectSkills(skillsToInject) {
        for (const skill of skillsToInject) {
          map.set(skill.metadata.name, skill);
        }
      },
    };
  }

  describe('skills.AC8.1: skill_list returns all skills with metadata', () => {
    it('should list all skills with name, description, source, and tags', async () => {
      const skill1 = createTestSkill('skill-one', 'First skill', 'body one');
      const skill2 = createTestSkill('skill-two', 'Second skill', 'body two');
      const skill3 = {
        ...createTestSkill('skill-three', 'Third skill', 'body three'),
        metadata: {
          ...createTestSkill('skill-three', 'Third skill', 'body three').metadata,
          tags: ['tag1', 'tag2'],
        },
      };

      const registry = createMockRegistry([skill1, skill2, skill3]);
      const tools = createSkillTools(registry);
      const skill_list = tools.find((t) => t.definition.name === 'skill_list');
      expect(skill_list).toBeDefined();

      if (!skill_list) return;

      const result = await skill_list.handler({});

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(3);

      const first = parsed[0];
      expect(first.name).toBe('skill-one');
      expect(first.description).toBe('First skill');
      expect(first.source).toBe('builtin');
      expect(Array.isArray(first.tags)).toBe(true);

      const third = parsed[2];
      expect(third.tags.length).toBe(2);
      expect(third.tags).toEqual(['tag1', 'tag2']);
    });
  });

  describe('skills.AC8.2: skill_list filters by source parameter', () => {
    it('should filter to agent skills only when source=agent', async () => {
      const builtinSkill = createTestSkill('builtin-skill', 'Builtin', 'builtin body');
      const agentSkill = {
        ...createTestSkill('agent-skill', 'Agent skill', 'agent body'),
        source: 'agent' as const,
      };

      const registry = createMockRegistry([builtinSkill, agentSkill]);
      const tools = createSkillTools(registry);
      const skill_list = tools.find((t) => t.definition.name === 'skill_list');
      expect(skill_list).toBeDefined();

      if (!skill_list) return;

      const result = await skill_list.handler({ source: 'agent' });

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.length).toBe(1);
      expect(parsed[0].name).toBe('agent-skill');
      expect(parsed[0].source).toBe('agent');
    });

    it('should filter to builtin skills only when source=builtin', async () => {
      const builtinSkill = createTestSkill('builtin-skill', 'Builtin', 'builtin body');
      const agentSkill = {
        ...createTestSkill('agent-skill', 'Agent skill', 'agent body'),
        source: 'agent' as const,
      };

      const registry = createMockRegistry([builtinSkill, agentSkill]);
      const tools = createSkillTools(registry);
      const skill_list = tools.find((t) => t.definition.name === 'skill_list');
      expect(skill_list).toBeDefined();

      if (!skill_list) return;

      const result = await skill_list.handler({ source: 'builtin' });

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.length).toBe(1);
      expect(parsed[0].name).toBe('builtin-skill');
      expect(parsed[0].source).toBe('builtin');
    });
  });

  describe('skills.AC8.3: skill_read returns full skill content including companions', () => {
    it('should return skill body and companion content', async () => {
      const skill = createTestSkillWithCompanions(
        'test-skill',
        'A test skill',
        'This is the main body',
        [
          { name: 'helper.ts', content: 'export const helper = () => {};' },
          { name: 'utils.ts', content: 'export const util = () => {};' },
        ],
      );

      const registry = createMockRegistry([skill]);
      const tools = createSkillTools(registry);
      const skill_read = tools.find((t) => t.definition.name === 'skill_read');
      expect(skill_read).toBeDefined();

      if (!skill_read) return;

      const result = await skill_read.handler({ name: 'test-skill' });

      expect(result.success).toBe(true);
      expect(result.output).toContain('# test-skill');
      expect(result.output).toContain('This is the main body');
      expect(result.output).toContain('## Companions');
      expect(result.output).toContain('helper.ts');
      expect(result.output).toContain('export const helper = () => {};');
      expect(result.output).toContain('utils.ts');
      expect(result.output).toContain('export const util = () => {};');
    });
  });

  describe('skills.AC8.4: skill_read with unknown name returns error', () => {
    it('should return error when skill does not exist', async () => {
      const registry = createMockRegistry([]);
      const tools = createSkillTools(registry);
      const skill_read = tools.find((t) => t.definition.name === 'skill_read');
      expect(skill_read).toBeDefined();

      if (!skill_read) return;

      const result = await skill_read.handler({ name: 'nonexistent' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('skill not found');
      expect(result.error).toContain('nonexistent');
      expect(result.output).toBe('');
    });
  });

  describe('skills.AC8.5: skill_create creates a new agent skill', () => {
    it('should create a skill and return success', async () => {
      const registry = createMockRegistry([]);
      const tools = createSkillTools(registry);
      const skill_create = tools.find((t) => t.definition.name === 'skill_create');
      expect(skill_create).toBeDefined();

      if (!skill_create) return;

      const result = await skill_create.handler({
        name: 'my-new-skill',
        description: 'A new skill',
        body: 'This is my new skill body',
        tags: 'tag1, tag2',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('created skill: my-new-skill');

      const created = registry.getByName('my-new-skill');
      expect(created).toBeDefined();
      expect(created?.metadata.name).toBe('my-new-skill');
      expect(created?.metadata.description).toBe('A new skill');
      expect(created?.body).toBe('This is my new skill body');
      expect(created?.metadata.tags).toEqual(['tag1', 'tag2']);
      expect(created?.source).toBe('agent');
    });
  });

  describe('skills.AC8.6: skill_create with invalid name format returns error', () => {
    it('should reject names with invalid characters', async () => {
      const registry = createMockRegistry([]);
      const tools = createSkillTools(registry);
      const skill_create = tools.find((t) => t.definition.name === 'skill_create');
      expect(skill_create).toBeDefined();

      if (!skill_create) return;

      const result = await skill_create.handler({
        name: 'Invalid Name',
        description: 'A skill with bad name',
        body: 'body',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('invalid name format');
      expect(result.output).toBe('');
    });

    it('should reject names with uppercase letters', async () => {
      const registry = createMockRegistry([]);
      const tools = createSkillTools(registry);
      const skill_create = tools.find((t) => t.definition.name === 'skill_create');
      expect(skill_create).toBeDefined();

      if (!skill_create) return;

      const result = await skill_create.handler({
        name: 'MySkill',
        description: 'A skill',
        body: 'body',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('invalid name format');
    });

    it('should reject names with spaces', async () => {
      const registry = createMockRegistry([]);
      const tools = createSkillTools(registry);
      const skill_create = tools.find((t) => t.definition.name === 'skill_create');
      expect(skill_create).toBeDefined();

      if (!skill_create) return;

      const result = await skill_create.handler({
        name: 'my skill',
        description: 'A skill',
        body: 'body',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('invalid name format');
    });
  });

  describe('skills.AC8.7: skill_update updates an existing agent skill', () => {
    it('should update an agent skill successfully', async () => {
      const agentSkill = {
        ...createTestSkill('my-skill', 'Original description', 'original body'),
        source: 'agent' as const,
      };

      const registry = createMockRegistry([agentSkill]);
      const tools = createSkillTools(registry);
      const skill_update = tools.find((t) => t.definition.name === 'skill_update');
      expect(skill_update).toBeDefined();

      if (!skill_update) return;

      const result = await skill_update.handler({
        name: 'my-skill',
        description: 'Updated description',
        body: 'updated body',
        tags: 'new-tag',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('updated skill: my-skill');

      const updated = registry.getByName('my-skill');
      expect(updated).toBeDefined();
      expect(updated?.metadata.description).toBe('Updated description');
      expect(updated?.body).toBe('updated body');
      expect(updated?.metadata.tags).toEqual(['new-tag']);
    });
  });

  describe('skills.AC8.8: skill_update on builtin skill returns error', () => {
    it('should reject updates to builtin skills', async () => {
      const builtinSkill = createTestSkill('builtin-skill', 'Builtin', 'builtin body');

      const registry = createMockRegistry([builtinSkill]);
      const tools = createSkillTools(registry);
      const skill_update = tools.find((t) => t.definition.name === 'skill_update');
      expect(skill_update).toBeDefined();

      if (!skill_update) return;

      const result = await skill_update.handler({
        name: 'builtin-skill',
        description: 'new description',
        body: 'new body',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('cannot update builtin skill');
      expect(result.output).toBe('');
    });
  });

  describe('Tool definitions and handlers', () => {
    it('should export 4 tools with correct names', () => {
      const registry = createMockRegistry([]);
      const tools = createSkillTools(registry);

      expect(tools.length).toBe(4);
      const names = tools.map((t) => t.definition.name);
      expect(names).toEqual(['skill_list', 'skill_read', 'skill_create', 'skill_update']);
    });

    it('all tools should have descriptions and parameters', () => {
      const registry = createMockRegistry([]);
      const tools = createSkillTools(registry);

      for (const tool of tools) {
        expect(tool.definition.description).toBeDefined();
        expect(tool.definition.description.length).toBeGreaterThan(0);
        expect(Array.isArray(tool.definition.parameters)).toBe(true);
        expect(typeof tool.handler).toBe('function');
      }
    });

    it('skill_list should have optional source parameter', () => {
      const registry = createMockRegistry([]);
      const tools = createSkillTools(registry);

      const skill_list = tools.find((t) => t.definition.name === 'skill_list');
      expect(skill_list).toBeDefined();

      const sourceParam = skill_list?.definition.parameters.find((p) => p.name === 'source');
      expect(sourceParam).toBeDefined();
      expect(sourceParam?.required).toBe(false);
      expect(sourceParam?.enum_values).toEqual(['builtin', 'agent']);
    });

    it('skill_read should have required name parameter', () => {
      const registry = createMockRegistry([]);
      const tools = createSkillTools(registry);

      const skill_read = tools.find((t) => t.definition.name === 'skill_read');
      expect(skill_read).toBeDefined();

      const nameParam = skill_read?.definition.parameters.find((p) => p.name === 'name');
      expect(nameParam).toBeDefined();
      expect(nameParam?.required).toBe(true);
    });

    it('skill_create should have required and optional parameters', () => {
      const registry = createMockRegistry([]);
      const tools = createSkillTools(registry);

      const skill_create = tools.find((t) => t.definition.name === 'skill_create');
      expect(skill_create).toBeDefined();

      const params = skill_create?.definition.parameters ?? [];
      const requiredParams = params.filter((p) => p.required);
      const optionalParams = params.filter((p) => !p.required);

      expect(requiredParams.map((p) => p.name)).toContain('name');
      expect(requiredParams.map((p) => p.name)).toContain('description');
      expect(requiredParams.map((p) => p.name)).toContain('body');
      expect(optionalParams.map((p) => p.name)).toContain('tags');
    });
  });

  describe('Tag parsing', () => {
    it('should parse comma-separated tags and trim whitespace', async () => {
      const registry = createMockRegistry([]);
      const tools = createSkillTools(registry);
      const skill_create = tools.find((t) => t.definition.name === 'skill_create');
      expect(skill_create).toBeDefined();

      if (!skill_create) return;

      await skill_create.handler({
        name: 'skill-with-tags',
        description: 'desc',
        body: 'body',
        tags: '  tag1  , tag2,  tag3  ',
      });

      const created = registry.getByName('skill-with-tags');
      expect(created?.metadata.tags).toEqual(['tag1', 'tag2', 'tag3']);
    });

    it('should handle empty tags gracefully', async () => {
      const registry = createMockRegistry([]);
      const tools = createSkillTools(registry);
      const skill_create = tools.find((t) => t.definition.name === 'skill_create');
      expect(skill_create).toBeDefined();

      if (!skill_create) return;

      const result = await skill_create.handler({
        name: 'skill-no-tags',
        description: 'desc',
        body: 'body',
      });

      expect(result.success).toBe(true);
      const created = registry.getByName('skill-no-tags');
      expect(created?.metadata.tags).toEqual([]);
    });
  });
});
