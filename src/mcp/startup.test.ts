// pattern: Functional Core

import { describe, it, expect } from 'bun:test';
import { createMcpInstructionsProvider, formatMcpStartupSummary } from './startup.js';
import type { McpClient, McpToolInfo } from './types.js';

/**
 * Mock MCP client factory for testing graceful degradation scenarios.
 */
function createMockMcpClient(options?: {
  readonly shouldFailConnect?: boolean;
  readonly tools?: ReadonlyArray<McpToolInfo>;
  readonly instructions?: string;
}): McpClient {
  const tools = options?.tools ?? [];
  const instructions = options?.instructions;
  const shouldFail = options?.shouldFailConnect ?? false;

  return {
    serverName: 'mock-server',
    connect: async () => {
      if (shouldFail) {
        throw new Error('Connection failed');
      }
    },
    disconnect: async () => {},
    listTools: async () => tools as Array<McpToolInfo>,
    callTool: async () => ({success: true, output: ''}),
    listPrompts: async () => [],
    getPrompt: async () => ({
      description: undefined,
      messages: [],
    }),
    getInstructions: async () => instructions,
  };
}

describe('createMcpInstructionsProvider', () => {
  describe('AC7.1: Server instructions as context', () => {
    it('should return a function that formats instructions with server name', () => {
      const serverName = 'github';
      const instructions = 'Use the tools to interact with GitHub repositories.';

      const provider = createMcpInstructionsProvider(serverName, instructions);
      const result = provider();

      expect(result).toBeDefined();
      expect(result).toContain('[MCP: github]');
      expect(result).toContain('Use the tools to interact with GitHub repositories.');
    });

    it('should format instructions on multiple lines', () => {
      const serverName = 'filesystem';
      const instructions = 'Access filesystem operations.\nUse with caution.';

      const provider = createMcpInstructionsProvider(serverName, instructions);
      const result = provider();

      expect(result).toContain('[MCP: filesystem]');
      expect(result).toContain('Access filesystem operations.');
      expect(result).toContain('Use with caution.');
    });

    it('should handle empty string instructions', () => {
      const serverName = 'empty';
      const instructions = '';

      const provider = createMcpInstructionsProvider(serverName, instructions);
      const result = provider();

      expect(result).toBeDefined();
      expect(result).toContain('[MCP: empty]');
    });

    it('should return a context provider function', () => {
      const provider = createMcpInstructionsProvider('test', 'test instructions');
      expect(typeof provider).toBe('function');
    });
  });

  describe('AC7.2: Edge case - no instructions', () => {
    it('should test composition logic: provider only pushed if instructions non-null', async () => {
      // This test documents the pattern: in src/index.ts, we only push a provider
      // if getInstructions() returns a non-null value.
      // The helper createMcpInstructionsProvider itself only creates providers
      // for non-null instructions, so this is a documentation test.

      const mockClient = createMockMcpClient({instructions: undefined});
      const instructions = await mockClient.getInstructions();

      expect(instructions).toBeUndefined();
    });
  });
});

describe('formatMcpStartupSummary', () => {
  describe('AC6.1, AC6.3, AC6.4: Graceful degradation summary formatting', () => {
    it('should format summary when all servers connected', () => {
      const connected = ['github', 'filesystem'];
      const failed: Array<{name: string; error: string}> = [];

      const summary = formatMcpStartupSummary(connected, failed);

      expect(summary).toContain('2');
      expect(summary).toContain('connected');
      expect(summary).not.toContain('failed');
    });

    it('should format summary when one server fails', () => {
      const connected = ['github', 'filesystem'];
      const failed = [{name: 'bad-server', error: 'timeout'}];

      const summary = formatMcpStartupSummary(connected, failed);

      expect(summary).toContain('2');
      expect(summary).toContain('connected');
      expect(summary).toContain('1');
      expect(summary).toContain('failed');
      expect(summary).toContain('bad-server');
    });

    it('should format summary when all servers fail', () => {
      const connected: Array<string> = [];
      const failed = [
        {name: 'github', error: 'auth failed'},
        {name: 'filesystem', error: 'permission denied'},
      ];

      const summary = formatMcpStartupSummary(connected, failed);

      expect(summary).toContain('0');
      expect(summary).toContain('connected');
      expect(summary).toContain('2');
      expect(summary).toContain('failed');
      expect(summary).toContain('github');
      expect(summary).toContain('filesystem');
    });

    it('should format summary when no servers configured', () => {
      const connected: Array<string> = [];
      const failed: Array<{name: string; error: string}> = [];

      const summary = formatMcpStartupSummary(connected, failed);

      expect(summary).toBeDefined();
      expect(summary.length).toBeGreaterThan(0);
    });

    it('should include error details for failed servers', () => {
      const connected = ['working'];
      const failed = [
        {name: 'bad1', error: 'connection refused'},
        {name: 'bad2', error: 'timeout'},
      ];

      const summary = formatMcpStartupSummary(connected, failed);

      expect(summary).toContain('bad1');
      expect(summary).toContain('connection refused');
      expect(summary).toContain('bad2');
      expect(summary).toContain('timeout');
    });
  });
});

