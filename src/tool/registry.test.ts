// pattern: Imperative Shell

import { describe, it, expect } from 'bun:test';
import { createToolRegistry } from './registry.ts';
import type { Tool } from './types.ts';

describe('ToolRegistry', () => {
  describe('registration', () => {
    it('should register a tool and include it in getDefinitions', () => {
      const registry = createToolRegistry();

      const mockTool: Tool = {
        definition: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: [
            {
              name: 'query',
              type: 'string',
              description: 'A query string',
              required: true,
            },
          ],
        },
        handler: async () => ({ success: true, output: 'ok' }),
      };

      registry.register(mockTool);

      const definitions = registry.getDefinitions();
      expect(definitions.length).toBe(1);
      expect(definitions[0]?.name).toBe('test_tool');
    });

    it('should throw when registering duplicate tool name', () => {
      const registry = createToolRegistry();

      const mockTool: Tool = {
        definition: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: [],
        },
        handler: async () => ({ success: true, output: 'ok' }),
      };

      registry.register(mockTool);

      expect(() => {
        registry.register(mockTool);
      }).toThrow('tool already registered: test_tool');
    });
  });

  describe('dispatch', () => {
    it('should call handler with valid params and return result', async () => {
      const registry = createToolRegistry();

      let handlerCalled = false;
      let receivedParams: Record<string, unknown> | null = null;

      const mockTool: Tool = {
        definition: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: [
            {
              name: 'input',
              type: 'string',
              description: 'An input',
              required: true,
            },
          ],
        },
        handler: async (params) => {
          handlerCalled = true;
          receivedParams = params;
          return { success: true, output: 'processed' };
        },
      };

      registry.register(mockTool);

      const result = await registry.dispatch('test_tool', { input: 'hello' });

      expect(handlerCalled).toBe(true);
      if (receivedParams) {
        expect((receivedParams as Record<string, unknown>)['input']).toBe('hello');
      }
      expect(result.success).toBe(true);
      expect(result.output).toBe('processed');
    });

    it('should return error for unknown tool', async () => {
      const registry = createToolRegistry();

      const result = await registry.dispatch('unknown_tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('unknown tool');
    });

    it('should return error for missing required parameter', async () => {
      const registry = createToolRegistry();

      const mockTool: Tool = {
        definition: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: [
            {
              name: 'required_param',
              type: 'string',
              description: 'Required parameter',
              required: true,
            },
          ],
        },
        handler: async () => ({ success: true, output: 'ok' }),
      };

      registry.register(mockTool);

      const result = await registry.dispatch('test_tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('missing required parameter');
    });

    it('should return error for invalid parameter type', async () => {
      const registry = createToolRegistry();

      const mockTool: Tool = {
        definition: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: [
            {
              name: 'number_param',
              type: 'number',
              description: 'A number parameter',
              required: true,
            },
          ],
        },
        handler: async () => ({ success: true, output: 'ok' }),
      };

      registry.register(mockTool);

      const result = await registry.dispatch('test_tool', { number_param: 'not a number' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('invalid type');
    });

    it('should catch handler errors and wrap in ToolResult', async () => {
      const registry = createToolRegistry();

      const mockTool: Tool = {
        definition: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: [],
        },
        handler: async () => {
          throw new Error('handler crashed');
        },
      };

      registry.register(mockTool);

      const result = await registry.dispatch('test_tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('handler error');
      expect(result.error).toContain('handler crashed');
    });

    it('should allow optional parameters to be omitted', async () => {
      const registry = createToolRegistry();

      const mockTool: Tool = {
        definition: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: [
            {
              name: 'required_param',
              type: 'string',
              description: 'Required',
              required: true,
            },
            {
              name: 'optional_param',
              type: 'string',
              description: 'Optional',
              required: false,
            },
          ],
        },
        handler: async () => {
          return { success: true, output: 'ok' };
        },
      };

      registry.register(mockTool);

      const result = await registry.dispatch('test_tool', { required_param: 'hello' });

      expect(result.success).toBe(true);
    });

    it('should return error for invalid enum value', async () => {
      const registry = createToolRegistry();

      const mockTool: Tool = {
        definition: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: [
            {
              name: 'tier',
              type: 'string',
              description: 'Memory tier',
              required: true,
              enum_values: ['core', 'working', 'archival'],
            },
          ],
        },
        handler: async () => ({ success: true, output: 'ok' }),
      };

      registry.register(mockTool);

      const result = await registry.dispatch('test_tool', { tier: 'invalid' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('invalid value');
      expect(result.error).toContain('tier');
    });

    it('should accept valid enum value', async () => {
      const registry = createToolRegistry();

      const mockTool: Tool = {
        definition: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: [
            {
              name: 'tier',
              type: 'string',
              description: 'Memory tier',
              required: true,
              enum_values: ['core', 'working', 'archival'],
            },
          ],
        },
        handler: async () => ({ success: true, output: 'ok' }),
      };

      registry.register(mockTool);

      const result = await registry.dispatch('test_tool', { tier: 'core' });

      expect(result.success).toBe(true);
    });

    it('should allow omitting optional enum parameter', async () => {
      const registry = createToolRegistry();

      const mockTool: Tool = {
        definition: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: [
            {
              name: 'required_param',
              type: 'string',
              description: 'Required',
              required: true,
            },
            {
              name: 'tier',
              type: 'string',
              description: 'Memory tier',
              required: false,
              enum_values: ['core', 'working', 'archival'],
            },
          ],
        },
        handler: async () => ({ success: true, output: 'ok' }),
      };

      registry.register(mockTool);

      const result = await registry.dispatch('test_tool', { required_param: 'hello' });

      expect(result.success).toBe(true);
    });
  });

  describe('stub generation', () => {
    it('should generate function declarations for each tool', () => {
      const registry = createToolRegistry();

      const tool1: Tool = {
        definition: {
          name: 'memory_read',
          description: 'Read memory',
          parameters: [
            {
              name: 'query',
              type: 'string',
              description: 'Query',
              required: true,
            },
            {
              name: 'limit',
              type: 'number',
              description: 'Limit',
              required: false,
            },
          ],
        },
        handler: async () => ({ success: true, output: 'ok' }),
      };

      const tool2: Tool = {
        definition: {
          name: 'simple_tool',
          description: 'Simple tool',
          parameters: [],
        },
        handler: async () => ({ success: true, output: 'ok' }),
      };

      registry.register(tool1);
      registry.register(tool2);

      const stubs = registry.generateStubs();

      expect(stubs).toContain('async function memory_read');
      expect(stubs).toContain('async function simple_tool');
      expect(stubs).toContain('__callTool__("memory_read"');
      expect(stubs).toContain('__callTool__("simple_tool"');
      expect(stubs).toContain('query: string');
      expect(stubs).toContain('limit?: number');
    });

    it('should generate correct parameter signatures', () => {
      const registry = createToolRegistry();

      const tool: Tool = {
        definition: {
          name: 'test_tool',
          description: 'Test',
          parameters: [
            {
              name: 'str_param',
              type: 'string',
              description: 'String',
              required: true,
            },
            {
              name: 'bool_param',
              type: 'boolean',
              description: 'Boolean',
              required: false,
            },
            {
              name: 'arr_param',
              type: 'array',
              description: 'Array',
              required: false,
            },
          ],
        },
        handler: async () => ({ success: true, output: 'ok' }),
      };

      registry.register(tool);

      const stubs = registry.generateStubs();

      expect(stubs).toContain('str_param: string');
      expect(stubs).toContain('bool_param?: boolean');
      expect(stubs).toContain('arr_param?: array');
    });
  });

  describe('toModelTools', () => {
    it('should convert tools to model format with JSON Schema', () => {
      const registry = createToolRegistry();

      const tool: Tool = {
        definition: {
          name: 'test_tool',
          description: 'Test tool description',
          parameters: [
            {
              name: 'query',
              type: 'string',
              description: 'Query description',
              required: true,
            },
            {
              name: 'limit',
              type: 'number',
              description: 'Limit description',
              required: false,
            },
          ],
        },
        handler: async () => ({ success: true, output: 'ok' }),
      };

      registry.register(tool);

      const modelTools = registry.toModelTools();

      expect(modelTools.length).toBe(1);
      const modelTool = modelTools[0];
      expect(modelTool).toBeDefined();
      expect(modelTool?.name).toBe('test_tool');
      expect(modelTool?.description).toBe('Test tool description');
      expect(modelTool?.input_schema['type']).toBe('object');
      expect(modelTool?.input_schema['properties']).toBeDefined();
      expect(Object.keys(modelTool?.input_schema['properties'] as Record<string, unknown>)).toContain('query');
      expect(Object.keys(modelTool?.input_schema['properties'] as Record<string, unknown>)).toContain('limit');
      expect(modelTool?.input_schema['required']).toContain('query');
      expect((modelTool?.input_schema['required'] as Array<string>).includes('limit')).toBe(false);
    });

    it('should include enum values in model tools when present', () => {
      const registry = createToolRegistry();

      const tool: Tool = {
        definition: {
          name: 'test_tool',
          description: 'Test',
          parameters: [
            {
              name: 'tier',
              type: 'string',
              description: 'Memory tier',
              required: true,
              enum_values: ['core', 'working', 'archival'],
            },
          ],
        },
        handler: async () => ({ success: true, output: 'ok' }),
      };

      registry.register(tool);

      const modelTools = registry.toModelTools();
      const modelTool = modelTools[0];

      expect(modelTool).toBeDefined();
      if (!modelTool) {
        return;
      }
      const tierProp = modelTool.input_schema['properties'] as Record<string, Record<string, unknown>>;

      if (tierProp['tier']) {
        expect((tierProp['tier'] as Record<string, unknown>)['enum']).toEqual(['core', 'working', 'archival']);
      }
    });

    it('should produce valid JSON Schema with multiple tools', () => {
      const registry = createToolRegistry();

      const tool1: Tool = {
        definition: {
          name: 'tool1',
          description: 'Tool 1',
          parameters: [
            {
              name: 'param1',
              type: 'string',
              description: 'Param 1',
              required: true,
            },
          ],
        },
        handler: async () => ({ success: true, output: 'ok' }),
      };

      const tool2: Tool = {
        definition: {
          name: 'tool2',
          description: 'Tool 2',
          parameters: [],
        },
        handler: async () => ({ success: true, output: 'ok' }),
      };

      registry.register(tool1);
      registry.register(tool2);

      const modelTools = registry.toModelTools();

      expect(modelTools.length).toBe(2);
      expect(modelTools.map((t) => t.name)).toEqual(['tool1', 'tool2']);
    });
  });

  describe('AC4.3 independence', () => {
    it('should work entirely with mock tools without external dependencies', async () => {
      const registry = createToolRegistry();

      const mockTool: Tool = {
        definition: {
          name: 'mock_tool',
          description: 'A mock tool',
          parameters: [
            {
              name: 'data',
              type: 'string',
              description: 'Some data',
              required: true,
            },
          ],
        },
        handler: async (params) => {
          const data = params['data'] as string;
          return {
            success: true,
            output: `processed: ${data}`,
          };
        },
      };

      registry.register(mockTool);

      const definitions = registry.getDefinitions();
      expect(definitions).toHaveLength(1);

      const result = await registry.dispatch('mock_tool', { data: 'test' });
      expect(result.success).toBe(true);
      expect(result.output).toBe('processed: test');

      const stubs = registry.generateStubs();
      expect(stubs).toContain('async function mock_tool');

      const modelTools = registry.toModelTools();
      expect(modelTools).toHaveLength(1);
      expect(modelTools[0]?.name).toBe('mock_tool');
    });
  });
});
