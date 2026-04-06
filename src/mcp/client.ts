// pattern: Imperative Shell

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import type { McpClient, McpPromptInfo, McpPromptResult, McpToolInfo } from './types.ts';
import type { McpServerConfig } from './schema.ts';
import type { ToolResult } from '@/tool/types.ts';

/**
 * Transport options for connecting to an MCP server.
 * Discriminated union supporting both stdio and HTTP transports.
 */
type TransportOptions =
  | {
      readonly type: 'stdio';
      readonly command: string;
      readonly args: ReadonlyArray<string>;
      readonly env: Record<string, string | undefined>;
    }
  | {
      readonly type: 'http';
      readonly url: URL;
    };

/**
 * Builds transport options from server configuration.
 * Pure function for testability.
 * Merges process.env with config env for stdio servers (SDK bug workaround).
 */
export function buildTransportOptions(
  config: McpServerConfig,
  processEnv: Readonly<Record<string, string | undefined>>,
): TransportOptions {
  if (config.transport === 'stdio') {
    return {
      type: 'stdio',
      command: config.command,
      args: [...config.args],
      env: { ...processEnv, ...config.env },
    };
  }

  if (config.transport === 'http') {
    return {
      type: 'http',
      url: new URL(config.url),
    };
  }

  const _exhaustive: never = config;
  return _exhaustive;
}

/**
 * Maps MCP ContentBlock[] to ToolResult.
 * Pure function for testability.
 */
export function mapToolResult(
  content: ReadonlyArray<{ readonly type: string; readonly text?: string }>,
  isError: boolean | undefined,
): ToolResult {
  const text = content
    .filter((b): b is { readonly type: 'text'; readonly text: string } => b.type === 'text' && b.text !== undefined)
    .map((b) => b.text)
    .join('\n');

  if (isError) {
    return {
      success: false,
      output: text,
      error: text,
    };
  }

  return {
    success: true,
    output: text,
  };
}

/**
 * Creates an MCP client for a given server configuration.
 * Manages connection lifecycle, tool discovery, and tool execution.
 */
export function createMcpClient(serverName: string, config: McpServerConfig): McpClient {
  let sdkClient: Client | null = null;
  let connected = false;

  return {
    serverName,

    async connect(): Promise<void> {
      sdkClient = new Client({
        name: 'constellation',
        version: '1.0.0',
      });

      const opts = buildTransportOptions(config, process.env);
      const transport =
        opts.type === 'stdio'
          ? new StdioClientTransport({
              command: opts.command,
              args: [...opts.args], // SDK expects mutable array
              env: Object.fromEntries(
                Object.entries(opts.env)
                  .filter(([, v]) => v !== undefined)
                  .map(([k, v]) => [k, v as string]), // Safe: undefined values filtered on previous line
              ),
            })
          : new StreamableHTTPClientTransport(opts.url);

      sdkClient.onerror = (error) => {
        console.error(`[mcp:${serverName}] error:`, error);
      };

      sdkClient.onclose = () => {
        connected = false;
        console.log(`[mcp:${serverName}] connection closed`);
      };

      await sdkClient.connect(transport);
      connected = true;
      console.log(`[mcp:${serverName}] connected`);
    },

    async disconnect(): Promise<void> {
      if (sdkClient !== null && connected) {
        await sdkClient.close();
        connected = false;
        console.log(`[mcp:${serverName}] disconnected`);
      }
    },

    async listTools(): Promise<Array<McpToolInfo>> {
      if (!connected) {
        return [];
      }

      const tools: Array<McpToolInfo> = [];
      let cursor: string | undefined;

      do {
        const result = await sdkClient!.listTools(cursor ? { cursor } : undefined);
        for (const tool of result.tools) {
          tools.push({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema as Record<string, unknown>,
          });
        }
        cursor = result.nextCursor;
      } while (cursor);

      return tools;
    },

    async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
      if (!connected) {
        return {
          success: false,
          output: '',
          error: `[mcp:${serverName}] not connected`,
        };
      }

      try {
        const result = await sdkClient!.callTool({ name, arguments: args });
        const content = Array.isArray(result.content)
          ? result.content
          : [];
        const isError = typeof result.isError === 'boolean' ? result.isError : false;
        return mapToolResult(
          content as ReadonlyArray<{ readonly type: string; readonly text?: string }>, // SDK ContentBlock type is wider than our mapping needs
          isError,
        );
      } catch (error) {
        return {
          success: false,
          output: '',
          error: String(error),
        };
      }
    },

    async listPrompts(): Promise<Array<McpPromptInfo>> {
      if (!connected) {
        return [];
      }

      const prompts: Array<McpPromptInfo> = [];
      let cursor: string | undefined;

      do {
        const result = await sdkClient!.listPrompts(cursor ? { cursor } : undefined);
        for (const prompt of result.prompts) {
          prompts.push({
            name: prompt.name,
            description: prompt.description,
            arguments: (prompt.arguments ?? []).map((a) => ({
              name: a.name,
              description: a.description,
              required: a.required,
            })),
          });
        }
        cursor = result.nextCursor;
      } while (cursor);

      return prompts;
    },

    async getPrompt(name: string, args?: Record<string, string>): Promise<McpPromptResult> {
      if (!connected) {
        return {
          description: undefined,
          messages: [],
        };
      }

      const result = await sdkClient!.getPrompt({ name, arguments: args });
      return {
        description: result.description,
        messages: result.messages.map((m) => ({
          role: m.role,
          content: m.content.type === 'text' ? m.content.text : JSON.stringify(m.content),
        })),
      };
    },

    async getInstructions(): Promise<string | undefined> {
      if (!connected) {
        return undefined;
      }

      return sdkClient!.getInstructions?.() ?? undefined;
    },
  };
}
