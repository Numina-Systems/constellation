// pattern: Imperative Shell

/**
 * ToolRegistry implementation.
 * Manages tool registration, parameter validation, dispatch, and code generation for the Deno runtime bridge.
 */

import type {
  Tool,
  ToolDefinition,
  ToolParameter,
  ToolParameterType,
  ToolResult,
  ToolRegistry,
} from './types.ts';

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, Tool>();

  function validateParameterType(
    value: unknown,
    expectedType: ToolParameterType,
  ): boolean {
    const actualType = typeof value;

    switch (expectedType) {
      case 'string':
        return actualType === 'string';
      case 'number':
        return actualType === 'number';
      case 'boolean':
        return actualType === 'boolean';
      case 'object':
        return actualType === 'object' && value !== null && !Array.isArray(value);
      case 'array':
        return Array.isArray(value);
      default:
        return false;
    }
  }

  function formatParameterType(type: ToolParameterType): string {
    switch (type) {
      case 'string':
        return 'string';
      case 'number':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'object':
        return 'object';
      case 'array':
        return 'array';
      default:
        return 'unknown';
    }
  }

  function generateParameterSignature(params: ReadonlyArray<ToolParameter>): string {
    if (params.length === 0) {
      return '{}';
    }

    const paramParts = params.map((param) => {
      const type = formatParameterType(param.type);
      const optional = param.required ? '' : '?';
      return `${param.name}${optional}: ${type}`;
    });

    return `{ ${paramParts.join(', ')} }`;
  }

  return {
    register(tool: Tool): void {
      if (tools.has(tool.definition.name)) {
        throw new Error(
          `tool already registered: ${tool.definition.name}`,
        );
      }
      tools.set(tool.definition.name, tool);
    },

    getDefinitions(): Array<ToolDefinition> {
      return Array.from(tools.values()).map((tool) => tool.definition);
    },

    async dispatch(
      name: string,
      params: Record<string, unknown>,
    ): Promise<ToolResult> {
      const tool = tools.get(name);
      if (!tool) {
        return {
          success: false,
          output: '',
          error: `unknown tool: ${name}`,
        };
      }

      // Validate required parameters
      for (const param of tool.definition.parameters) {
        if (param.required && !(param.name in params)) {
          return {
            success: false,
            output: '',
            error: `missing required parameter: ${param.name}`,
          };
        }
      }

      // Validate parameter types
      for (const param of tool.definition.parameters) {
        if (param.name in params) {
          const value = params[param.name];
          if (!validateParameterType(value, param.type)) {
            return {
              success: false,
              output: '',
              error: `invalid type for parameter ${param.name}: expected ${param.type}, got ${typeof value}`,
            };
          }
        }
      }

      try {
        const result = await tool.handler(params);
        return result;
      } catch (error) {
        return {
          success: false,
          output: '',
          error: `handler error: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },

    generateStubs(): string {
      const stubs = Array.from(tools.values()).map((tool) => {
        const paramSig = generateParameterSignature(tool.definition.parameters);
        return `async function ${tool.definition.name}(params: ${paramSig}): Promise<unknown> {
  return __callTool__("${tool.definition.name}", params);
}`;
      });

      return stubs.join('\n\n');
    },

    toModelTools(): Array<{
      name: string;
      description: string;
      input_schema: Record<string, unknown>;
    }> {
      return Array.from(tools.values()).map((tool) => {
        const properties: Record<string, unknown> = {};
        const required: Array<string> = [];

        for (const param of tool.definition.parameters) {
          properties[param.name] = {
            type: param.type,
            description: param.description,
            ...(param.enum_values && { enum: param.enum_values }),
          };

          if (param.required) {
            required.push(param.name);
          }
        }

        return {
          name: tool.definition.name,
          description: tool.definition.description,
          input_schema: {
            type: 'object',
            properties,
            required,
          },
        };
      });
    },
  };
}
