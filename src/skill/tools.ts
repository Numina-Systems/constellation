// pattern: Imperative Shell

/**
 * Skill management tools for agent use.
 * Provides tools for listing, reading, creating, and updating skills.
 */

import type { Tool } from '../tool/types.ts';
import type { SkillRegistry } from './types.ts';

export function createSkillTools(registry: SkillRegistry): Array<Tool> {
  const skill_list: Tool = {
    definition: {
      name: 'skill_list',
      description: 'List all available skills with their names, descriptions, sources, and tags.',
      parameters: [
        {
          name: 'source',
          type: 'string',
          description: 'Filter skills by source (builtin or user)',
          required: false,
          enum_values: ['builtin', 'user'],
        },
      ],
    },
    handler: async (params) => {
      const source = params['source'] as string | undefined;

      const allSkills = registry.getAll();

      let filtered = allSkills;
      if (source) {
        filtered = allSkills.filter((skill) => skill.source === source);
      }

      const skillSummaries = filtered.map((skill) => ({
        name: skill.metadata.name,
        description: skill.metadata.description,
        source: skill.source,
        tags: skill.metadata.tags ?? [],
      }));

      return {
        success: true,
        output: JSON.stringify(skillSummaries, null, 2),
      };
    },
  };

  const skill_read: Tool = {
    definition: {
      name: 'skill_read',
      description:
        'Read the full content of a skill including its body and companion files.',
      parameters: [
        {
          name: 'name',
          type: 'string',
          description: 'Name of the skill to read',
          required: true,
        },
      ],
    },
    handler: async (params) => {
      const name = params['name'] as string;

      const skill = registry.getByName(name);
      if (!skill) {
        return {
          success: false,
          output: '',
          error: `skill not found: ${name}`,
        };
      }

      const lines: Array<string> = [];

      lines.push(`# ${skill.metadata.name}`);
      lines.push('');
      lines.push(`**Source:** ${skill.source}`);
      lines.push(`**Version:** ${skill.metadata.version ?? '1.0.0'}`);

      if (skill.metadata.tags && skill.metadata.tags.length > 0) {
        lines.push(`**Tags:** ${skill.metadata.tags.join(', ')}`);
      }

      lines.push('');
      lines.push(`**Description:** ${skill.metadata.description}`);
      lines.push('');
      lines.push('## Body');
      lines.push('');
      lines.push(skill.body);

      if (skill.companions.length > 0) {
        lines.push('');
        lines.push('## Companions');

        for (const companion of skill.companions) {
          lines.push('');
          lines.push(`### ${companion.name}`);
          lines.push('');
          lines.push(companion.content);
        }
      }

      return {
        success: true,
        output: lines.join('\n'),
      };
    },
  };

  const skill_create: Tool = {
    definition: {
      name: 'skill_create',
      description:
        'Create a new user-defined skill. Name must be lowercase with hyphens (kebab-case).',
      parameters: [
        {
          name: 'name',
          type: 'string',
          description: 'Skill name in kebab-case (lowercase with hyphens)',
          required: true,
        },
        {
          name: 'description',
          type: 'string',
          description: 'Short description of what the skill does',
          required: true,
        },
        {
          name: 'body',
          type: 'string',
          description: 'The main content/instructions of the skill',
          required: true,
        },
        {
          name: 'tags',
          type: 'string',
          description: 'Comma-separated list of tags for the skill',
          required: false,
        },
      ],
    },
    handler: async (params) => {
      try {
        const name = params['name'] as string;
        const description = params['description'] as string;
        const body = params['body'] as string;
        const tagsStr = params['tags'] as string | undefined;

        const tags = tagsStr
          ? tagsStr.split(',').map((t) => t.trim()).filter(Boolean)
          : [];

        await registry.createUserSkill(name, description, body, tags);

        return {
          success: true,
          output: `created skill: ${name}`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        return {
          success: false,
          output: '',
          error: message,
        };
      }
    },
  };

  const skill_update: Tool = {
    definition: {
      name: 'skill_update',
      description: 'Update an existing user-defined skill. Cannot update builtin skills.',
      parameters: [
        {
          name: 'name',
          type: 'string',
          description: 'Name of the skill to update',
          required: true,
        },
        {
          name: 'description',
          type: 'string',
          description: 'New description for the skill',
          required: true,
        },
        {
          name: 'body',
          type: 'string',
          description: 'New content/instructions for the skill',
          required: true,
        },
        {
          name: 'tags',
          type: 'string',
          description: 'Comma-separated list of tags for the skill',
          required: false,
        },
      ],
    },
    handler: async (params) => {
      try {
        const name = params['name'] as string;
        const description = params['description'] as string;
        const body = params['body'] as string;
        const tagsStr = params['tags'] as string | undefined;

        const tags = tagsStr
          ? tagsStr.split(',').map((t) => t.trim()).filter(Boolean)
          : [];

        await registry.updateUserSkill(name, description, body, tags);

        return {
          success: true,
          output: `updated skill: ${name}`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        return {
          success: false,
          output: '',
          error: message,
        };
      }
    },
  };

  return [skill_list, skill_read, skill_create, skill_update];
}
