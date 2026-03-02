// pattern: Functional Core

import { describe, it, expect } from 'bun:test';
import { parseSkillFile } from './parser.ts';

describe('parseSkillFile', () => {
  describe('skills.AC1.1: Parse complete SKILL.md with all frontmatter fields', () => {
    it('should parse a skill with all metadata fields and correct body', () => {
      const content = `---
name: example-skill
description: This is an example skill for testing purposes
version: 1.0.0
tags:
  - testing
  - examples
companions:
  - ./companion.md
  - ./other.md
tools:
  - name: test-tool
    description: A test tool
    parameters:
      - name: input
        type: string
        description: Input parameter
        required: true
---
# Body Content

This is the skill body content.

More details here.`;

      const result = parseSkillFile(content);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('Expected success');

      expect(result.metadata.name).toBe('example-skill');
      expect(result.metadata.description).toBe('This is an example skill for testing purposes');
      expect(result.metadata.version).toBe('1.0.0');
      expect(result.metadata.tags).toEqual(['testing', 'examples']);
      expect(result.metadata.companions).toEqual(['./companion.md', './other.md']);

      const tools = result.metadata.tools;
      if (!tools) throw new Error('tools should be defined');
      expect(tools).toHaveLength(1);

      const tool = tools[0]!;
      expect(tool.name).toBe('test-tool');
      expect(tool.description).toBe('A test tool');
      expect(tool.parameters).toHaveLength(1);
      expect(tool.parameters[0]!.name).toBe('input');
      expect(tool.parameters[0]!.type).toBe('string');
      expect(tool.parameters[0]!.required).toBe(true);

      expect(result.body).toContain('# Body Content');
      expect(result.body).toContain('This is the skill body content');
      expect(result.body).toContain('More details here');
    });
  });

  describe('skills.AC1.2: Parse SKILL.md with only required fields', () => {
    it('should parse a skill with only name and description, optional fields undefined', () => {
      const content = `---
name: minimal-skill
description: A minimal skill
---
Body content here`;

      const result = parseSkillFile(content);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('Expected success');

      expect(result.metadata.name).toBe('minimal-skill');
      expect(result.metadata.description).toBe('A minimal skill');
      expect(result.metadata.version).toBeUndefined();
      expect(result.metadata.tags).toBeUndefined();
      expect(result.metadata.companions).toBeUndefined();
      expect(result.metadata.tools).toBeUndefined();
      expect(result.body).toBe('Body content here');
    });
  });

  describe('skills.AC1.3: Missing required name field', () => {
    it('should return error mentioning name when name is missing', () => {
      const content = `---
description: A skill without name
---
Body`;

      const result = parseSkillFile(content);

      expect(result.success).toBe(false);
      if (result.success) throw new Error('Expected failure');
      expect(result.error.toLowerCase()).toContain('name');
    });
  });

  describe('skills.AC1.4: Missing required description field', () => {
    it('should return error mentioning description when description is missing', () => {
      const content = `---
name: skill-without-desc
---
Body`;

      const result = parseSkillFile(content);

      expect(result.success).toBe(false);
      if (result.success) throw new Error('Expected failure');
      expect(result.error.toLowerCase()).toContain('description');
    });
  });

  describe('skills.AC1.5: Invalid name format (not kebab-case)', () => {
    it('should return validation error for uppercase in name', () => {
      const content = `---
name: Invalid Name
description: A skill
---
Body`;

      const result = parseSkillFile(content);

      expect(result.success).toBe(false);
      if (result.success) throw new Error('Expected failure');
      expect(result.error.toLowerCase()).toContain('kebab-case');
    });

    it('should return validation error for spaces in name', () => {
      const content = `---
name: skill with spaces
description: A skill
---
Body`;

      const result = parseSkillFile(content);

      expect(result.success).toBe(false);
      if (result.success) throw new Error('Expected failure');
      expect(result.error.toLowerCase()).toContain('kebab-case');
    });
  });

  describe('skills.AC1.6: Description exceeding 500 characters', () => {
    it('should return validation error when description exceeds 500 chars', () => {
      const longDesc = 'a'.repeat(501);
      const content = `---
name: skill-test
description: ${longDesc}
---
Body`;

      const result = parseSkillFile(content);

      expect(result.success).toBe(false);
      if (result.success) throw new Error('Expected failure');
      expect(result.error.toLowerCase()).toContain('500');
    });

    it('should succeed when description is exactly 500 chars', () => {
      const desc = 'a'.repeat(500);
      const content = `---
name: skill-test
description: ${desc}
---
Body`;

      const result = parseSkillFile(content);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('Expected success');
      expect(result.metadata.description).toHaveLength(500);
    });
  });

  describe('skills.AC1.7: Malformed YAML syntax', () => {
    it('should return error mentioning invalid YAML for invalid syntax', () => {
      const content = `---
name: skill-test
description: A skill
tags: [invalid, list syntax without closing bracket
---
Body`;

      const result = parseSkillFile(content);

      expect(result.success).toBe(false);
      if (result.success) throw new Error('Expected failure');
      expect(result.error.toLowerCase()).toContain('yaml');
    });
  });

  describe('skills.AC1.8: Missing frontmatter delimiters', () => {
    it('should return error mentioning frontmatter delimiters when opening delimiter missing', () => {
      const content = `name: skill-test
description: A skill
---
Body`;

      const result = parseSkillFile(content);

      expect(result.success).toBe(false);
      if (result.success) throw new Error('Expected failure');
      expect(result.error.toLowerCase()).toContain('frontmatter');
    });

    it('should return error mentioning frontmatter delimiters when closing delimiter missing', () => {
      const content = `---
name: skill-test
description: A skill
Body`;

      const result = parseSkillFile(content);

      expect(result.success).toBe(false);
      if (result.success) throw new Error('Expected failure');
      expect(result.error.toLowerCase()).toContain('frontmatter');
    });

    it('should return error mentioning frontmatter delimiters when no delimiters present', () => {
      const content = `name: skill-test
description: A skill
Body`;

      const result = parseSkillFile(content);

      expect(result.success).toBe(false);
      if (result.success) throw new Error('Expected failure');
      expect(result.error.toLowerCase()).toContain('frontmatter');
    });
  });

  describe('skills.AC1.9: Tools array with valid ToolParameter structure', () => {
    it('should parse tools with name, description, and parameters array', () => {
      const content = `---
name: tool-skill
description: A skill with tools
tools:
  - name: my-tool
    description: Does something useful
    parameters:
      - name: param1
        type: string
        description: First parameter
        required: true
      - name: param2
        type: number
        description: Second parameter
        required: false
      - name: param3
        type: boolean
        description: Third parameter
        required: true
---
Body`;

      const result = parseSkillFile(content);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('Expected success');

      const allTools = result.metadata.tools;
      if (!allTools) throw new Error('tools should be defined');
      expect(allTools).toHaveLength(1);

      const myTool = allTools[0]!;
      expect(myTool.name).toBe('my-tool');
      expect(myTool.description).toBe('Does something useful');
      expect(myTool.parameters).toHaveLength(3);

      expect(myTool.parameters[0]!).toEqual({
        name: 'param1',
        type: 'string',
        description: 'First parameter',
        required: true,
      });

      expect(myTool.parameters[1]!).toEqual({
        name: 'param2',
        type: 'number',
        description: 'Second parameter',
        required: false,
      });

      expect(myTool.parameters[2]!).toEqual({
        name: 'param3',
        type: 'boolean',
        description: 'Third parameter',
        required: true,
      });
    });

    it('should support all ToolParameterType values', () => {
      const content = `---
name: all-types-skill
description: Tests all parameter types
tools:
  - name: multi-type-tool
    description: Tool with all types
    parameters:
      - name: str
        type: string
        description: String param
        required: true
      - name: num
        type: number
        description: Number param
        required: true
      - name: bool
        type: boolean
        description: Boolean param
        required: true
      - name: obj
        type: object
        description: Object param
        required: false
      - name: arr
        type: array
        description: Array param
        required: false
---
Body`;

      const result = parseSkillFile(content);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('Expected success');

      const typeTools = result.metadata.tools;
      if (!typeTools) throw new Error('tools should be defined');
      const typeParams = typeTools[0]!.parameters;
      expect(typeParams.map((p) => p!.type)).toEqual(['string', 'number', 'boolean', 'object', 'array']);
    });

    it('should support optional enum_values field on parameters', () => {
      const content = `---
name: enum-skill
description: Tests enum parameters
tools:
  - name: enum-tool
    description: Tool with enum
    parameters:
      - name: choice
        type: string
        description: A choice
        required: true
        enum_values:
          - option1
          - option2
          - option3
---
Body`;

      const result = parseSkillFile(content);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('Expected success');

      const enumTools = result.metadata.tools;
      if (!enumTools) throw new Error('tools should be defined');
      const enumParam = enumTools[0]!.parameters[0]!;
      expect(enumParam.enum_values).toEqual(['option1', 'option2', 'option3']);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty body after frontmatter', () => {
      const content = `---
name: empty-body-skill
description: A skill with empty body
---
`;

      const result = parseSkillFile(content);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('Expected success');
      expect(result.body).toBe('');
    });

    it('should strip leading/trailing whitespace from body', () => {
      const content = `---
name: whitespace-skill
description: A skill
---



Body content

  `;

      const result = parseSkillFile(content);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('Expected success');
      expect(result.body).toBe('Body content');
    });

    it('should ignore unknown fields in frontmatter', () => {
      const content = `---
name: unknown-fields-skill
description: A skill
unknown_field: some value
another_unknown: 123
---
Body`;

      const result = parseSkillFile(content);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('Expected success');
      expect(result.metadata.name).toBe('unknown-fields-skill');
    });

    it('should handle body containing --- (not at start)', () => {
      const content = `---
name: dashes-in-body-skill
description: A skill
---
# Section 1

---

# Section 2

This has --- in it.`;

      const result = parseSkillFile(content);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('Expected success');
      expect(result.body).toContain('# Section 1');
      expect(result.body).toContain('# Section 2');
      expect(result.body).toContain('---');
    });

    it('should handle kebab-case with numbers and hyphens', () => {
      const content = `---
name: skill-123-test-abc-456
description: A skill with numbers and hyphens
---
Body`;

      const result = parseSkillFile(content);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('Expected success');
      expect(result.metadata.name).toBe('skill-123-test-abc-456');
    });

    it('should reject names starting with hyphen', () => {
      const content = `---
name: -invalid-skill
description: A skill
---
Body`;

      const result = parseSkillFile(content);

      expect(result.success).toBe(false);
      if (result.success) throw new Error('Expected failure');
    });

    it('should reject names ending with hyphen', () => {
      const content = `---
name: invalid-skill-
description: A skill
---
Body`;

      const result = parseSkillFile(content);

      expect(result.success).toBe(false);
      if (result.success) throw new Error('Expected failure');
    });
  });

  describe('agent-scheduling.AC7.1: Scheduling skill loads via parser', () => {
    it('should parse skills/scheduling/SKILL.md successfully', async () => {
      const fs = require('fs');
      const path = require('path');

      const skillPath = path.join(process.cwd(), 'skills', 'scheduling', 'SKILL.md');
      const content = fs.readFileSync(skillPath, 'utf-8');

      const result = parseSkillFile(content);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('Expected success');

      expect(result.metadata.name).toBe('scheduling');
      expect(result.metadata.description).toBeDefined();
      expect(result.metadata.description).not.toBe('');
      expect(result.metadata.tags).toBeDefined();

      const tags = result.metadata.tags;
      if (!tags) throw new Error('tags should be defined');
      expect(tags).toContain('scheduling');
      expect(tags).toContain('cron');
      expect(tags).toContain('automation');
      expect(tags).toContain('bluesky');

      expect(result.body).toBeDefined();
      expect(result.body).not.toBe('');
    });
  });
});
