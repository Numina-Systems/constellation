// pattern: Imperative Shell

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import type { ExecutionOptions } from '@/contracts/execution.ts';
import type { ToolResult } from '@/tool/types.ts';
import type { McpServerConfig } from './schema.ts';
import { collectMcpPages } from './discovery-bounds.ts';
import {
  MCP_DEFAULT_DISCOVERY_TIMEOUT_MS,
  MCP_MAX_CONTENT_BLOCKS,
  MCP_MAX_CONTENT_BYTES,
  McpDiscoveryError,
  type McpClient,
  type McpContentDescriptor,
  type McpDiscoveryOptions,
  type McpImageContentDescriptor,
  type McpPromptInfo,
  type McpPromptResult,
  type McpResourceContentDescriptor,
  type McpResourceLinkContentDescriptor,
  type McpTextContentDescriptor,
  type McpToolInfo,
  type McpToolResult,
  type McpUnknownContentDescriptor,
} from './types.ts';

type TransportOptions =
  | {readonly type: 'stdio'; readonly command: string; readonly args: ReadonlyArray<string>; readonly env: Record<string, string | undefined>}
  | {readonly type: 'http'; readonly url: URL};

type JsonRecord = Record<string, unknown>;
export type McpClientConstructionOptions = Readonly<{
  readonly clientFactory?: () => Client;
  readonly transportFactory?: (config: McpServerConfig, processEnv: Readonly<Record<string, string | undefined>>) => Transport;
}>;

export function buildTransportOptions(config: McpServerConfig, processEnv: Readonly<Record<string, string | undefined>>): TransportOptions {
  if (config.transport === 'stdio') return {type: 'stdio', command: config.command, args: [...config.args], env: {...processEnv, ...config.env}};
  if (config.transport === 'http') return {type: 'http', url: new URL(config.url)};
  const _exhaustive: never = config;
  return _exhaustive;
}

