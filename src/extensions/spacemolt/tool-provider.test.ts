import { describe, it, expect, beforeEach } from 'bun:test';
import { createSpaceMoltToolProvider } from './tool-provider.ts';
import type { SpaceMoltToolProviderOptions } from './tool-provider.ts';

// Mock MCP Client type
type MockMcpClient = {
  connect: (transport: unknown) => Promise<void>;
  listTools: (cursor?: string) => Promise<{
    tools: ReadonlyArray<{
      name: string;
      description?: string;
      inputSchema: {
        type: 'object';
        properties?: Record<string, {type?: string; description?: string}>;
        required?: ReadonlyArray<string>;
      };
    }>;
    nextCursor?: string;
  }>;
  callTool: (
    request: Readonly<{ name: string; arguments: Record<string, unknown> }>
  ) => Promise<{
    content: ReadonlyArray<{ type: string; text?: string }>;
    isError: boolean;
  }>;
  on: (
    event: string,
    handler: (notification: {resourceType?: string; resourceName?: string}) => void
  ) => void;
  close: () => Promise<void>;
};

function createMockMcpClient(): MockMcpClient {
  const listeners: Record<string, Function[]> = {};

  return {
    connect: async () => {
      // no-op
    },
    listTools: async (cursor?: string) => {
      if (cursor) {
        return {
          tools: [
            {
              name: 'list_inventory',
              description: 'List inventory',
              inputSchema: {
                type: 'object',
                properties: {
                  limit: { type: 'number', description: 'Limit' },
                },
              },
            },
          ],
        };
      }

      return {
        tools: [
          {
            name: 'mine',
            description: 'Mine for resources',
            inputSchema: {
              type: 'object',
              properties: {
                location: { type: 'string', description: 'Mining location' },
                depth: { type: 'number', description: 'Depth' },
              },
              required: ['location'],
            },
          },
        ],
        nextCursor: 'page-2',
      };
    },
    callTool: async (request) => {
      if (request.name === 'login') {
        return {
          content: [{ type: 'text', text: 'Logged in' }],
          isError: false,
        };
      }
      if (request.name === 'mine') {
        return {
          content: [{ type: 'text', text: 'Mined 50 iron' }],
          isError: false,
        };
      }
      return {
        content: [{ type: 'text', text: 'Unknown tool' }],
        isError: true,
      };
    },
    on: (event, handler) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    },
    close: async () => {
      // no-op
    },
  };
}

