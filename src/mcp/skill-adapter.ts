// pattern: Functional Core

import { createHash } from 'node:crypto';
import type { SkillDefinition } from '@/skill/types.ts';
import type { McpClient, McpPromptInfo } from './types.ts';

function toKebabCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function mcpPromptToSkill(serverName: string, prompt: McpPromptInfo, body: string): SkillDefinition {
  const kebabName = toKebabCase(prompt.name);
  const contentHash = createHash('sha256').update(body).digest('hex').slice(0, 16);

  return {
    id: `skill:mcp:${serverName}:${prompt.name}`,
    metadata: {
      name: kebabName,
      description: prompt.description ?? `MCP prompt from ${serverName}`,
      version: undefined,
      tags: ['mcp', serverName],
      companions: undefined,
      tools: undefined,
    },
    body,
    companions: [],
    source: 'mcp',
    filePath: `mcp://${serverName}/${prompt.name}`,
    contentHash,
  };
}

export async function mcpPromptsToSkills(client: McpClient): Promise<Array<SkillDefinition>> {
  const prompts = await client.listPrompts();

  const skills = await Promise.all(
    prompts.map(async (prompt) => {
      const result = await client.getPrompt(prompt.name);
      const body = result.messages.map((m) => m.content).join('\n\n');
      return mcpPromptToSkill(client.serverName, prompt, body);
    }),
  );

  return skills;
}
