import { describe, it, expect, beforeEach } from 'bun:test';
import { createSpaceMoltToolProvider } from './tool-provider.ts';
import type { SpaceMoltToolProviderOptions } from './tool-provider.ts';
import type { MemoryStore } from '../../memory/store.ts';
import type { EmbeddingProvider } from '../../embedding/types.ts';
import type { MemoryBlock } from '../../memory/types.ts';

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

function createMockMemoryStore(): MemoryStore {
  return {
    getBlock: async () => null,
    getBlocksByTier: async () => [],
    getBlockByLabel: async () => null,
    createBlock: async (block) => {
      const fullBlock: MemoryBlock = {
        ...block,
        created_at: new Date(),
        updated_at: new Date(),
      };
      return fullBlock;
    },
    updateBlock: async () => ({ id: "", owner: "", tier: "core" as const, label: "", content: "", embedding: null, permission: "readonly" as const, pinned: false, created_at: new Date(), updated_at: new Date() }),
    deleteBlock: async () => {},
    searchByEmbedding: async () => [],
    logEvent: async () => ({ id: "", block_id: "", event_type: "create" as const, old_content: null, new_content: null, created_at: new Date() }),
    getEvents: async () => [],
    createMutation: async () => ({ id: "", block_id: "", proposed_content: "", reason: null, status: "pending" as const, feedback: null, created_at: new Date(), resolved_at: null }),
    getPendingMutations: async () => [],
    resolveMutation: async () => ({ id: "", block_id: "", proposed_content: "", reason: null, status: "approved" as const, feedback: null, created_at: new Date(), resolved_at: new Date() }),
  };
}

function createMockEmbeddingProvider(): EmbeddingProvider {
  return {
    embed: async (text: string) => {
      return new Array(1536).fill(0).map((_, i) => (text.length * (i + 1)) / 1000);
    },
    embedBatch: async (texts: ReadonlyArray<string>) => {
      return texts.map((text) =>
        new Array(1536).fill(0).map((_, i) => (text.length * (i + 1)) / 1000)
      );
    },
    dimensions: 1536,
  };
}

function makeOptions(overrides?: Partial<SpaceMoltToolProviderOptions>): SpaceMoltToolProviderOptions {
  return {
    mcpUrl: 'http://localhost:3000',
    registrationCode: 'test-reg-code',
    store: createMockMemoryStore(),
    embedding: createMockEmbeddingProvider(),
    ...overrides,
  };
}

function createMockMcpClient() {
  const listeners: Record<string, Function[]> = {};

  const client: MockMcpClient & { listeners: Record<string, Function[]> } = {
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
      if (request.name === 'register') {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              player_id: 'player-123',
              password: 'a'.repeat(64),
            }),
          }],
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
    listeners,
  };

  return client;
}

