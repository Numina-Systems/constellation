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
};

export type ToolResult = {
  success: boolean;
  output: string;
  error?: string;
};

export type ToolHandler = (params: Record<string, unknown>) => Promise<ToolResult>;

export type Tool = {
  definition: ToolDefinition;
  handler: ToolHandler;
};

export interface ToolRegistry {
  register(tool: Tool): void;
  getDefinitions(): Array<ToolDefinition>;
  dispatch(name: string, params: Record<string, unknown>): Promise<ToolResult>;
  generateStubs(): string;
  toModelTools(): Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
}