/** Legacy text projection retained for existing consumers. Non-text blocks are not silently dropped by mapMcpToolResult. */
export function mapToolResult(content: ReadonlyArray<{readonly type: string; readonly text?: string}>, isError: boolean | undefined): ToolResult {
  const text = content.filter((block): block is {readonly type: 'text'; readonly text: string} => block.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('\n');
  return isError ? {success: false, output: text, error: text} : {success: true, output: text};
}

/** Maps all supported MCP content blocks into bounded, explicit descriptors. */
export function mapMcpToolResult(content: ReadonlyArray<unknown>, isError: boolean | undefined, structuredContent: unknown): McpToolResult {
  const boundedContent = content.slice(0, MCP_MAX_CONTENT_BLOCKS).map((block) => mapContentDescriptor(block));
  const text = boundedContent.filter((block): block is McpTextContentDescriptor => block.type === 'text').map((block) => block.text).join('\n');
  const resultIsError = isError === true;
  const message = text.slice(0, 4096);
  const outcome = resultIsError
    ? {kind: 'error' as const, code: 'mcp_result_error' as const, message}
    : {kind: 'success' as const, code: 'mcp_result_success' as const, message: ''};
  return {
    success: !resultIsError,
    output: text,
    ...(resultIsError ? {error: text} : {}),
    isError: resultIsError,
    content: boundedContent,
    structuredContent: boundedJsonDescriptor(structuredContent),
    outcome,
  };
}

export function createMcpClient(serverName: string, config: McpServerConfig, constructionOptions: McpClientConstructionOptions = {}): McpClient {
  let sdkClient: Client | null = null;
  let connected = false;

  function getRequestOptions(options: McpDiscoveryOptions | ExecutionOptions = {}): RequestOptions {
    const now = 'now' in options ? (options.now ?? (() => Date.now())) : (() => Date.now());
    const deadline = options.deadline ?? now() + MCP_DEFAULT_DISCOVERY_TIMEOUT_MS;
    const remaining = Math.max(0, deadline - now());
    if (remaining <= 0) throw new McpDiscoveryError('mcp_discovery_deadline_exceeded', `MCP ${serverName} discovery deadline exceeded`, {server: serverName});
    const timeout = Math.max(1, Math.ceil(remaining));
    return {signal: options.signal, timeout, maxTotalTimeout: timeout};
  }

  function requireClient(): Client {
    if (!sdkClient || !connected) throw new McpDiscoveryError('mcp_discovery_transport_error', `MCP ${serverName} is not connected`, {server: serverName});
    return sdkClient;
  }

  return {
    serverName,
    async connect(options?: McpDiscoveryOptions): Promise<void> {
      sdkClient = constructionOptions.clientFactory?.() ?? new Client({name: 'constellation', version: '1.0.0'});
      const transportOptions = buildTransportOptions(config, process.env);
      const transport = constructionOptions.transportFactory?.(config, process.env) ?? (transportOptions.type === 'stdio'
        ? new StdioClientTransport({command: transportOptions.command, args: [...transportOptions.args], env: Object.fromEntries(Object.entries(transportOptions.env).filter((entry): entry is [string, string] => entry[1] !== undefined))})
        : new StreamableHTTPClientTransport(transportOptions.url));
      sdkClient.onerror = () => { console.error(`[mcp:${serverName}] MCP protocol error`); };
      sdkClient.onclose = () => { connected = false; };
      try {
        await sdkClient.connect(transport, getRequestOptions(options));
        connected = true;
      } catch (error) {
        connected = false;
        await Promise.resolve(sdkClient.close()).catch(() => undefined);
        sdkClient = null;
        if (error instanceof McpDiscoveryError) throw error;
        throw new McpDiscoveryError('mcp_discovery_transport_error', `MCP ${serverName} connection failed`, {server: serverName});
      }
    },
    async disconnect(): Promise<void> {
      if (sdkClient !== null) {
        const client = sdkClient;
        sdkClient = null;
        connected = false;
        await client.close().catch(() => undefined);
      }
    },
    async listTools(options?: McpDiscoveryOptions): Promise<Array<McpToolInfo>> {
      if (!connected) return [];
      const client = requireClient();
      return collectMcpPages(async (cursor, timeoutMs, signal) => {
        const result = await client.listTools(cursor === undefined ? undefined : {cursor}, {signal, timeout: timeoutMs, maxTotalTimeout: timeoutMs});
        return {items: result.tools.map((tool) => ({name: tool.name, description: tool.description, inputSchema: deepFreeze(cloneJson(tool.inputSchema) as Record<string, unknown>)})), nextCursor: result.nextCursor};
      }, options);
    },
    async callTool(name: string, args: Record<string, unknown>, options?: ExecutionOptions): Promise<ToolResult> {
      if (!connected) return {success: false, output: '', error: `[mcp:${serverName}] not connected`};
      try {
        const executionOptions = options ?? {};
        const requestOptions = getRequestOptions(executionOptions);
        const result = await requireClient().callTool({name, arguments: args}, undefined, requestOptions);
        if (!isRecord(result) || !Array.isArray(result['content'])) return {success: false, output: '', error: 'MCP tool returned a task result'};
        return mapMcpToolResult(result['content'], typeof result['isError'] === 'boolean' ? result['isError'] : false, result['structuredContent']);
      } catch (error) {
        if (error instanceof McpDiscoveryError) return {success: false, output: '', error: error.message};
        if (error instanceof McpError) return {success: false, output: '', error: `MCP protocol error: ${safeErrorMessage(error)}`};
        return {success: false, output: '', error: `MCP transport error: ${safeErrorMessage(error)}`};
      }
    },
    async listPrompts(options?: McpDiscoveryOptions): Promise<Array<McpPromptInfo>> {
      if (!connected) return [];
      const client = requireClient();
      return collectMcpPages(async (cursor, timeoutMs, signal) => {
        const result = await client.listPrompts(cursor === undefined ? undefined : {cursor}, {signal, timeout: timeoutMs, maxTotalTimeout: timeoutMs});
        return {items: result.prompts.map((prompt) => ({name: prompt.name, description: prompt.description, arguments: (prompt.arguments ?? []).map((argument) => ({name: argument.name, description: argument.description, required: argument.required}))})), nextCursor: result.nextCursor};
      }, options);
    },
    async getPrompt(name: string, args?: Record<string, string>, options?: McpDiscoveryOptions): Promise<McpPromptResult> {
      if (!connected) return {description: undefined, messages: []};
      const result = await requireClient().getPrompt({name, arguments: args}, getRequestOptions(options));
      return {description: result.description, messages: result.messages.map((message) => ({role: message.role, content: message.content.type === 'text' ? message.content.text : `[MCP ${message.content.type} content]`}))};
    },
    async getInstructions(): Promise<string | undefined> {
      if (!connected) return undefined;
      return requireClient().getInstructions();
    },
  };
}

function mapContentDescriptor(value: unknown): McpContentDescriptor {
  if (!isRecord(value) || typeof value['type'] !== 'string') return {type: 'unknown', originalType: 'invalid'} satisfies McpUnknownContentDescriptor;
  const type = value['type'];
  if (type === 'text' && typeof value['text'] === 'string') return {type: 'text', text: boundText(value['text']), truncated: byteLength(value['text']) > MCP_MAX_CONTENT_BYTES};
  if ((type === 'image' || type === 'audio') && typeof value['data'] === 'string' && typeof value['mimeType'] === 'string') return {type, data: boundText(value['data']), mimeType: value['mimeType'].slice(0, 256), truncated: byteLength(value['data']) > MCP_MAX_CONTENT_BYTES} satisfies McpImageContentDescriptor;
  if (type === 'resource' && isRecord(value['resource']) && typeof value['resource']['uri'] === 'string') {
    const resource = value['resource'];
    const uri = resource['uri'];
    const resourceText = resource['text'];
    const resourceBlob = resource['blob'];
    return {type, uri: typeof uri === 'string' ? uri : '[invalid resource uri]', mimeType: typeof resource['mimeType'] === 'string' ? resource['mimeType'].slice(0, 256) : null, text: typeof resourceText === 'string' ? boundText(resourceText) : null, blob: typeof resourceBlob === 'string' ? boundText(resourceBlob) : null, truncated: typeof resourceText === 'string' ? byteLength(resourceText) > MCP_MAX_CONTENT_BYTES : typeof resourceBlob === 'string' && byteLength(resourceBlob) > MCP_MAX_CONTENT_BYTES} satisfies McpResourceContentDescriptor;
  }
  if (type === 'resource_link' && typeof value['uri'] === 'string' && typeof value['name'] === 'string') return {type, uri: value['uri'], name: value['name'].slice(0, 512), mimeType: typeof value['mimeType'] === 'string' ? value['mimeType'].slice(0, 256) : null} satisfies McpResourceLinkContentDescriptor;
  return {type: 'unknown', originalType: type.slice(0, 64)} satisfies McpUnknownContentDescriptor;
}
function boundedJsonDescriptor(value: unknown): string | null {
  if (value === undefined) return null;
  try { return boundText(JSON.stringify(value)); } catch { return '[structured content unavailable]'; }
}
function boundText(value: string): string { return new TextDecoder().decode(new TextEncoder().encode(value).slice(0, MCP_MAX_CONTENT_BYTES)); }
function byteLength(value: string): number { return new TextEncoder().encode(value).byteLength; }
function safeErrorMessage(error: unknown): string { return error instanceof Error ? error.message.slice(0, 256) : 'request failed'; }
function isRecord(value: unknown): value is JsonRecord { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function cloneJson(value: unknown): unknown { return JSON.parse(JSON.stringify(value)) as unknown; }
function deepFreeze<T>(value: T): T { if (typeof value === 'object' && value !== null) { Object.freeze(value); for (const child of Object.values(value as JsonRecord)) deepFreeze(child); } return value; }