describe('createSpaceMoltToolProvider', () => {
  let mockClient: MockMcpClient;
  const options: SpaceMoltToolProviderOptions = {
    mcpUrl: 'http://localhost:3000',
    username: 'test_user',
    password: 'test_pass',
  };

  beforeEach(() => {
    mockClient = createMockMcpClient();
  });

  it('AC2.1: discover() returns ToolDefinition[] with spacemolt: prefixed names', async () => {
    const provider = createSpaceMoltToolProvider(options, mockClient);

    const tools = await provider.discover();

    expect(tools.length).toBeGreaterThan(0);
    const mineTool = tools.find((t) => t.name === 'spacemolt:mine');
    expect(mineTool).toBeDefined();
    expect(mineTool?.description).toBe('Mine for resources');
  });

  it('handles pagination in listTools', async () => {
    const provider = createSpaceMoltToolProvider(options, mockClient);

    const tools = await provider.discover();

    const hasMine = tools.some((t) => t.name === 'spacemolt:mine');
    const hasListInventory = tools.some(
      (t) => t.name === 'spacemolt:list_inventory'
    );

    expect(hasMine).toBe(true);
    expect(hasListInventory).toBe(true);
  });

  it('AC2.4: execute() strips spacemolt: prefix and calls MCP tool', async () => {
    let mineCalled = false;

    const callToolMock = async (
      request: Readonly<{ name: string; arguments: Record<string, unknown> }>
    ) => {
      if (request.name === 'mine') {
        mineCalled = true;
      }
      if (request.name === 'login') {
        return {
          content: [{ type: 'text', text: 'Logged in' }],
          isError: false,
        };
      }
      return {
        content: [{ type: 'text', text: 'Mined 50 iron' }],
        isError: false,
      };
    };

    mockClient.callTool = callToolMock;

    const provider = createSpaceMoltToolProvider(options, mockClient);
    await provider.discover();

    const result = await provider.execute('spacemolt:mine', {
      location: 'asteroid_field',
    });

    expect(mineCalled).toBe(true);
    expect(result.success).toBe(true);
  });

  it('AC2.5: MCP text content blocks are flattened into ToolResult.output', async () => {
    const provider = createSpaceMoltToolProvider(options, mockClient);
    await provider.discover();

    const result = await provider.execute('spacemolt:mine', {
      location: 'asteroid_field',
    });

    expect(result.output).toBe('Mined 50 iron');
  });

  it('AC2.5: MCP errors are captured in ToolResult.error', async () => {
    mockClient.callTool = async () => ({
      content: [{ type: 'text', text: 'Tool not found' }],
      isError: true,
    });

    const provider = createSpaceMoltToolProvider(options, mockClient);
    await provider.discover();

    const result = await provider.execute('spacemolt:unknown', {});

    expect(result.success).toBe(false);
    expect(result.error).toBe('Tool not found');
  });

  it('AC2.6: refreshTools() re-runs listTools and updates cache', async () => {
    const provider = createSpaceMoltToolProvider(options, mockClient);

    await provider.discover();

    // Simulate tool list change
    mockClient.listTools = async () => ({
      tools: [
        {
          name: 'new_tool',
          description: 'A new tool',
          inputSchema: { type: 'object' },
        },
      ],
    });

    await provider.refreshTools();

    const tools = await provider.discover();
    const newTool = tools.find((t) => t.name === 'spacemolt:new_tool');

    expect(newTool).toBeDefined();
  });

  it('close() is available for cleanup', async () => {
    const provider = createSpaceMoltToolProvider(options, mockClient);

    await provider.discover();
    await provider.close();

    // Should not throw
    expect(true).toBe(true);
  });

  it('discover() calls login tool with credentials', async () => {
    let loginCalled = false;
    let loginCreds: Record<string, unknown> | undefined;

    mockClient.callTool = async (request) => {
      if (request.name === 'login') {
        loginCalled = true;
        loginCreds = request.arguments;
      }
      return {
        content: [{ type: 'text', text: 'Logged in' }],
        isError: false,
      };
    };

    const provider = createSpaceMoltToolProvider(options, mockClient);
    await provider.discover();

    expect(loginCalled).toBe(true);
    expect(loginCreds?.['username']).toBe('test_user');
    expect(loginCreds?.['password']).toBe('test_pass');
  });

  it('caches tools after first discovery', async () => {
    const provider = createSpaceMoltToolProvider(options, mockClient);

    const firstCall = await provider.discover();
    const secondCall = await provider.discover();

    expect(firstCall).toEqual(secondCall);
  });

  it('handles multiple content blocks in MCP response', async () => {
    mockClient.callTool = async () => ({
      content: [
        { type: 'text', text: 'Block 1' },
        { type: 'text', text: 'Block 2' },
      ],
      isError: false,
    });

    const provider = createSpaceMoltToolProvider(options, mockClient);
    await provider.discover();

    const result = await provider.execute('spacemolt:mine', {});

    expect(result.output).toBe('Block 1\nBlock 2');
  });

  it('provides discover() method matching ToolProvider interface', async () => {
    const provider = createSpaceMoltToolProvider(options, mockClient);

    const tools = await provider.discover();

    expect(Array.isArray(tools)).toBe(true);
    if (tools.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const tool = tools[0]!;
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(Array.isArray(tool.parameters)).toBe(true);
    }
  });

  it('provides execute() method matching ToolProvider interface', async () => {
    const provider = createSpaceMoltToolProvider(options, mockClient);
    await provider.discover();

    const result = await provider.execute('spacemolt:mine', {
      location: 'test',
    });

    expect(result.success).toBeDefined();
    expect(result.output).toBeDefined();
  });
});
