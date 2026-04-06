// pattern: Functional Core

import { describe, it, expect } from 'bun:test';
import { mcpPromptToSkill } from './skill-adapter.ts';

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
