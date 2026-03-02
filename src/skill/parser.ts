// pattern: Functional Core

import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import type { SkillMetadata, ParseResult } from './types.ts';

// Zod's z.enum requires a mutable tuple type; cast is unavoidable here
const TOOL_PARAMETER_TYPES = ['string', 'number', 'boolean', 'object', 'array'] as const;

const SkillToolParameterSchema = z.object({
  name: z.string(),
  type: z.enum(TOOL_PARAMETER_TYPES),
  description: z.string(),
  required: z.boolean(),
  enum_values: z.array(z.string()).optional(),
});

const SkillToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.array(SkillToolParameterSchema),
});

const SkillMetadataSchema = z.object({
  name: z.string().regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 'name must be kebab-case (lowercase letters, numbers, hyphens)'),
  description: z.string().max(500, 'description must be 500 characters or fewer'),
  version: z.string().optional(),
  tags: z.array(z.string()).optional(),
  companions: z.array(z.string()).optional(),
  tools: z.array(SkillToolDefinitionSchema).optional(),
}) as z.ZodType<SkillMetadata>;

function extractFrontmatter(content: string): { yaml: string; body: string } | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match || match[1] === undefined || match[2] === undefined) return null;
  return { yaml: match[1], body: match[2] };
}

export function parseSkillFile(content: string): ParseResult {
  const extracted = extractFrontmatter(content);
  if (!extracted) {
    return { success: false, error: 'missing or malformed frontmatter delimiters' };
  }

  let raw: unknown;
  try {
    raw = parseYaml(extracted.yaml);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `invalid YAML: ${message}` };
  }

  const parseResult = SkillMetadataSchema.safeParse(raw);
  if (!parseResult.success) {
    const issues = parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { success: false, error: `validation failed: ${issues}` };
  }

  return {
    success: true,
    metadata: parseResult.data,
    body: extracted.body.trim(),
  };
}
