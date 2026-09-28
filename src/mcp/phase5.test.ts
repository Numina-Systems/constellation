import { describe, expect, it } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { createMockMcpTransport, type MockMcpTransport } from '@/testing/mcp-transport.ts';
import { createToolRegistry } from '@/tool/registry.ts';
import type { ToolRegistry, ToolResult } from '@/tool/types.ts';
import { createMcpClient, mapMcpToolResult } from './client.ts';
import { MCP_DEFAULT_DISCOVERY_TIMEOUT_MS, MCP_DEFAULT_MAX_PAGES, McpDiscoveryError } from './types.ts';
import { createMcpToolProvider } from './provider.ts';
import { collectMcpPages } from './discovery-bounds.ts';
import { connectMcpServers, publishMcpRegistrations } from './startup.ts';
import type { McpClient, McpPromptResult, McpToolInfo } from './types.ts';

type ClientOptions = Readonly<{
  readonly serverName?: string;
  readonly tools?: ReadonlyArray<McpToolInfo>;
  readonly failConnect?: boolean;
  readonly disconnects?: Array<boolean>;
}>;

function mockClient(options: ClientOptions = {}): McpClient {
  const tools = options.tools ?? [];
  return {
    serverName: options.serverName ?? 'mock',
    connect: async () => { if (options.failConnect) throw new Error('connection refused'); },
    disconnect: async () => { options.disconnects?.push(true); },
    listTools: async () => tools as Array<McpToolInfo>,
    callTool: async () => ({success: true, output: 'ok'} as ToolResult),
    listPrompts: async () => [],
    getPrompt: async (): Promise<McpPromptResult> => ({description: undefined, messages: []}),
    getInstructions: async () => undefined,
  };
}

function tool(name: string, schema: Record<string, unknown>): McpToolInfo {
  return {name, description: name, inputSchema: schema};
}

function createObservedSdkClient(
  connectOptions: Array<RequestOptions | undefined>,
  listOptions: Array<RequestOptions | undefined>,
): Client {
  const realClient = new Client({name: 'observed-test-client', version: '1'});
  const originalConnect = realClient.connect.bind(realClient);
  const originalListTools = realClient.listTools.bind(realClient);
  realClient.connect = async (transport, options) => {
    connectOptions.push(options);
    return originalConnect(transport, options);
  };
  realClient.listTools = async (params, options) => {
    listOptions.push(options);
    return originalListTools(params, options);
  };
  return realClient;
}

async function respondToRequest(transport: MockMcpTransport, method: string, result: Record<string, unknown>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const request = transport.sent.find((message): message is Extract<JSONRPCMessage, {method: string; id: number | string}> => 'method' in message && message.method === method && 'id' in message);
    if (request !== undefined) {
      transport.deliver({jsonrpc: '2.0', id: request.id, result});
      return;
    }
    await Promise.resolve();
  }
  throw new Error(`timed out waiting for MCP request: ${method}`);
}

describe('mcp_discovery_bound_matrix', () => {
  it('rejects page caps and repeated cursors without exposing partial results', async () => {
    let calls = 0;
    await expect(collectMcpPages(async (cursor) => {
      calls += 1;
      return {items: [cursor ?? 'first'], nextCursor: 'same'};
    }, {maxPages: 8, deadline: 100, now: () => 0})).rejects.toMatchObject({code: 'mcp_discovery_repeated_cursor'});
    expect(calls).toBe(2);
    await expect(collectMcpPages(async () => ({items: ['x'], nextCursor: 'next'}), {maxPages: 1, deadline: 100, now: () => 0})).rejects.toMatchObject({code: 'mcp_discovery_page_limit_exceeded'});
    expect(MCP_DEFAULT_DISCOVERY_TIMEOUT_MS).toBe(30_000);
    expect(MCP_DEFAULT_MAX_PAGES).toBe(64);
  });

  it('chains transport causes and bounds repeated cursor details', async () => {
    const cause = new Error('wire failure');
    await expect(collectMcpPages(async () => { throw cause; }, {deadline: 100, now: () => 0})).rejects.toMatchObject({code: 'mcp_discovery_transport_error', cause});
    const repeated = 'cursor-'.concat('x'.repeat(300));
    try {
      await collectMcpPages(async () => ({items: [], nextCursor: repeated}), {maxPages: 4, deadline: 100, now: () => 0});
      throw new Error('expected repeated cursor error');
    } catch (error) {
      expect(error).toBeInstanceOf(McpDiscoveryError);
      if (error instanceof McpDiscoveryError) {
        expect(error.code).toBe('mcp_discovery_repeated_cursor');
        expect(String(error.details['cursor'])).toHaveLength(129);
        expect(error.details['cursorLength']).toBe(repeated.length);
      }
    }
  });

  it('recognizes caller abort and absolute deadline as typed bounded errors', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(collectMcpPages(async () => ({items: ['x']}), {signal: controller.signal, deadline: 10, now: () => 0})).rejects.toMatchObject({code: 'mcp_discovery_aborted'});
    await expect(collectMcpPages(async () => ({items: ['x']}), {deadline: 0, now: () => 1})).rejects.toMatchObject({code: 'mcp_discovery_deadline_exceeded'});
  });

  it('leaves generation one live after a failed second discovery', async () => {
    let fail = false;
    const client = mockClient({tools: [tool('live', {type: 'object'})]});
    client.listTools = async () => { if (fail) throw new Error('failed page'); return [tool('live', {type: 'object'})]; };
    const provider = createMcpToolProvider(client);
    await provider.discover();
    fail = true;
    await expect(provider.discover()).rejects.toThrow();
    expect(provider.generation()).toBe(1);
    expect((await provider.execute('mcp_mock_live', {})).success).toBe(true);
  });
});

