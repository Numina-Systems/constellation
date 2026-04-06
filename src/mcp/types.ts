// pattern: Functional Core (type definitions only)

import type { ToolResult } from '@/tool/types.js';

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

/**
 * Behavioural contract for MCP (Model Context Protocol) clients.
 * Manages connection lifecycle, tool discovery, prompt discovery, and tool execution
 * against external MCP servers.
 */
export interface McpClient {
  readonly serverName: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): Promise<Array<McpToolInfo>>;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  listPrompts(): Promise<Array<McpPromptInfo>>;
  getPrompt(name: string, args?: Record<string, string>): Promise<McpPromptResult>;
  getInstructions(): Promise<string | undefined>;
}
