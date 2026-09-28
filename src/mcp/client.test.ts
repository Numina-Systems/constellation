// pattern: Functional Core (tests for pure functions and disconnected client behaviour)

import { describe, it, expect } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { createMockMcpTransport, type MockMcpTransport } from '@/testing/mcp-transport.ts';
import { mapToolResult, createMcpClient, buildTransportOptions } from './client.ts';
import type { McpServerConfig } from './schema.ts';

async function respondToRequest(transport: MockMcpTransport, method: string, result: Record<string, unknown>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const request = transport.sent.find((message): message is Extract<JSONRPCMessage, {method: string; id: number | string}> => 'method' in message && message.method === method && 'id' in message);
    if (request !== undefined) {
      transport.deliver({jsonrpc: '2.0', id: request.id, result});
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`timed out waiting for MCP request: ${method}`);
}

describe('mapToolResult', () => {
  describe('AC4.5: Map text ContentBlocks to ToolResult.output', () => {
    it('should concatenate single text block to output with success true', () => {
      const content = [{ type: 'text', text: 'hello world' }];
      const result = mapToolResult(content, false);

      expect(result.success).toBe(true);
      expect(result.output).toBe('hello world');
      expect(result.error).toBeUndefined();
    });

    it('should concatenate multiple text blocks with newline separator', () => {
      const content = [
        { type: 'text', text: 'first line' },
        { type: 'text', text: 'second line' },
        { type: 'text', text: 'third line' },
      ];
      const result = mapToolResult(content, false);

      expect(result.success).toBe(true);
      expect(result.output).toBe('first line\nsecond line\nthird line');
    });

    it('should ignore non-text content blocks', () => {
      const content = [
        { type: 'text', text: 'text content' },
        { type: 'image', url: 'https://example.com/image.png' },
        { type: 'text', text: 'more text' },
      ];
      const result = mapToolResult(content, false);

      expect(result.success).toBe(true);
      expect(result.output).toBe('text content\nmore text');
    });

    it('should handle empty content array', () => {
      const content: Array<{ readonly type: string; readonly text?: string }> = [];
      const result = mapToolResult(content, false);

      expect(result.success).toBe(true);
      expect(result.output).toBe('');
      expect(result.error).toBeUndefined();
    });

    it('should handle text blocks without text property', () => {
      const content = [
        { type: 'text', text: 'valid' },
        { type: 'text' },
        { type: 'text', text: 'also valid' },
      ];
      const result = mapToolResult(content, false);

      expect(result.success).toBe(true);
      expect(result.output).toBe('valid\nalso valid');
    });
  });

  describe('AC4.7: Map isError=true to ToolResult.success=false', () => {
    it('should set success false and include error when isError is true', () => {
      const content = [{ type: 'text', text: 'error message' }];
      const result = mapToolResult(content, true);

      expect(result.success).toBe(false);
      expect(result.output).toBe('error message');
      expect(result.error).toBe('error message');
    });

    it('should include multiple text blocks in error output', () => {
      const content = [
        { type: 'text', text: 'first error' },
        { type: 'text', text: 'second error' },
      ];
      const result = mapToolResult(content, true);

      expect(result.success).toBe(false);
      expect(result.error).toBe('first error\nsecond error');
    });

    it('should return empty error when no text blocks and isError true', () => {
      const content = [{ type: 'image', url: 'https://example.com/image.png' }];
      const result = mapToolResult(content, true);

      expect(result.success).toBe(false);
      expect(result.output).toBe('');
      expect(result.error).toBe('');
    });

    it('should default isError to false when undefined', () => {
      const content = [{ type: 'text', text: 'output' }];
      const result = mapToolResult(content, undefined);

      expect(result.success).toBe(true);
      expect(result.output).toBe('output');
      expect(result.error).toBeUndefined();
    });
  });

  describe('AC4.6: Handle disconnected client callTool', () => {
    it('should return success false when calling tool on disconnected client', async () => {
      const config: McpServerConfig = {
        transport: 'http',
        url: 'http://localhost:3001/mcp',
      };
      const client = createMcpClient('test-server', config);

      // Don't call connect() - client remains disconnected
      const result = await client.callTool('test_tool', { arg: 'value' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not connected');
      expect(result.output).toBe('');
    });

    it('should include server name in disconnection error message', async () => {
      const config: McpServerConfig = {
        transport: 'http',
        url: 'http://localhost:3001/mcp',
      };
      const client = createMcpClient('my-special-server', config);

      const result = await client.callTool('any_tool', {});

      expect(result.error).toContain('my-special-server');
      expect(result.error).toContain('not connected');
    });
  });
});

describe('createMcpClient reconnection', () => {
  it('reconnects after onclose with capped exponential backoff and serves tool calls on the replacement client', async () => {
    const transports: Array<MockMcpTransport> = [];
    const delays: Array<number> = [];
    let clientsCreated = 0;
    const client = createMcpClient('reconnect-server', {transport: 'http', url: 'http://loopback.test/mcp'}, {
      clientFactory: () => { clientsCreated += 1; return new Client({name: `test-${clientsCreated}`, version: '1'}); },
      transportFactory: () => { const transport = createMockMcpTransport(); transports.push(transport); return transport; },
      reconnect: {maxAttempts: 3, initialDelayMs: 10, maxDelayMs: 15, sleep: async (delayMs) => { delays.push(delayMs); }},
    });

    const initialConnect = client.connect();
    const firstTransport = transports[0];
    if (!firstTransport) throw new Error('expected initial transport');
    await respondToRequest(firstTransport, 'initialize', {protocolVersion: '2025-11-25', capabilities: {tools: {}}, serverInfo: {name: 'loopback', version: '1'}});
    await initialConnect;
    await firstTransport.close();

    for (let attempt = 0; attempt < 100 && transports.length < 2; attempt += 1) await Promise.resolve();
    const reconnectedTransport = transports[1];
    if (!reconnectedTransport) throw new Error('expected replacement transport');
    await respondToRequest(reconnectedTransport, 'initialize', {protocolVersion: '2025-11-25', capabilities: {tools: {}}, serverInfo: {name: 'loopback', version: '1'}});
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
    const toolCall = client.callTool('hello', {});
    await respondToRequest(reconnectedTransport, 'tools/call', {content: [{type: 'text', text: 'reconnected'}]});
    const result = await toolCall;
    await client.disconnect();

    expect(delays).toEqual([10]);
    expect(clientsCreated).toBe(2);
    expect(result.success).toBe(true);
    expect(result.output).toBe('reconnected');
  });

  it('exposes a typed terminal error and structured log after the bounded retries fail', async () => {
    const errors: Array<ReadonlyArray<unknown>> = [];
    const originalError = console.error;
    console.error = (...values: Array<unknown>) => { errors.push(values); };
    const transports: Array<MockMcpTransport> = [];
    let clientsCreated = 0;
    const delays: Array<number> = [];
    const client = createMcpClient('offline-server', {transport: 'http', url: 'http://loopback.test/mcp'}, {
      clientFactory: () => {
        clientsCreated += 1;
        const sdkClient = new Client({name: `offline-${clientsCreated}`, version: '1'});
        if (clientsCreated > 1) sdkClient.connect = async () => { throw new Error('offline'); };
        return sdkClient;
      },
      transportFactory: () => { const transport = createMockMcpTransport(); transports.push(transport); return transport; },
      reconnect: {maxAttempts: 2, initialDelayMs: 5, maxDelayMs: 10, sleep: async (delayMs) => { delays.push(delayMs); }},
    });

    try {
      const initialConnect = client.connect();
      const initialTransport = transports[0];
      if (!initialTransport) throw new Error('expected initial transport');
      await respondToRequest(initialTransport, 'initialize', {protocolVersion: '2025-11-25', capabilities: {tools: {}}, serverInfo: {name: 'loopback', version: '1'}});
      await initialConnect;
      await initialTransport.close();
      for (let attempt = 0; attempt < 100 && !errors.some((values) => values[0] === '[mcp] reconnect exhausted'); attempt += 1) await Promise.resolve();
      const result = await client.callTool('hello', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('mcp_reconnect_exhausted');
      expect(delays).toEqual([5, 10]);
      expect(errors.some((values) => values[0] === '[mcp] reconnect exhausted' && (values[1] as Record<string, unknown>)['code'] === 'mcp_reconnect_exhausted')).toBe(true);
      expect(clientsCreated).toBe(3);
    } finally {
      await client.disconnect();
      console.error = originalError;
    }
  });
});

describe('createMcpClient disconnected behaviour', () => {
  describe('AC4.6: listTools returns empty when disconnected', () => {
    it('should return empty array when listTools called before connect', async () => {
      const config: McpServerConfig = {
        transport: 'http',
        url: 'http://localhost:3001/mcp',
      };
      const client = createMcpClient('test-server', config);

      const tools = await client.listTools();

      expect(tools).toEqual([]);
    });
  });

  describe('AC4.6: listPrompts returns empty when disconnected', () => {
    it('should return empty array when listPrompts called before connect', async () => {
      const config: McpServerConfig = {
        transport: 'http',
        url: 'http://localhost:3001/mcp',
      };
      const client = createMcpClient('test-server', config);

      const prompts = await client.listPrompts();

      expect(prompts).toEqual([]);
    });
  });

  describe('AC7.2: getInstructions returns undefined when disconnected', () => {
    it('should return undefined when getInstructions called before connect', async () => {
      const config: McpServerConfig = {
        transport: 'http',
        url: 'http://localhost:3001/mcp',
      };
      const client = createMcpClient('test-server', config);

      const instructions = await client.getInstructions();

      expect(instructions).toBeUndefined();
    });
  });

  describe('AC4.6: getPrompt returns empty when disconnected', () => {
    it('should return { description: undefined, messages: [] } when getPrompt called before connect', async () => {
      const config: McpServerConfig = {
        transport: 'http',
        url: 'http://localhost:3001/mcp',
      };
      const client = createMcpClient('test-server', config);

      const result = await client.getPrompt('test-prompt', { arg: 'value' });

      expect(result.description).toBeUndefined();
      expect(result.messages).toEqual([]);
    });
  });

  describe('serverName property', () => {
    it('should return the server name passed to factory', () => {
      const config: McpServerConfig = {
        transport: 'http',
        url: 'http://localhost:3001/mcp',
      };
      const client = createMcpClient('my-server-name', config);

      expect(client.serverName).toBe('my-server-name');
    });

    it('should maintain server name across multiple instances', () => {
      const config: McpServerConfig = {
        transport: 'http',
        url: 'http://localhost:3001/mcp',
      };
      const client1 = createMcpClient('server-1', config);
      const client2 = createMcpClient('server-2', config);

      expect(client1.serverName).toBe('server-1');
      expect(client2.serverName).toBe('server-2');
    });
  });
});

describe('buildTransportOptions', () => {
  describe('AC2.1: Stdio transport creation', () => {
    it('should create stdio transport with command and args', () => {
      const config: McpServerConfig = {
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/test'],
        env: {},
      };
      const processEnv = {};

      const result = buildTransportOptions(config, processEnv);

      expect(result.type).toBe('stdio');
      if (result.type === 'stdio') {
        expect(result.command).toBe('npx');
        expect(result.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem', '/tmp/test']);
      }
    });

    it('should copy args array to prevent mutation', () => {
      const config: McpServerConfig = {
        transport: 'stdio',
        command: 'node',
        args: ['script.js'],
        env: {},
      };
      const processEnv = {};

      const result = buildTransportOptions(config, processEnv);

      // Verify identity: returned args are a different array instance
      if (result.type === 'stdio') {
        expect(result.args !== config.args).toBe(true);
        expect(result.args[0]).toBe('script.js');
      }
    });
  });

  describe('AC2.2: Environment variable merging', () => {
    it('should merge config env with processEnv, with config env taking precedence', () => {
      const config: McpServerConfig = {
        transport: 'stdio',
        command: 'node',
        args: [],
        env: { CUSTOM: 'from-config', OVERRIDE: 'config-value' },
      };
      const processEnv = {
        PATH: '/usr/bin',
        HOME: '/home/test',
        OVERRIDE: 'process-value',
      };

      const result = buildTransportOptions(config, processEnv);

      expect(result.type).toBe('stdio');
      if (result.type === 'stdio') {
        expect(result.env['PATH']).toBe('/usr/bin');
        expect(result.env['HOME']).toBe('/home/test');
        expect(result.env['CUSTOM']).toBe('from-config');
        expect(result.env['OVERRIDE']).toBe('config-value');
      }
    });

    it('should handle empty config env and preserve processEnv', () => {
      const config: McpServerConfig = {
        transport: 'stdio',
        command: 'node',
        args: [],
        env: {},
      };
      const processEnv = {
        PATH: '/usr/bin',
        HOME: '/home/test',
        USER: 'testuser',
      };

      const result = buildTransportOptions(config, processEnv);

      expect(result.type).toBe('stdio');
      if (result.type === 'stdio') {
        expect(result.env['PATH']).toBe('/usr/bin');
        expect(result.env['HOME']).toBe('/home/test');
        expect(result.env['USER']).toBe('testuser');
      }
    });

    it('should handle undefined values in processEnv', () => {
      const config: McpServerConfig = {
        transport: 'stdio',
        command: 'node',
        args: [],
        env: { CUSTOM: 'value' },
      };
      const processEnv = {
        DEFINED: 'yes',
        UNDEFINED: undefined,
      };

      const result = buildTransportOptions(config, processEnv);

      expect(result.type).toBe('stdio');
      if (result.type === 'stdio') {
        expect(result.env['DEFINED']).toBe('yes');
        expect(result.env['UNDEFINED']).toBeUndefined();
        expect(result.env['CUSTOM']).toBe('value');
      }
    });
  });

  describe('AC3.1: HTTP transport creation', () => {
    it('should create HTTP transport with URL', () => {
      const config: McpServerConfig = {
        transport: 'http',
        url: 'http://localhost:3001/mcp',
      };
      const processEnv = {};

      const result = buildTransportOptions(config, processEnv);

      expect(result.type).toBe('http');
      if (result.type === 'http') {
        expect(result.url).toBeInstanceOf(URL);
        expect(result.url.href).toBe('http://localhost:3001/mcp');
      }
    });

    it('should handle HTTPS URLs', () => {
      const config: McpServerConfig = {
        transport: 'http',
        url: 'https://api.example.com/mcp',
      };
      const processEnv = {};

      const result = buildTransportOptions(config, processEnv);

      expect(result.type).toBe('http');
      if (result.type === 'http') {
        expect(result.url).toBeInstanceOf(URL);
        expect(result.url.href).toBe('https://api.example.com/mcp');
      }
    });

    it('should handle URLs with port numbers', () => {
      const config: McpServerConfig = {
        transport: 'http',
        url: 'http://localhost:8080/services/mcp',
      };
      const processEnv = {};

      const result = buildTransportOptions(config, processEnv);

      expect(result.type).toBe('http');
      if (result.type === 'http') {
        expect(result.url.hostname).toBe('localhost');
        expect(result.url.port).toBe('8080');
        expect(result.url.pathname).toBe('/services/mcp');
      }
    });
  });
});