describe('mcp_client_connected_forwarding', () => {
  it('forwards signal, timeout, and maxTotalTimeout through real SDK connect/listTools', async () => {
    const controller = new AbortController();
    const transport = createMockMcpTransport(controller.signal);
    const connectOptions: Array<RequestOptions | undefined> = [];
    const listOptions: Array<RequestOptions | undefined> = [];
    const client = createObservedSdkClient(connectOptions, listOptions);
    const mcpClient = createMcpClient('loopback', {transport: 'http', url: 'http://loopback.test/mcp'}, {
      clientFactory: () => client,
      transportFactory: () => transport,
    });
    const now = () => 1_000;
    const deadline = 4_500;
    const connecting = mcpClient.connect({signal: controller.signal, deadline, now});
    await respondToRequest(transport, 'initialize', {protocolVersion: '2025-11-25', capabilities: {tools: {}}, serverInfo: {name: 'loopback', version: '1'}});
    await connecting;
    const listing = mcpClient.listTools({signal: controller.signal, deadline, now});
    await respondToRequest(transport, 'tools/list', {tools: [], nextCursor: undefined});
    await expect(listing).resolves.toEqual([]);
    await mcpClient.disconnect();
    expect(connectOptions[0]).toMatchObject({signal: controller.signal, timeout: 3500, maxTotalTimeout: 3500});
    expect(listOptions[0]).toMatchObject({signal: controller.signal, timeout: 3500, maxTotalTimeout: 3500});
  });

  it('uses the 30 second and 64 page defaults when discovery options are omitted', async () => {
    const controller = new AbortController();
    const transport = createMockMcpTransport(controller.signal);
    const connectOptions: Array<RequestOptions | undefined> = [];
    const listOptions: Array<RequestOptions | undefined> = [];
    const client = createObservedSdkClient(connectOptions, listOptions);
    const mcpClient = createMcpClient('loopback-defaults', {transport: 'http', url: 'http://loopback.test/mcp'}, {
      clientFactory: () => client,
      transportFactory: () => transport,
    });
    const now = () => 2_000;
    const connecting = mcpClient.connect({now});
    await respondToRequest(transport, 'initialize', {protocolVersion: '2025-11-25', capabilities: {tools: {}}, serverInfo: {name: 'loopback', version: '1'}});
    await connecting;
    const listing = mcpClient.listTools({now});
    await respondToRequest(transport, 'tools/list', {tools: [], nextCursor: undefined});
    await expect(listing).resolves.toEqual([]);
    await mcpClient.disconnect();
    expect(connectOptions[0]).toMatchObject({timeout: 30_000, maxTotalTimeout: 30_000});
    expect(listOptions[0]).toMatchObject({timeout: 30_000, maxTotalTimeout: 30_000});
    let pages = 0;
    await expect(collectMcpPages(async () => {
      pages += 1;
      return {items: [], nextCursor: `page-${pages}`};
    }, {deadline: 100, now: () => 0})).rejects.toMatchObject({code: 'mcp_discovery_page_limit_exceeded', details: {maxPages: 64}});
    expect(pages).toBe(64);
  });
});