describe('createSpaceMoltToolProvider', () => {
  let mockClient: MockMcpClient;

  beforeEach(() => {
    mockClient = createMockMcpClient();
  });

  it('AC3.1: discover() with no credentials in memory calls register tool and persists credentials', async () => {
    const store = createMockMemoryStore();
    const options = makeOptions({ store });
    let registerCalled = false;
    let registerArgs: Record<string, unknown> | undefined;
    const createBlockCalls: Array<unknown> = [];
    const originalCreateBlock = store.createBlock;

    store.createBlock = async (block) => {
      createBlockCalls.push(block);
      return originalCreateBlock(block);
    };

    mockClient.callTool = async (request) => {
      if (request.name === 'register') {
        registerCalled = true;
        registerArgs = request.arguments;
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              player_id: 'player-123',
              password: 'generated-pass',
            }),
          }],
          isError: false,
        };
      }
      if (request.name === 'login') {
        return {
          content: [{ type: 'text', text: 'Logged in' }],
          isError: false,
        };
      }
      return {
        content: [{ type: 'text', text: 'Unknown tool' }],
        isError: true,
      };
    };

    const provider = createSpaceMoltToolProvider(options, mockClient);
    const tools = await provider.discover();

    expect(registerCalled).toBe(true);
    expect(registerArgs?.['registration_code']).toBe('test-reg-code');
    expect(tools.length).toBeGreaterThan(0);

    const credentialsBlock = createBlockCalls.find((call) => {
      const blockData = call as Record<string, unknown>;
      return blockData['label'] === 'spacemolt:credentials';
    }) as Record<string, unknown> | undefined;

    expect(credentialsBlock).toBeDefined();
    expect(credentialsBlock?.['label']).toBe('spacemolt:credentials');
    expect(credentialsBlock?.['tier']).toBe('core');
    expect(credentialsBlock?.['pinned']).toBe(true);
  });

  it('AC3.2: discover() with existing credentials in memory calls login tool', async () => {
    const store = createMockMemoryStore();
    const options = makeOptions({ store });
    let loginCalled = false;
    let loginCreds: Record<string, unknown> | undefined;
    let registerCalled = false;

    // Pre-populate store with credentials
    store.getBlockByLabel = async () => ({
      id: 'creds-1',
      owner: 'spirit',
      tier: 'core',
      label: 'spacemolt:credentials',
      content: JSON.stringify({
        username: 'existing-user',
        password: 'existing-pass',
        player_id: 'player-456',
        empire: 'solarian',
      }),
      embedding: null,
      permission: 'readwrite',
      pinned: true,
      created_at: new Date(),
      updated_at: new Date(),
    });

    mockClient.callTool = async (request) => {
      if (request.name === 'login') {
        loginCalled = true;
        loginCreds = request.arguments;
      }
      if (request.name === 'register') {
        registerCalled = true;
      }
      return {
        content: [{ type: 'text', text: 'Logged in' }],
        isError: false,
      };
    };

    const provider = createSpaceMoltToolProvider(options, mockClient);
    await provider.discover();

    expect(loginCalled).toBe(true);
    expect(registerCalled).toBe(false);
    expect(loginCreds?.['username']).toBe('existing-user');
    expect(loginCreds?.['password']).toBe('existing-pass');
  });

  it('AC3.3: discover() uses usernameHint when provided in options', async () => {
    const options = makeOptions({ usernameHint: 'CustomName' });
    let registerArgs: Record<string, unknown> | undefined;

    mockClient.callTool = async (request) => {
      if (request.name === 'register') {
        registerArgs = request.arguments;
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              player_id: 'player-123',
              password: 'pass',
            }),
          }],
          isError: false,
        };
      }
      return {
        content: [{ type: 'text', text: 'Logged in' }],
        isError: false,
      };
    };

    const provider = createSpaceMoltToolProvider(options, mockClient);
    await provider.discover();

    expect(registerArgs?.['username']).toBe('CustomName');
  });

  it('AC3.4: discover() retries with modified username on username_taken error', async () => {
    const options = makeOptions({ usernameHint: 'Base' });
    const registerCalls: Array<Record<string, unknown>> = [];

    mockClient.callTool = async (request) => {
      if (request.name === 'register') {
        registerCalls.push(request.arguments);
        // First call fails with username_taken
        if (registerCalls.length === 1) {
          return {
            content: [{ type: 'text', text: 'username_taken' }],
            isError: true,
          };
        }
        // Second call succeeds
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              player_id: 'player-123',
              password: 'pass',
            }),
          }],
          isError: false,
        };
      }
      return {
        content: [{ type: 'text', text: 'Logged in' }],
        isError: false,
      };
    };

    const provider = createSpaceMoltToolProvider(options, mockClient);
    await provider.discover();

    expect(registerCalls.length).toBeGreaterThanOrEqual(2);
    expect(registerCalls[0]?.['username']).toBe('Base');
    expect(String(registerCalls[1]?.['username']).startsWith('Base-')).toBe(true);
  });

  it('AC3.5: discover() throws after 3 registration retries fail with username_taken', async () => {
    const options = makeOptions({ usernameHint: 'Base' });

    mockClient.callTool = async (request) => {
      if (request.name === 'register') {
        return {
          content: [{ type: 'text', text: 'username_taken' }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: 'Logged in' }],
        isError: false,
      };
    };

    const provider = createSpaceMoltToolProvider(options, mockClient);

    await expect(provider.discover()).rejects.toThrow('username taken after 3 retries');
  });

  it('AC3.6: reconnect() always uses login path (not register)', async () => {
    const store = createMockMemoryStore();
    const options = makeOptions({ store });
    let registerCalled = false;
    let loginCalls = 0;

    // Pre-populate store with credentials
    store.getBlockByLabel = async () => ({
      id: 'creds-1',
      owner: 'spirit',
      tier: 'core',
      label: 'spacemolt:credentials',
      content: JSON.stringify({
        username: 'existing-user',
        password: 'existing-pass',
        player_id: 'player-456',
        empire: 'solarian',
      }),
      embedding: null,
      permission: 'readwrite',
      pinned: true,
      created_at: new Date(),
      updated_at: new Date(),
    });

    mockClient.callTool = async (request) => {
      if (request.name === 'login') {
        loginCalls++;
      }
      if (request.name === 'register') {
        registerCalled = true;
      }
      return {
        content: [{ type: 'text', text: 'OK' }],
        isError: false,
      };
    };

    const provider = createSpaceMoltToolProvider(options, mockClient);

    // First discover() to initialize
    await provider.discover();
    const loginCallsAfterDiscover = loginCalls;

    // Simulate session expiry error
    mockClient.callTool = async (request) => {
      if (request.name === 'mine') {
        throw new Error('session_invalid');
      }
      if (request.name === 'login') {
        loginCalls++;
      }
      return {
        content: [{ type: 'text', text: 'OK' }],
        isError: false,
      };
    };

    // Execute will trigger reconnect() on session expiry
    await provider.execute('spacemolt:mine', {});

    expect(registerCalled).toBe(false);
    expect(loginCalls).toBeGreaterThan(loginCallsAfterDiscover);
  });

  it('AC2.1: discover() returns ToolDefinition[] with spacemolt: prefixed names', async () => {
    const options = makeOptions();
    const provider = createSpaceMoltToolProvider(options, mockClient);

    const tools = await provider.discover();

    expect(tools.length).toBeGreaterThan(0);
    const mineTool = tools.find((t) => t.name === 'spacemolt:mine');
    expect(mineTool).toBeDefined();
    expect(mineTool?.description).toBe('Mine for resources');
  });

  it('handles pagination in listTools', async () => {
    const options = makeOptions();
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
    const options = makeOptions();
    let mineCalled = false;

    const callToolMock = async (
      request: Readonly<{ name: string; arguments: Record<string, unknown> }>
    ) => {
      if (request.name === 'mine') {
        mineCalled = true;
        return {
          content: [{ type: 'text', text: 'Mined 50 iron' }],
          isError: false,
        };
      }
      if (request.name === 'login') {
        return {
          content: [{ type: 'text', text: 'Logged in' }],
          isError: false,
        };
      }
      if (request.name === 'register') {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              player_id: 'player-123',
              password: 'a'.repeat(64),
            }),
          }],
          isError: false,
        };
      }
      return {
        content: [{ type: 'text', text: 'Unknown tool' }],
        isError: true,
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
    const options = makeOptions();
    const provider = createSpaceMoltToolProvider(options, mockClient);
    await provider.discover();

    const result = await provider.execute('spacemolt:mine', {
      location: 'asteroid_field',
    });

    expect(result.output).toBe('Mined 50 iron');
  });

  it('AC2.5: MCP errors are captured in ToolResult.error', async () => {
    const options = makeOptions();
    mockClient.callTool = async (request) => {
      if (request.name === 'login' || request.name === 'register') {
        return {
          content: [{
            type: 'text',
            text: request.name === 'register'
              ? JSON.stringify({ player_id: 'p', password: 'p' })
              : 'Logged in',
          }],
          isError: false,
        };
      }
      return {
        content: [{ type: 'text', text: 'Tool not found' }],
        isError: true,
      };
    };

    const provider = createSpaceMoltToolProvider(options, mockClient);
    await provider.discover();

    const result = await provider.execute('spacemolt:unknown', {});

    expect(result.success).toBe(false);
    expect(result.error).toBe('Tool not found');
  });

  it('AC2.6: refreshTools() re-runs listTools and updates cache', async () => {
    const options = makeOptions();
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

  it('AC2.6: notifications/tools/list_changed triggers refreshTools callback', async () => {
    const options = makeOptions();
    const client = createMockMcpClient();
    const provider = createSpaceMoltToolProvider(options, client);

    // Discover and capture the listener
    await provider.discover();

    // Verify listener was registered
    const listChangedListeners = client.listeners['notifications/tools/list_changed'];
    expect(listChangedListeners).toBeDefined();
    const listeners = listChangedListeners;
    if (!listeners) {
      throw new Error('Expected listeners to be registered');
    }
    expect(listeners.length).toBeGreaterThan(0);

    // Change the tool list
    client.listTools = async () => ({
      tools: [
        {
          name: 'new_tool',
          description: 'A new tool',
          inputSchema: { type: 'object' },
        },
      ],
    });

    // Fire the notification callback
    const handler = listeners[0];
    if (handler) {
      await handler({ resourceType: 'tool' });
    }

    // Verify tools were refreshed by calling discover again
    // (it returns cached tools unless refreshTools was called)
    const tools = await provider.discover();
    const newTool = tools.find((t) => t.name === 'spacemolt:new_tool');
    const mineTool = tools.find((t) => t.name === 'spacemolt:mine');

    expect(newTool).toBeDefined();
    expect(mineTool).toBeUndefined();
  });

  it('close() is available for cleanup', async () => {
    const options = makeOptions();
    const provider = createSpaceMoltToolProvider(options, mockClient);

    await provider.discover();
    await provider.close();

    // Should not throw
    expect(true).toBe(true);
  });

  it('caches tools after first discovery', async () => {
    const options = makeOptions();
    let listToolsCallCount = 0;

    const callCountMockClient: MockMcpClient = {
      ...mockClient,
      listTools: async (cursor?: string) => {
        listToolsCallCount++;
        return mockClient.listTools(cursor);
      },
    };

    const provider = createSpaceMoltToolProvider(options, callCountMockClient);

    const firstCall = await provider.discover();
    const initialCallCount = listToolsCallCount;

    const secondCall = await provider.discover();
    const secondCallCount = listToolsCallCount;

    expect(firstCall).toEqual(secondCall);
    expect(secondCallCount).toBe(initialCallCount);
  });

  it('handles multiple content blocks in MCP response', async () => {
    const options = makeOptions();
    mockClient.callTool = async (request) => {
      if (request.name === 'login' || request.name === 'register') {
        return {
          content: [{
            type: 'text',
            text: request.name === 'register'
              ? JSON.stringify({ player_id: 'p', password: 'p' })
              : 'Logged in',
          }],
          isError: false,
        };
      }
      return {
        content: [
          { type: 'text', text: 'Block 1' },
          { type: 'text', text: 'Block 2' },
        ],
        isError: false,
      };
    };

    const provider = createSpaceMoltToolProvider(options, mockClient);
    await provider.discover();

    const result = await provider.execute('spacemolt:mine', {});

    expect(result.output).toBe('Block 1\nBlock 2');
  });

  it('provides discover() method matching ToolProvider interface', async () => {
    const options = makeOptions();
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
    const options = makeOptions();
    const provider = createSpaceMoltToolProvider(options, mockClient);
    await provider.discover();

    const result = await provider.execute('spacemolt:mine', {
      location: 'test',
    });

    expect(result.success).toBeDefined();
    expect(result.output).toBeDefined();
  });

  it('AC5.3: detects session_invalid error and retries after reconnect', async () => {
    const store = createMockMemoryStore();
    const options = makeOptions({ store });
    let callCount = 0;
    let reconnectCalled = false;

    // Pre-populate credentials
    store.getBlockByLabel = async () => ({
      id: 'creds-1',
      owner: 'spirit',
      tier: 'core',
      label: 'spacemolt:credentials',
      content: JSON.stringify({
        username: 'user',
        password: 'pass',
        player_id: 'player-1',
        empire: 'solarian',
      }),
      embedding: null,
      permission: 'readwrite',
      pinned: true,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const sessionExpireClient: MockMcpClient = {
      ...mockClient,
      callTool: async (request) => {
        callCount++;
        if (request.name === 'login') {
          reconnectCalled = true;
          return {
            content: [{ type: 'text', text: 'Logged in' }],
            isError: false,
          };
        }
        // First call to mine fails with session_invalid
        if (request.name === 'mine' && callCount === 2) {
          const error = new Error('session_invalid: your session has expired');
          throw error;
        }
        // Second call to mine (after reconnect) succeeds
        if (request.name === 'mine') {
          return {
            content: [{ type: 'text', text: 'Mined 75 iron' }],
            isError: false,
          };
        }
        return {
          content: [{ type: 'text', text: 'Unknown tool' }],
          isError: true,
        };
      },
    };

    const provider = createSpaceMoltToolProvider(options, sessionExpireClient);
    await provider.discover();

    const result = await provider.execute('spacemolt:mine', {
      location: 'asteroid_field',
    });

    expect(reconnectCalled).toBe(true);
    expect(result.success).toBe(true);
    expect(result.output).toBe('Mined 75 iron');
  });

  it('AC5.3: non-session errors do not trigger reconnect', async () => {
    const options = makeOptions();
    let reconnectAttempt = false;

    const nonSessionErrorClient: MockMcpClient = {
      ...mockClient,
      callTool: async (request) => {
        if (request.name === 'login') {
          return {
            content: [{ type: 'text', text: 'Logged in' }],
            isError: false,
          };
        }
        if (request.name === 'register') {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                player_id: 'player-123',
                password: 'a'.repeat(64),
              }),
            }],
            isError: false,
          };
        }
        if (request.name === 'mine') {
          throw new Error('tool execution failed: invalid argument');
        }
        return {
          content: [{ type: 'text', text: 'Unknown tool' }],
          isError: true,
        };
      },
      close: async () => {
        reconnectAttempt = true;
      },
    };

    const provider = createSpaceMoltToolProvider(options, nonSessionErrorClient);
    await provider.discover();

    const result = await provider.execute('spacemolt:mine', {
      location: 'invalid',
    });

    expect(reconnectAttempt).toBe(false);
    expect(result.success).toBe(false);
    expect(result.error).toContain('tool execution failed');
  });

  it('AC5.3: retry also fails returns error ToolResult', async () => {
    const store = createMockMemoryStore();
    const options = makeOptions({ store });
    let callCount = 0;

    // Pre-populate credentials
    store.getBlockByLabel = async () => ({
      id: 'creds-1',
      owner: 'spirit',
      tier: 'core',
      label: 'spacemolt:credentials',
      content: JSON.stringify({
        username: 'user',
        password: 'pass',
        player_id: 'player-1',
        empire: 'solarian',
      }),
      embedding: null,
      permission: 'readwrite',
      pinned: true,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const failingRetryClient: MockMcpClient = {
      ...mockClient,
      callTool: async (request) => {
        callCount++;
        if (request.name === 'login') {
          return {
            content: [{ type: 'text', text: 'Logged in' }],
            isError: false,
          };
        }
        // All mine calls fail with session_invalid
        if (request.name === 'mine') {
          throw new Error('session_invalid: authentication failed');
        }
        return {
          content: [{ type: 'text', text: 'Unknown tool' }],
          isError: true,
        };
      },
    };

    const provider = createSpaceMoltToolProvider(options, failingRetryClient);
    await provider.discover();

    const result = await provider.execute('spacemolt:mine', {
      location: 'test',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('session_invalid');
  });
});
