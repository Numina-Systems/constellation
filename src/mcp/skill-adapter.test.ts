// pattern: Functional Core

import { describe, it, expect } from 'bun:test';
import { mcpPromptToSkill, mcpPromptsToSkills } from './skill-adapter.ts';
import type { McpClient } from './types.ts';

describe('mcpPromptToSkill', () => {
  describe('AC5.1: MCP skills have source field set to "mcp"', () => {
    it('should create a skill with source "mcp"', () => {
      const prompt = {
        name: 'code-review',
        description: 'Review code for quality issues',
        arguments: [],
      };

      const skill = mcpPromptToSkill('github', prompt, 'body text');

      expect(skill.source).toBe('mcp');
    });
  });

  describe('AC5.2: MCP skill ID format and kebab-case name conversion', () => {
    it('should generate correct ID format: skill:mcp:{server}:{name}', () => {
      const prompt = {
        name: 'code-review',
        description: 'Review code',
        arguments: [],
      };

      const skill = mcpPromptToSkill('github', prompt, 'body');

      expect(skill.id).toBe('skill:mcp:github:code-review');
    });

    it('should convert underscore names to kebab-case', () => {
      const prompt = {
        name: 'code_review',
        description: 'Review code',
        arguments: [],
      };

      const skill = mcpPromptToSkill('github', prompt, 'body');

      expect(skill.metadata.name).toBe('code-review');
    });

    it('should convert space-separated names to kebab-case', () => {
      const prompt = {
        name: 'Code Review',
        description: 'Review code',
        arguments: [],
      };

      const skill = mcpPromptToSkill('github', prompt, 'body');

      expect(skill.metadata.name).toBe('code-review');
    });

    it('should convert mixed case and underscores', () => {
      const prompt = {
        name: 'Code_Review_Tool',
        description: 'Review code',
        arguments: [],
      };

      const skill = mcpPromptToSkill('github', prompt, 'body');

      expect(skill.metadata.name).toBe('code-review-tool');
    });
  });

  describe('AC5.1/AC5.2: Skill properties', () => {
    it('should set body to input body string', () => {
      const bodyText = 'This is the prompt body content';
      const prompt = {
        name: 'test-prompt',
        description: 'Test',
        arguments: [],
      };

      const skill = mcpPromptToSkill('test-server', prompt, bodyText);

      expect(skill.body).toBe(bodyText);
    });

    it('should have empty companions array', () => {
      const prompt = {
        name: 'test',
        description: 'Test',
        arguments: [],
      };

      const skill = mcpPromptToSkill('server', prompt, 'body');

      expect(skill.companions).toEqual([]);
    });

    it('should have filePath starting with mcp://', () => {
      const prompt = {
        name: 'code-review',
        description: 'Test',
        arguments: [],
      };

      const skill = mcpPromptToSkill('github', prompt, 'body');

      expect(skill.filePath).toMatch(/^mcp:\/\//);
    });

    it('should include serverName and prompt name in filePath', () => {
      const prompt = {
        name: 'code-review',
        description: 'Test',
        arguments: [],
      };

      const skill = mcpPromptToSkill('github', prompt, 'body');

      expect(skill.filePath).toBe('mcp://github/code-review');
    });

    it('should generate non-empty contentHash', () => {
      const prompt = {
        name: 'test',
        description: 'Test',
        arguments: [],
      };

      const skill = mcpPromptToSkill('server', prompt, 'body');

      expect(skill.contentHash).toBeTruthy();
      expect(typeof skill.contentHash).toBe('string');
      expect(skill.contentHash.length).toBeGreaterThan(0);
    });

    it('should generate deterministic contentHash from body', () => {
      const prompt = {
        name: 'test',
        description: 'Test',
        arguments: [],
      };
      const bodyText = 'same content';

      const skill1 = mcpPromptToSkill('server', prompt, bodyText);
      const skill2 = mcpPromptToSkill('server', prompt, bodyText);

      expect(skill1.contentHash).toBe(skill2.contentHash);
    });

    it('should generate different contentHash for different body', () => {
      const prompt = {
        name: 'test',
        description: 'Test',
        arguments: [],
      };

      const skill1 = mcpPromptToSkill('server', prompt, 'body1');
      const skill2 = mcpPromptToSkill('server', prompt, 'body2');

      expect(skill1.contentHash).not.toBe(skill2.contentHash);
    });
  });

  describe('Description handling', () => {
    it('should use prompt description when provided', () => {
      const prompt = {
        name: 'test',
        description: 'Custom description',
        arguments: [],
      };

      const skill = mcpPromptToSkill('server', prompt, 'body');

      expect(skill.metadata.description).toBe('Custom description');
    });

    it('should use default description when prompt description is undefined', () => {
      const prompt = {
        name: 'test',
        description: undefined,
        arguments: [],
      };

      const skill = mcpPromptToSkill('server', prompt, 'body');

      expect(skill.metadata.description).toContain('MCP prompt from');
      expect(skill.metadata.description).toContain('server');
    });
  });

  describe('Metadata tags', () => {
    it('should include "mcp" tag', () => {
      const prompt = {
        name: 'test',
        description: 'Test',
        arguments: [],
      };

      const skill = mcpPromptToSkill('github', prompt, 'body');

      expect(skill.metadata.tags).toContain('mcp');
    });

    it('should include server name in tags', () => {
      const prompt = {
        name: 'test',
        description: 'Test',
        arguments: [],
      };

      const skill = mcpPromptToSkill('github', prompt, 'body');

      expect(skill.metadata.tags).toContain('github');
    });

    it('should have exactly "mcp" and server name in tags', () => {
      const prompt = {
        name: 'test',
        description: 'Test',
        arguments: [],
      };

      const skill = mcpPromptToSkill('myserver', prompt, 'body');

      expect(skill.metadata.tags).toEqual(['mcp', 'myserver']);
    });
  });

  describe('mcpPromptsToSkills: required argument filtering', () => {
    function createMockClient(prompts: Array<{ name: string; description: string; arguments: Array<{ name: string; required: boolean }> }>): McpClient {
      return {
        serverName: 'test-server',
        connect: async () => {},
        disconnect: async () => {},
        listTools: async () => [],
        callTool: async () => ({ success: false, output: '', error: 'not implemented' }),
        listPrompts: async () => prompts.map((p) => ({
          name: p.name,
          description: p.description,
          arguments: p.arguments.map((a) => ({ name: a.name, description: undefined, required: a.required })),
        })),
        getPrompt: async (name) => {
          return { description: undefined, messages: [{ role: 'user' as const, content: `body for ${name}` }] };
        },
        getInstructions: async () => undefined,
      };
    }

    it('should skip prompts with required arguments', async () => {
      const client = createMockClient([
        { name: 'no-args', description: 'No args needed', arguments: [] },
        { name: 'has-required', description: 'Needs args', arguments: [{ name: 'nsid', required: true }] },
        { name: 'optional-only', description: 'Optional args', arguments: [{ name: 'hint', required: false }] },
      ]);

      const skills = await mcpPromptsToSkills(client);

      expect(skills).toHaveLength(2);
      expect(skills.map((s) => s.metadata.name)).toEqual(['no-args', 'optional-only']);
    });

    it('should return empty array when all prompts have required arguments', async () => {
      const client = createMockClient([
        { name: 'a', description: 'A', arguments: [{ name: 'x', required: true }] },
        { name: 'b', description: 'B', arguments: [{ name: 'y', required: true }] },
      ]);

      const skills = await mcpPromptsToSkills(client);

      expect(skills).toHaveLength(0);
    });

    it('should handle getPrompt errors gracefully and continue', async () => {
      const client = createMockClient([
        { name: 'good', description: 'Works', arguments: [] },
        { name: 'bad', description: 'Broken', arguments: [] },
      ]);

      let callCount = 0;
      client.getPrompt = async (name) => {
        callCount++;
        if (name === 'bad') throw new Error('render failed');
        return { description: undefined, messages: [{ role: 'user' as const, content: 'body' }] };
      };

      const skills = await mcpPromptsToSkills(client);

      expect(skills).toHaveLength(1);
      expect(skills[0]?.metadata.name).toBe('good');
      expect(callCount).toBe(2);
    });
  });

  describe('Version and companion metadata', () => {
    it('should have undefined version', () => {
      const prompt = {
        name: 'test',
        description: 'Test',
        arguments: [],
      };

      const skill = mcpPromptToSkill('server', prompt, 'body');

      expect(skill.metadata.version).toBeUndefined();
    });

    it('should have undefined companions in metadata', () => {
      const prompt = {
        name: 'test',
        description: 'Test',
        arguments: [],
      };

      const skill = mcpPromptToSkill('server', prompt, 'body');

      expect(skill.metadata.companions).toBeUndefined();
    });

    it('should have undefined tools in metadata', () => {
      const prompt = {
        name: 'test',
        description: 'Test',
        arguments: [],
      };

      const skill = mcpPromptToSkill('server', prompt, 'body');

      expect(skill.metadata.tools).toBeUndefined();
    });
  });
});