describe('mcp_client_error_labels', () => {
  it('labels thrown SDK McpError values as protocol errors', async () => {
    const transport = createMockMcpTransport();
    const sdkClient = new Client({name: 'error-label-test', version: '1'});
    const mcpClient = createMcpClient('error-label', {transport: 'http', url: 'http://loopback.test/mcp'}, {
      clientFactory: () => sdkClient,
      transportFactory: () => transport,
    });
    const connecting = mcpClient.connect({now: () => 1_000});
    await respondToRequest(transport, 'initialize', {protocolVersion: '2025-11-25', capabilities: {}, serverInfo: {name: 'loopback', version: '1'}});
    await connecting;
    sdkClient.callTool = async () => { throw new McpError(-32603, 'server rejected request'); };
    const result = await mcpClient.callTool('missing', {});
    await mcpClient.disconnect();
    expect(result.error).toContain('MCP protocol error');
    expect(result.error).toContain('server rejected request');
  });
});

describe('mcp_schema_fidelity_dispatch', () => {
  it('uses full inputSchema as authority for unions and numeric enums through provider and registry', async () => {
    const client = mockClient({tools: [tool('fidelity', {
      type: 'object',
      properties: {
        choice: {anyOf: [{type: 'string'}, {type: 'boolean'}]},
        level: {type: 'number', enum: [1, 2, 3]},
        union: {type: ['string', 'boolean']},
        count: {type: 'integer'},
      },
      required: ['choice', 'level', 'union', 'count'],
    })]});
    const provider = createMcpToolProvider(client);
    const registry = createToolRegistry();
    const definitions = await provider.discover();
    definitions.forEach((definition) => registry.register({
      definition,
      handler: async (params) => provider.execute(definition.name, params),
    }));

    const result = await registry.dispatch('mcp_mock_fidelity', {choice: true, level: 2, union: 'text', count: 4});

    expect(result).toEqual({success: true, output: 'ok'});
  });

  it('rejects a schema whose types are all unsupported with a precise diagnostic', async () => {
    const provider = createMcpToolProvider(mockClient({tools: [tool('unsupported', {type: 'object', properties: {value: {type: ['made-up', 'also-made-up']}}})]}));
    await expect(provider.discover()).rejects.toMatchObject({code: 'mcp_discovery_invalid_schema'});
    await expect(provider.discover()).rejects.toThrow('supported type names');
  });
});

describe('mcp_generation_collision_atomicity', () => {
  it('rejects duplicate identical original names with a typed error', async () => {
    const provider = createMcpToolProvider(mockClient({tools: [tool('same', {type: 'object'}), tool('same', {type: 'object'})]}));
    await expect(provider.discover()).rejects.toMatchObject({code: 'mcp_discovery_duplicate_tool'});
  });

  it('rejects normalized collisions before registration and swaps complete snapshots', async () => {
    const client = mockClient({tools: [tool('a-b', {type: 'object'}), tool('a_b', {type: 'object'})]});
    const provider = createMcpToolProvider(client);
    await expect(provider.discover()).rejects.toMatchObject({code: 'mcp_discovery_name_collision'});
    expect(provider.generation()).toBe(0);
    const registry = createToolRegistry();
    expect(() => publishMcpRegistrations(registry, [])).not.toThrow();
  });

  it('rejects stale handles explicitly', async () => {
    let tools = [tool('same', {type: 'object'})];
    const client = mockClient();
    client.listTools = async () => tools;
    const provider = createMcpToolProvider(client);
    const first = await provider.discoverRegistrations();
    await provider.discover();
    const stale = first[0]!.handler;
    expect((await stale({})).error).toContain('stale MCP tool handle');
  });
});

