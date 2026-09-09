// pattern: Functional Core

/**
 * Tool system types for registration, dispatch, and model integration.
 * These types define the port interface for the tool registry and tool handlers.
 */

export type ToolParameterType = 'string' | 'number' | 'boolean' | 'object' | 'array';

export type ToolParameter = {
  name: string;
  type: ToolParameterType;
  description: string;
  required: boolean;
  enum_values?: ReadonlyArray<string>;
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: ReadonlyArray<ToolParameter>;
  /** Complete JSON Schema when structured/nested input validation is required. */
  inputSchema?: Readonly<Record<string, unknown>>;
};

export type ToolResult = {
  success: boolean;
  output: string;
  error?: string;
};

import type {ExecutionOptions} from '@/contracts/execution.ts';

export type ToolHandler = (
  params: Record<string, unknown>,
  options?: ExecutionOptions,
) => Promise<ToolResult>;

export type Tool = {
  definition: ToolDefinition;
  handler: ToolHandler;
};

export interface ToolRegistry {
  register(tool: Tool): void;
  reserve?(name: string, options?: Readonly<{trustedRecovery?: boolean}>): void;
  release?(name: string): void;
  replaceReserved?(name: string, tool: Tool): void;
  quarantine?(name: string, reason: string): void;
  getQuarantines?(): ReadonlyArray<{name: string; reason: string}>;
  unregister(name: string): boolean;
  getDefinitions(): Array<ToolDefinition>;
  dispatch(
    name: string,
    params: Record<string, unknown>,
    options?: ExecutionOptions,
  ): Promise<ToolResult>;
  generateStubs(): string;
  toModelTools(): Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
}
