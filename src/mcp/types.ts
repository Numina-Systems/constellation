// Type definitions only — no runtime behaviour

import type { ToolHandler, ToolResult } from '@/tool/types.ts';
import type { ExecutionOptions } from '@/contracts/execution.ts';

export const MCP_DEFAULT_DISCOVERY_TIMEOUT_MS = 30_000;
export const MCP_DEFAULT_MAX_PAGES = 64;
export const MCP_MAX_CONTENT_BYTES = 64 * 1024;
export const MCP_MAX_CONTENT_BLOCKS = 128;

export type McpDiscoveryOptions = Readonly<{
  /** Caller cancellation. */
  readonly signal?: AbortSignal;
  /** Absolute epoch-millisecond deadline for the whole operation. */
  readonly deadline?: number;
  /** Maximum number of pages for one list operation. */
  readonly maxPages?: number;
  /** Injectable clock for deterministic deadline tests. */
  readonly now?: () => number;
}>;

export type McpDiscoveryCode =
  | 'mcp_discovery_aborted'
  | 'mcp_discovery_deadline_exceeded'
  | 'mcp_discovery_page_limit_exceeded'
  | 'mcp_discovery_repeated_cursor'
  | 'mcp_discovery_stale_attempt'
  | 'mcp_discovery_invalid_schema'
  | 'mcp_discovery_name_collision'
  | 'mcp_discovery_duplicate_tool'
  | 'mcp_discovery_transport_error';

export type McpDiscoveryDetails = Readonly<Record<string, string | number | boolean>>;

export class McpDiscoveryError extends Error {
  readonly code: McpDiscoveryCode;
  readonly details: McpDiscoveryDetails;

  constructor(code: McpDiscoveryCode, message: string, details: McpDiscoveryDetails = {}, options?: ErrorOptions) {
    super(message, options);
    this.name = 'McpDiscoveryError';
    this.code = code;
    this.details = details;
  }
}

export type McpToolInfo = Readonly<{
  name: string;
  description: string | undefined;
  inputSchema: Readonly<Record<string, unknown>>;
}>;

export type McpPromptInfo = Readonly<{
  name: string;
  description: string | undefined;
  arguments: ReadonlyArray<{
    readonly name: string;
    readonly description: string | undefined;
    readonly required: boolean | undefined;
  }>;
}>;

export type McpPromptResult = Readonly<{
  description: string | undefined;
  messages: ReadonlyArray<{
    readonly role: 'user' | 'assistant';
    readonly content: string;
  }>;
}>;

export type McpTextContentDescriptor = Readonly<{
  readonly type: 'text';
  readonly text: string;
  readonly truncated: boolean;
}>;

export type McpImageContentDescriptor = Readonly<{
  readonly type: 'image' | 'audio';
  readonly data: string;
  readonly mimeType: string;
  readonly truncated: boolean;
}>;

export type McpResourceContentDescriptor = Readonly<{
  readonly type: 'resource';
  readonly uri: string;
  readonly mimeType: string | null;
  readonly text: string | null;
  readonly blob: string | null;
  readonly truncated: boolean;
}>;

export type McpResourceLinkContentDescriptor = Readonly<{
  readonly type: 'resource_link';
  readonly uri: string;
  readonly name: string;
  readonly mimeType: string | null;
}>;

export type McpUnknownContentDescriptor = Readonly<{
  readonly type: 'unknown';
  readonly originalType: string;
}>;

export type McpContentDescriptor =
  | McpTextContentDescriptor
  | McpImageContentDescriptor
  | McpResourceContentDescriptor
  | McpResourceLinkContentDescriptor
  | McpUnknownContentDescriptor;

export type McpToolResult = ToolResult & Readonly<{
  /** The result-level MCP flag, retained even when text output is empty. */
  readonly isError: boolean;
  /** Bounded descriptors for every received content block. */
  readonly content: ReadonlyArray<McpContentDescriptor>;
  /** Bounded structured content, when returned by the server. */
  readonly structuredContent: string | null;
  /** Provider-neutral typed outcome for callers that understand it. */
  readonly outcome: Readonly<{
    readonly kind: 'success' | 'error';
    readonly code: 'mcp_result_success' | 'mcp_result_error' | 'mcp_transport_error' | 'mcp_not_connected';
    readonly message: string;
  }>;
}>;

export type McpToolDefinition = Readonly<{
  readonly name: string;
  readonly description: string;
  readonly parameters: ReadonlyArray<import('@/tool/types.ts').ToolParameter>;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly generation: number;
  readonly originalName: string;
}>;

export type McpToolRegistration = Readonly<{
  readonly definition: McpToolDefinition;
  readonly handler: ToolHandler;
}>;

/** Behavioural contract for MCP clients. */
export interface McpClient {
  readonly serverName: string;
  connect(options?: McpDiscoveryOptions): Promise<void>;
  disconnect(): Promise<void>;
  listTools(options?: McpDiscoveryOptions): Promise<Array<McpToolInfo>>;
  callTool(name: string, args: Record<string, unknown>, options?: ExecutionOptions): Promise<ToolResult>;
  listPrompts(options?: McpDiscoveryOptions): Promise<Array<McpPromptInfo>>;
  getPrompt(name: string, args?: Record<string, string>, options?: McpDiscoveryOptions): Promise<McpPromptResult>;
  getInstructions(): Promise<string | undefined>;
}
