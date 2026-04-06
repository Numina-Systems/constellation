// pattern: Functional Core

import type { ToolParameter } from '@/tool/types.js';

/**
 * Converts MCP tool inputSchema (JSON Schema format) to Constellation's ToolParameter[].
 *
 * Handles JSON Schema type mapping, required field detection, enum conversion,
 * and sensible defaults for missing fields.
 */
export function mapInputSchemaToParameters(
  inputSchema: Readonly<Record<string, unknown>>,
): Array<ToolParameter> {
  // Extract properties from schema, defaulting to empty object
  const properties = (inputSchema['properties'] ??
    {}) as Readonly<Record<string, unknown>>;

  // Extract required array from schema, defaulting to empty array
  const required = (inputSchema['required'] ??
    []) as ReadonlyArray<string>;

  const requiredSet = new Set(required);

  // Build parameters from each property
  const parameters: Array<ToolParameter> = [];

  for (const [name, propertySchema] of Object.entries(properties)) {
    if (typeof propertySchema !== 'object' || propertySchema === null) {
      continue;
    }

    // Narrowed by typeof + null check above
    const prop = propertySchema as Record<string, unknown>;

    // Map JSON Schema type to ToolParameterType
    const jsonSchemaType = prop['type'] as string | undefined;
    let type: 'string' | 'number' | 'boolean' | 'object' | 'array' = 'string';

    if (jsonSchemaType === 'string') {
      type = 'string';
    } else if (jsonSchemaType === 'number' || jsonSchemaType === 'integer') {
      type = 'number';
    } else if (jsonSchemaType === 'boolean') {
      type = 'boolean';
    } else if (jsonSchemaType === 'object') {
      type = 'object';
    } else if (jsonSchemaType === 'array') {
      type = 'array';
    }
    // else: unknown type defaults to 'string'

    // Extract description, defaulting to empty string
    const description = (prop['description'] ?? '') as string;

    // Determine if required
    const isRequired = requiredSet.has(name);

    // Extract enum values if present
    const enum_values = ((): ReadonlyArray<string> | undefined => {
      const enumArray = prop['enum'];
      if (Array.isArray(enumArray)) {
        return enumArray.map(v => String(v));
      }
      return undefined;
    })();

    const parameter: ToolParameter = {
      name,
      type,
      description,
      required: isRequired,
    };

    // Add enum_values if present
    if (enum_values !== undefined) {
      parameter.enum_values = enum_values;
    }

    parameters.push(parameter);
  }

  return parameters;
}
