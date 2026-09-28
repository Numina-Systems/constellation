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
import {
  isJavaScriptIdentifier,
  validateExecutableTool,
  validateInput,
  validationMessage,
} from '@/custom-tool/validation.js';

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, Tool>();
  const reservations = new Set<string>();
  const quarantines = new Map<string, string>();

  function validateTool(tool: Tool, allowExistingName = false): Tool {
    const existingNames = new Set(tools.keys());
    if (allowExistingName) existingNames.delete(tool.definition.name);
    const result = validateExecutableTool(tool, {existingNames});
    if (!result.valid) throw new Error(`invalid tool definition: ${validationMessage(result)}`);
    return result.value;
  }

  // Identity function to format parameter types for stub generation
  // Kept as separate function for future extensibility (e.g., custom type mappings)
  function formatParameterType(type: ToolParameterType): string {
    return type;
  }

  function generateParameterSignature(params: ReadonlyArray<ToolParameter>): string {
    if (params.length === 0) return '{}';
    const paramParts = params.map((param) => {
      const type = formatParameterType(param.type);
      const optional = param.required ? '' : '?';
      return `${param.name}${optional}: ${type}`;
    });
    return `{ ${paramParts.join(', ')} }`;
  }

  return {
    register(tool: Tool): void {
      if (typeof tool.definition.name === 'string' && tools.has(tool.definition.name)) throw new Error(`tool already registered: ${tool.definition.name}`);
      if (typeof tool.definition.name === 'string' && quarantines.has(tool.definition.name)) throw new Error(`tool name is quarantined: ${tool.definition.name}`);
      const validated = validateTool(tool);
      if (reservations.has(validated.definition.name)) throw new Error(`tool name is reserved: ${validated.definition.name}`);
      if (tools.has(validated.definition.name)) throw new Error(`tool already registered: ${validated.definition.name}`);
      tools.set(validated.definition.name, validated);
      quarantines.delete(validated.definition.name);
    },

    reserve(name: string, options?: Readonly<{trustedRecovery?: boolean}>): void {
      if (!isJavaScriptIdentifier(name)) throw new Error(`invalid tool name: ${name}`);
      if (quarantines.has(name) && options?.trustedRecovery !== true) {
        throw new Error(`tool name is quarantined: ${name}`);
      }
      if (reservations.has(name)) throw new Error(`tool name is already reserved: ${name}`);
      reservations.add(name);
      if (options?.trustedRecovery === true) quarantines.delete(name);
    },

    release(name: string): void {
      reservations.delete(name);
    },

    replaceReserved(name: string, tool: Tool): void {
      if (!reservations.has(name)) throw new Error(`tool name is not reserved: ${name}`);
      if (tool.definition.name !== name) throw new Error(`reserved replacement name mismatch: ${name}`);
      const validated = validateTool(tool, true);
      tools.set(name, validated);
      reservations.delete(name);
      quarantines.delete(name);
    },

    quarantine(name: string, reason: string): void {
      tools.delete(name);
      reservations.delete(name);
      quarantines.set(name, reason.slice(0, 500));
    },

    getQuarantines(): ReadonlyArray<{name: string; reason: string}> {
      return Array.from(quarantines, ([name, reason]) => ({name, reason}));
    },

    unregister(name: string): boolean {
      if (quarantines.has(name)) throw new Error(`cannot unregister quarantined tool: ${name}`);
      reservations.delete(name);
      return tools.delete(name);
    },

    getDefinitions(): Array<ToolDefinition> {
      return Array.from(tools.values()).map((tool) => tool.definition);
    },

    async dispatch(
      name: string,
      params: Record<string, unknown>,
      options?: import('@/contracts/execution.ts').ExecutionOptions,
    ): Promise<ToolResult> {
      const tool = tools.get(name);
      if (!tool) {
        return {
          success: false,
          output: '',
          error: `unknown tool: ${name}`,
        };
      }

      const inputError = validateInput(tool.definition, params);
      if (inputError !== null) return {success: false, output: '', error: inputError};

      try {
        const result = await tool.handler(params, options);
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
      const needsArrayAlias = Array.from(tools.values()).some((tool) => tool.definition.parameters.some((parameter) => parameter.type === 'array'));
      const stubs = Array.from(tools.values()).map((tool) => {
        const paramSig = generateParameterSignature(tool.definition.parameters);
        return `async function ${tool.definition.name}(params: ${paramSig}): Promise<unknown> {
  return __callTool__("${tool.definition.name}", params);
}`;
      });

      return `${needsArrayAlias ? 'type array = unknown[];\n\n' : ''}${stubs.join('\n\n')}`;
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
          input_schema: tool.definition.inputSchema ?? {
            type: 'object',
            properties,
            required,
          },
        };
      });
    },
  };
}
