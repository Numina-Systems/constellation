// pattern: Functional Core

import type { ToolProvider } from '@/extensions/tool-provider.ts';
import type { ToolDefinition, ToolResult } from '@/tool/types.ts';
import type { McpClient } from './types.ts';
import { mapInputSchemaToParameters } from './schema-mapper.ts';

/**
 * Converts a server name and tool name into a namespaced tool name.
 * Hyphens in both server and tool names are converted to underscores.
 * Format: mcp_{serverName}_{toolName}
 */
export function namespaceTool(serverName: string, toolName: string): string {
  const normalizedServer = serverName.replace(/-/g, '_');
  const normalizedTool = toolName.replace(/-/g, '_');
  return `mcp_${normalizedServer}_${normalizedTool}`;
}

/**
 * Creates a ToolProvider that bridges MCP tools into Constellation's tool registry.
 *
 * The provider maintains an internal name map to support lossy namespacing
 * (hyphens converted to underscores). During discover(), the map is populated.
 * During execute(), the map is used to look up the original MCP tool name.
 */
export function createMcpToolProvider(client: McpClient): ToolProvider {
  // Map from namespaced tool names to original MCP tool names
  const nameMap = new Map<string, string>();

  return {
    name: `mcp:${client.serverName}`,

    async discover(): Promise<Array<ToolDefinition>> {
      const mcpTools = await client.listTools();

      // Clear and repopulate the name map
      nameMap.clear();

      const definitions: Array<ToolDefinition> = [];

      for (const tool of mcpTools) {
        const namespacedName = namespaceTool(client.serverName, tool.name);
        nameMap.set(namespacedName, tool.name);

        const definition: ToolDefinition = {
          name: namespacedName,
          description: `[MCP: ${client.serverName}] ${tool.description ?? ''}`,
          parameters: mapInputSchemaToParameters(tool.inputSchema),
        };

        definitions.push(definition);
      }

      return definitions;
    },

    async execute(
      tool: string,
      params: Record<string, unknown>,
    ): Promise<ToolResult> {
      const originalName = nameMap.get(tool);

      if (!originalName) {
        return {
          success: false,
          output: '',
          error: `unknown MCP tool: ${tool}`,
        };
      }

      return client.callTool(originalName, params);
    },
  };
}
