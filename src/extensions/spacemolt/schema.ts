// pattern: Functional Core

import type { ToolDefinition, ToolParameter, ToolParameterType } from '@/tool/types.ts';

export type McpTool = {
  name: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties?: Record<
      string,
      {
        type?: string;
        description?: string;
        enum?: ReadonlyArray<string>;
      }
    >;
    required?: ReadonlyArray<string>;
  };
};

function mapJsonSchemaTypeToToolType(
  jsonSchemaType: string | undefined
): ToolParameterType {
  switch (jsonSchemaType) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
      return 'object';
    case 'array':
      return 'array';
    default:
      return 'string';
  }
}

export function translateMcpTool(
  mcpTool: Readonly<McpTool>,
  prefix: string
): ToolDefinition {
  const properties = mcpTool.inputSchema.properties ?? {};
  const requiredSet = new Set(mcpTool.inputSchema.required ?? []);

  const parameters: Array<ToolParameter> = Object.entries(properties).map(
    ([propertyName, propertySchema]) => ({
      name: propertyName,
      type: mapJsonSchemaTypeToToolType(propertySchema.type),
      description: propertySchema.description ?? '',
      required: requiredSet.has(propertyName),
      ...(propertySchema.enum && {
        enum_values: propertySchema.enum,
      }),
    })
  );

  return {
    name: `${prefix}${mcpTool.name}`,
    description: mcpTool.description ?? '',
    parameters,
  };
}

export function flattenMcpContent(
  content: ReadonlyArray<{ type: string; text?: string }>
): string {
  const textBlocks = content
    .filter((block) => block.type === 'text' && block.text !== undefined)
    .map((block) => block.text ?? '');

  return textBlocks.join('\n');
}
