// pattern: Functional Core (types only)

import type { ToolDefinition, ToolResult } from '../tool/types.ts';

/**
 * ToolProvider represents an external source of tools that can be dynamically discovered and executed.
 * Examples: MCP servers, plugin systems, remote tool registries.
 *
 * Tools discovered via ToolProvider are registered with the ToolRegistry and become available
 * to the agent alongside built-in tools.
 */
export interface ToolProvider {
  readonly name: string;
  discover(): Promise<Array<ToolDefinition>>;
  execute(tool: string, params: Record<string, unknown>): Promise<ToolResult>;
}
