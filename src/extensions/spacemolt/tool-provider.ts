// pattern: Imperative Shell

import type { ToolDefinition, ToolResult } from '@/tool/types.ts';
import type { SpaceMoltToolProvider } from './types.ts';
import type { McpTool } from './schema.ts';
import { translateMcpTool, flattenMcpContent } from './schema.ts';
import type { MemoryStore } from '../../memory/store.ts';
import type { EmbeddingProvider } from '../../embedding/types.ts';
import { readCredentials, writeCredentials } from './credentials.ts';
import type { Credentials } from './credentials.ts';

export type SpaceMoltToolProviderOptions = {
  readonly mcpUrl: string;
  readonly registrationCode: string;
  readonly usernameHint?: string;
  readonly empireHint?: string;
  readonly store: MemoryStore;
  readonly embedding: EmbeddingProvider;
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

function isSessionExpired(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes('session_invalid');
  }
  if (typeof error === 'object' && error !== null) {
    const errorObj = error as Record<string, unknown>;
    return (
      String(errorObj['code']).includes('session_invalid') ||
      String(errorObj['message']).includes('session_invalid')
    );
  }
  return String(error).includes('session_invalid');
}

export function createSpaceMoltToolProvider(
  options: Readonly<SpaceMoltToolProviderOptions>,
  client?: McpClient
): SpaceMoltToolProvider {
  let toolCache: Array<ToolDefinition> = [];
  let mcpClient: McpClient | undefined = client;

  const EMPIRES = ['solarian', 'voidborn', 'crimson', 'nebula', 'outerrim'] as const;
  const NAME_PREFIXES = ['Spirit', 'Void', 'Nova', 'Nebula', 'Stellar', 'Cosmic', 'Astral', 'Phantom'];
  const NAME_SUFFIXES = ['Runner', 'Walker', 'Drift', 'Hawk', 'Blade', 'Spark', 'Wing', 'Shade'];

  function generateUsername(): string {
    const prefix = NAME_PREFIXES[Math.floor(Math.random() * NAME_PREFIXES.length)]!;
    const suffix = NAME_SUFFIXES[Math.floor(Math.random() * NAME_SUFFIXES.length)]!;
    const num = Math.floor(Math.random() * 100);
    return `${prefix}-${suffix}-${num}`;
  }

  function generateEmpire(): string {
    return EMPIRES[Math.floor(Math.random() * EMPIRES.length)]!;
  }

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

  async function reconnect(): Promise<void> {
    if (!mcpClient) {
      throw new Error('Cannot reconnect: MCP client not initialized');
    }

    await mcpClient.close();
    await mcpClient.connect(new URL(options.mcpUrl));

    // reconnect always uses login — credentials guaranteed to exist after first discover()
    const credentials = await readCredentials(options.store);
    if (!credentials) {
      throw new Error('Cannot reconnect: no credentials in memory');
    }

    await mcpClient.callTool({
      name: 'login',
      arguments: {
        username: credentials.username,
        password: credentials.password,
      },
    });
  }

  let subscribed = false;
  let discovered = false;

  async function discover(): Promise<Array<ToolDefinition>> {
    if (discovered) {
      return toolCache;
    }

    if (!mcpClient) {
      throw new Error('MCP client not initialized');
    }

    await mcpClient.connect(new URL(options.mcpUrl));

    // Check memory for existing credentials
    const existingCredentials = await readCredentials(options.store);

    if (existingCredentials) {
      // Login path
      await mcpClient.callTool({
        name: 'login',
        arguments: {
          username: existingCredentials.username,
          password: existingCredentials.password,
        },
      });
    } else {
      // Register path
      const empire = options.empireHint ?? generateEmpire();
      const baseUsername = options.usernameHint ?? generateUsername();
      let username = baseUsername;
      let registered = false;
      const maxRetries = 3;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const result = await mcpClient.callTool({
          name: 'register',
          arguments: {
            username,
            empire,
            registration_code: options.registrationCode,
          },
        });

        const responseText = flattenMcpContent(result.content);

        if (result.isError && responseText.includes('username_taken')) {
          // Retry with suffix on the same base name
          username = `${baseUsername}-${Math.floor(Math.random() * 1000)}`;
          continue;
        }

        if (result.isError) {
          throw new Error(`SpaceMolt registration failed: ${responseText}`);
        }

        // Parse registration response
        const parsed: unknown = JSON.parse(responseText);
        if (
          typeof parsed !== 'object' || parsed === null ||
          !('player_id' in parsed) || !('password' in parsed)
        ) {
          throw new Error(`SpaceMolt registration returned unexpected response: ${responseText}`);
        }

        const response = parsed as Record<string, unknown>;
        const credentials: Credentials = {
          username,
          password: String(response['password']),
          player_id: String(response['player_id']),
          empire,
        };

        await writeCredentials(options.store, options.embedding, credentials);
        registered = true;
        break;
      }

      if (!registered) {
        throw new Error(`SpaceMolt registration failed: username taken after ${maxRetries} retries`);
      }
    }

    // Paginate through tool list and cache
    const allTools = await paginateTools();
    toolCache = allTools;
    discovered = true;

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
      // Check if error is session expiry
      if (isSessionExpired(err)) {
        try {
          // Reconnect and retry
          await reconnect();

          // Retry the tool call
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
        } catch (retryErr) {
          // Retry failed, return error
          const errorMessage =
            retryErr instanceof Error ? retryErr.message : 'Unknown error after reconnect';
          return {
            success: false,
            output: '',
            error: errorMessage,
          };
        }
      }

      // Not a session error, return as-is
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
