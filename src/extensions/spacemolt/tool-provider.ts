// pattern: Imperative Shell

import type { ToolDefinition, ToolResult } from '@/tool/types.ts';
import type { SpaceMoltToolProvider } from './types.ts';
import type { McpTool } from './schema.ts';
import { translateMcpTool, flattenMcpContent } from './schema.ts';

export type SpaceMoltToolProviderOptions = {
  readonly mcpUrl: string;
  readonly username: string;
  readonly password: string;
};

type McpClient = {
  connect(transport: unknown): Promise<void>;
  listTools(
    cursor?: string
  ): Promise<{
    tools: ReadonlyArray<McpTool>;
    nextCursor?: string;
  }>;
  callTool(
    request: Readonly<{ name: string; arguments: Record<string, unknown> }>
  ): Promise<{
    content: ReadonlyArray<{ type: string; text?: string }>;
    isError: boolean;
  }>;
  on(
    event: string,
    handler: (notification: {resourceType?: string; resourceName?: string}) => void
  ): void;
  close(): Promise<void>;
};

export function createSpaceMoltToolProvider(
  options: Readonly<SpaceMoltToolProviderOptions>,
  client?: McpClient
): SpaceMoltToolProvider {
  let toolCache: Array<ToolDefinition> = [];
  let mcpClient: McpClient | undefined = client;

  async function paginateTools(): Promise<Array<ToolDefinition>> {
    if (!mcpClient) {
      return [];
    }

    const allTools: Array<ToolDefinition> = [];
    let cursor: string | undefined;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const response = await mcpClient.listTools(cursor);

      for (const tool of response.tools) {
        const toolDef = translateMcpTool(tool, 'spacemolt:');
        allTools.push(toolDef);
      }

      if (!response.nextCursor) break;
      cursor = response.nextCursor;
    }

    return allTools;
  }

  let subscribed = false;
  let discovered = false;

  async function discover(): Promise<Array<ToolDefinition>> {
    // Return cached tools if already discovered
    if (discovered) {
      return toolCache;
    }

    // If client is not provided, we would create it with the real SDK
    // For now, this is test-only injectable
    if (!mcpClient) {
      // In production, this would create the real MCP client
      throw new Error('MCP client not initialized');
    }

    // Connect to MCP server
    await mcpClient.connect(new URL(options.mcpUrl));

    // Authenticate via login tool
    await mcpClient.callTool({
      name: 'login',
      arguments: {
        username: options.username,
        password: options.password,
      },
    });

    // Paginate through tool list and cache
    const allTools = await paginateTools();
    toolCache = allTools;
    discovered = true;

    // Subscribe to tool list changes (only on first discover call)
    if (!subscribed) {
      subscribed = true;
      mcpClient.on('notifications/tools/list_changed', async () => {
        await refreshTools();
      });
    }

    return toolCache;
  }

  async function execute(
    toolName: string,
    params: Record<string, unknown>
  ): Promise<ToolResult> {
    if (!mcpClient) {
      return {
        success: false,
        output: '',
        error: 'MCP client not initialized',
      };
    }

    // Strip the spacemolt: prefix
    const strippedName = toolName.startsWith('spacemolt:')
      ? toolName.slice('spacemolt:'.length)
      : toolName;

    try {
      const result = await mcpClient.callTool({
        name: strippedName,
        arguments: params,
      });

      const flattenedText = flattenMcpContent(result.content);

      return {
        success: !result.isError,
        output: flattenedText,
        ...(result.isError && { error: flattenedText }),
      };
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown error';
      return {
        success: false,
        output: '',
        error: errorMessage,
      };
    }
  }

  async function refreshTools(): Promise<void> {
    const allTools = await paginateTools();
    toolCache = allTools;
  }

  async function close(): Promise<void> {
    if (mcpClient) {
      await mcpClient.close();
    }
  }

  return {
    name: 'spacemolt',
    discover,
    execute,
    refreshTools,
    close,
  };
}
