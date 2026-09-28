// pattern: Functional Core

import type { ToolProvider } from '@/extensions/tool-provider.ts';
import type { ToolDefinition, ToolResult } from '@/tool/types.ts';
import { validateExecutableTool, validationMessage } from '@/custom-tool/validation.ts';
import { mapValidatedInputSchemaToParameters } from './schema-mapper.ts';
import {
  McpDiscoveryError,
  type McpClient,
  type McpDiscoveryOptions,
  type McpToolDefinition,
  type McpToolRegistration,
} from './types.ts';

export function namespaceTool(serverName: string, toolName: string): string {
  return `mcp_${serverName.replace(/-/g, '_')}_${toolName.replace(/-/g, '_')}`;
}

/** Creates an immutable, generation-tagged provider snapshot. */
export function createMcpToolProvider(client: McpClient): ToolProvider & Readonly<{
  readonly discoverRegistrations: (options?: McpDiscoveryOptions) => Promise<ReadonlyArray<McpToolRegistration>>;
  readonly generation: () => number;
}> {
  let currentGeneration = 0;
  let currentSnapshot: ReadonlyMap<string, McpToolRegistration> = new Map();
  let discoveryInFlight = 0;

  async function discoverRegistrations(options?: McpDiscoveryOptions): Promise<ReadonlyArray<McpToolRegistration>> {
    const attempt = ++discoveryInFlight;
    const nextGeneration = currentGeneration + 1;
    const mcpTools = await client.listTools(options);
    const next = new Map<string, McpToolRegistration>();
    const seen = new Map<string, string>();
    for (const tool of mcpTools) {
      const namespacedName = namespaceTool(client.serverName, tool.name);
      const existing = seen.get(namespacedName);
      if (existing !== undefined) {
        if (existing === tool.name) {
          throw new McpDiscoveryError('mcp_discovery_duplicate_tool', `MCP server returned duplicate tool name: ${tool.name}`, {server: client.serverName, tool: tool.name});
        }
        throw new McpDiscoveryError('mcp_discovery_name_collision', `normalized MCP tool names collide: ${existing} and ${tool.name}`, {server: client.serverName, name: namespacedName});
      }
      seen.set(namespacedName, tool.name);
      const mapped = mapValidatedInputSchemaToParameters(tool.inputSchema, tool.name);
      const definition: McpToolDefinition = Object.freeze({
        name: namespacedName,
        description: `[MCP: ${client.serverName}] ${tool.description ?? ''}`,
        parameters: Object.freeze([...mapped.parameters]),
        inputSchema: mapped.schema,
        generation: nextGeneration,
        originalName: tool.name,
      });
      const registration: McpToolRegistration = Object.freeze({
        definition,
        handler: async (params, executionOptions) => {
          if (currentGeneration !== nextGeneration || currentSnapshot.get(namespacedName)?.definition.originalName !== tool.name) {
            return {success: false, output: '', error: `stale MCP tool handle: ${namespacedName}`};
          }
          return client.callTool(tool.name, params, executionOptions);
        },
      });
      const validation = validateExecutableTool({definition, handler: registration.handler});
      if (!validation.valid) throw new McpDiscoveryError('mcp_discovery_invalid_schema', `invalid discovered MCP tool ${tool.name}: ${validationMessage(validation)}`, {server: client.serverName, tool: tool.name});
      next.set(namespacedName, registration);
    }
    if (attempt !== discoveryInFlight) throw new McpDiscoveryError('mcp_discovery_stale_attempt', `stale MCP discovery attempt for ${client.serverName}`, {server: client.serverName});
    currentGeneration = nextGeneration;
    currentSnapshot = next;
    return Object.freeze([...next.values()]);
  }

  return {
    name: `mcp:${client.serverName}`,
    discover: async (options?: McpDiscoveryOptions): Promise<Array<ToolDefinition>> => {
      const registrations = await discoverRegistrations(options);
      return registrations.map((registration) => registration.definition);
    },
    discoverRegistrations,
    generation: () => currentGeneration,
    execute: async (tool: string, params: Record<string, unknown>): Promise<ToolResult> => {
      const registration = currentSnapshot.get(tool);
      if (!registration) return {success: false, output: '', error: `unknown MCP tool: ${tool}`};
      return registration.handler(params);
    },
  };
}