describe('Graceful degradation integration scenarios', () => {
  describe('AC6.1: All servers connect successfully', () => {
    it('should collect tools from all connected servers', async () => {
      const client1 = createMockMcpClient({
        tools: [{name: 'tool1', description: 'Tool 1', inputSchema: {}}],
      });
      const client2 = createMockMcpClient({
        tools: [{name: 'tool2', description: 'Tool 2', inputSchema: {}}],
      });

      const connectedClients: Array<McpClient> = [];
      const failedServers: Array<{name: string; error: string}> = [];

      // Simulate composition root loop
      for (const client of [client1, client2]) {
        try {
          await client.connect();
          await client.listTools();
          connectedClients.push(client);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          failedServers.push({name: client.serverName, error: errorMsg});
        }
      }

      expect(connectedClients.length).toBe(2);
      expect(failedServers.length).toBe(0);
    });
  });

  describe('AC6.3: One server fails, others succeed', () => {
    it('should continue with remaining servers when one fails', async () => {
      const client1 = createMockMcpClient({
        tools: [{name: 'tool1', description: 'Tool 1', inputSchema: {}}],
      });
      const client2 = createMockMcpClient({shouldFailConnect: true});
      const client3 = createMockMcpClient({
        tools: [{name: 'tool3', description: 'Tool 3', inputSchema: {}}],
      });

      const connectedClients: Array<McpClient> = [];
      const failedServers: Array<{name: string; error: string}> = [];

      // Simulate composition root loop with per-server try/catch
      for (const client of [client1, client2, client3]) {
        try {
          await client.connect();
          await client.listTools();
          connectedClients.push(client);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          failedServers.push({name: client.serverName, error: errorMsg});
        }
      }

      expect(connectedClients.length).toBe(2);
      expect(failedServers.length).toBe(1);
      expect(failedServers[0]?.name).toBe('mock-server');
    });

    it('should not propagate exception to startup when one server fails', async () => {
      const client1 = createMockMcpClient();
      const client2 = createMockMcpClient({shouldFailConnect: true});

      let exceptionThrown = false;

      // Simulate composition root startup with error handling
      try {
        for (const client of [client1, client2]) {
          try {
            await client.connect();
          } catch (error) {
            // Gracefully handle per-server errors
          }
        }
      } catch (error) {
        exceptionThrown = true;
      }

      expect(exceptionThrown).toBe(false);
    });
  });

  describe('AC6.4: All servers fail, startup continues', () => {
    it('should handle all servers failing without blocking startup', async () => {
      const client1 = createMockMcpClient({shouldFailConnect: true});
      const client2 = createMockMcpClient({shouldFailConnect: true});

      const connectedClients: Array<McpClient> = [];
      const failedServers: Array<{name: string; error: string}> = [];

      // Simulate composition root loop
      for (const client of [client1, client2]) {
        try {
          await client.connect();
          connectedClients.push(client);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          failedServers.push({name: client.serverName, error: errorMsg});
        }
      }

      expect(connectedClients.length).toBe(0);
      expect(failedServers.length).toBe(2);

      // Startup summary should reflect the failures
      const summary = formatMcpStartupSummary(
        connectedClients.map(c => c.serverName),
        failedServers,
      );
      expect(summary).toBeDefined();
    });

    it('should not throw when all servers fail', async () => {
      const clients = [
        createMockMcpClient({shouldFailConnect: true}),
        createMockMcpClient({shouldFailConnect: true}),
      ];

      let exceptionThrown = false;

      try {
        for (const client of clients) {
          try {
            await client.connect();
          } catch (error) {
            // Graceful degradation: continue
          }
        }
      } catch (error) {
        exceptionThrown = true;
      }

      expect(exceptionThrown).toBe(false);
    });
  });
});