describe('mcp_nested_schema_and_result_semantics', () => {
  it('retains nested unions, arrays, and enums without coercing the schema', async () => {
    const schema = {type: 'object', properties: {items: {type: 'array', items: {anyOf: [{type: 'string'}, {type: 'number'}]}}, status: {enum: ['open', 'closed']}}, required: ['items', 'status']};
    const provider = createMcpToolProvider(mockClient({tools: [tool('nested', schema)]}));
    const definitions = await provider.discover();
    expect(definitions[0]?.inputSchema).toEqual(schema);
    expect(definitions[0]?.parameters.find((parameter) => parameter.name === 'items')?.type).toBe('array');
  });

  it('preserves isError and explicit descriptors for structured/image/resource content', () => {
    const result = mapMcpToolResult([
      {type: 'text', text: 'failed'},
      {type: 'image', data: 'abc', mimeType: 'image/png'},
      {type: 'resource', resource: {uri: 'file://x', text: 'body'}},
      {type: 'resource_link', uri: 'file://y', name: 'y'},
    ], true, {key: 'value'});
    expect(result.isError).toBe(true);
    expect(result.success).toBe(false);
    expect(result.content.map((item) => item.type)).toEqual(['text', 'image', 'resource', 'resource_link']);
    expect(result.structuredContent).toBe('{"key":"value"}');
  });

  it('rejects malformed or unsupported schemas before replacing the prior generation', async () => {
    let schema: Record<string, unknown> = {type: 'object'};
    const client = mockClient();
    client.listTools = async () => [tool('checked', schema)];
    const provider = createMcpToolProvider(client);
    await provider.discover();
    schema = {type: 'object', properties: {value: {type: 'string', pattern: '['}}};
    await expect(provider.discover()).rejects.toMatchObject({code: 'mcp_discovery_invalid_schema'});
    expect(provider.generation()).toBe(1);
  });

  for (const [keyword, keywordValue] of [
    ['allOf', [{type: 'object'}]],
    ['patternProperties', { '^x-': {type: 'string'} }],
    ['prefixItems', [{type: 'string'}]],
    ['dependencies', {legacy: ['replacement']}],
  ] as const) {
    it(`rejects unsupported ${keyword} schemas without replacing the prior generation`, async () => {
      let schema: Record<string, unknown> = {type: 'object'};
      const client = mockClient();
      client.listTools = async () => [tool('checked', schema)];
      const provider = createMcpToolProvider(client);
      await provider.discover();

      schema = {type: 'object', [keyword]: keywordValue};
      await expect(provider.discover()).rejects.toThrow(`$.${keyword}: keyword is not supported safely by registry validation`);
      expect(provider.generation()).toBe(1);
      expect((await provider.execute('mcp_mock_checked', {})).success).toBe(true);
    });
  }
});

describe('mcp_publication_rollback_quarantine', () => {
  it('quarantines installed names, releases every reservation, and preserves the provider generation after mid-publication failure', async () => {
    const registry = createToolRegistry();
    const original = registry.replaceReserved;
    const released: Array<string> = [];
    const quarantined: Array<string> = [];
    const faultyRegistry: ToolRegistry = {
      ...registry,
      reserve: (name, options) => registry.reserve?.(name, options),
      release: (name) => {
        released.push(name);
        registry.release?.(name);
      },
      replaceReserved: (name, tool) => {
        if (name.endsWith('second')) throw new Error('injected publication failure');
        original?.(name, tool);
      },
      quarantine: (name, reason) => {
        quarantined.push(name);
        registry.quarantine?.(name, reason);
        if (name.endsWith('first')) throw new Error('injected quarantine failure');
      },
    };
    const provider = createMcpToolProvider(mockClient({serverName: 'server', tools: [tool('first', {type: 'object'}), tool('second', {type: 'object'})]}));
    const registrations = await provider.discoverRegistrations();

    let publicationError: unknown = null;
    try {
      publishMcpRegistrations(faultyRegistry, registrations);
    } catch (error) {
      publicationError = error;
    }

    expect(publicationError).toBeInstanceOf(AggregateError);
    if (publicationError instanceof AggregateError) {
      expect(publicationError.cause).toBeInstanceOf(Error);
      expect(String(publicationError.cause)).toContain('injected publication failure');
      expect(publicationError.errors.map((error) => String(error))).toEqual(['Error: injected publication failure', 'Error: injected quarantine failure']);
    }
    expect(quarantined).toEqual(['mcp_server_first']);
    expect(faultyRegistry.getQuarantines?.()).toEqual([{name: 'mcp_server_first', reason: 'MCP registration publication failed: injected publication failure'}]);
    expect(released).toEqual(['mcp_server_first', 'mcp_server_second']);
    expect(faultyRegistry.getDefinitions()).toHaveLength(0);
    expect(provider.generation()).toBe(1);
    expect((await provider.execute('mcp_server_first', {})).success).toBe(true);
  });
});

describe('startup_skips_failed_server_continues_next', () => {
  it('closes a failed server and continues with the next server with visible summary', async () => {
    const disconnects: Array<boolean> = [];
    const result = await connectMcpServers([
      mockClient({serverName: 'first', failConnect: true, disconnects}),
      mockClient({serverName: 'second'}),
    ]);
    expect(result.connected.map((client) => client.serverName)).toEqual(['second']);
    expect(result.failed[0]?.name).toBe('first');
    expect(result.summary).toContain('first');
    expect(disconnects).toHaveLength(1);
  });
});
