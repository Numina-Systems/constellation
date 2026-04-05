import { describe, it, expect } from 'bun:test';
import {
  translateMcpTool,
  flattenMcpContent,
} from './schema.ts';

describe('translateMcpTool', () => {
  it('AC2.2: translates JSON Schema string/number/boolean to ToolParameter types', () => {
    const mcpTool = {
      name: 'example_tool',
      description: 'An example tool',
      inputSchema: {
        type: 'object' as const,
        properties: {
          text: { type: 'string', description: 'Some text' },
          count: { type: 'number', description: 'A count' },
          flag: { type: 'boolean', description: 'A flag' },
        },
        required: ['text'],
      },
    };

    const result = translateMcpTool(mcpTool, 'spacemolt:');

    expect(result.name).toBe('spacemolt:example_tool');
    expect(result.description).toBe('An example tool');
    expect(result.parameters).toHaveLength(3);

    const textParam = result.parameters.find((p) => p.name === 'text');
    expect(textParam).toBeDefined();
    expect(textParam?.type).toBe('string');
    expect(textParam?.required).toBe(true);
    expect(textParam?.description).toBe('Some text');

    const countParam = result.parameters.find((p) => p.name === 'count');
    expect(countParam).toBeDefined();
    expect(countParam?.type).toBe('number');
    expect(countParam?.required).toBe(false);
    expect(countParam?.description).toBe('A count');

    const flagParam = result.parameters.find((p) => p.name === 'flag');
    expect(flagParam).toBeDefined();
    expect(flagParam?.type).toBe('boolean');
    expect(flagParam?.required).toBe(false);
    expect(flagParam?.description).toBe('A flag');
  });

  it('AC2.2: handles integer type as number', () => {
    const mcpTool = {
      name: 'count_tool',
      inputSchema: {
        type: 'object' as const,
        properties: {
          quantity: { type: 'integer', description: 'Quantity' },
        },
      },
    };

    const result = translateMcpTool(mcpTool, 'test:');

    const param = result.parameters.find((p) => p.name === 'quantity');
    expect(param?.type).toBe('number');
  });

  it('AC2.3: translates object and array types', () => {
    const mcpTool = {
      name: 'complex_tool',
      inputSchema: {
        type: 'object' as const,
        properties: {
          config: { type: 'object', description: 'Configuration object' },
          items: { type: 'array', description: 'List of items' },
        },
      },
    };

    const result = translateMcpTool(mcpTool, 'test:');

    const configParam = result.parameters.find((p) => p.name === 'config');
    expect(configParam?.type).toBe('object');

    const itemsParam = result.parameters.find((p) => p.name === 'items');
    expect(itemsParam?.type).toBe('array');
  });

  it('copies enum values to enum_values', () => {
    const mcpTool = {
      name: 'status_tool',
      inputSchema: {
        type: 'object' as const,
        properties: {
          status: {
            type: 'string',
            enum: ['pending', 'active', 'complete'],
            description: 'Status',
          },
        },
      },
    };

    const result = translateMcpTool(mcpTool, 'test:');

    const statusParam = result.parameters.find((p) => p.name === 'status');
    expect(statusParam?.enum_values).toEqual(['pending', 'active', 'complete']);
  });

  it('handles unknown type as string', () => {
    const mcpTool = {
      name: 'unknown_tool',
      inputSchema: {
        type: 'object' as const,
        properties: {
          custom: { type: 'custom_type', description: 'Custom type' },
        },
      },
    };

    const result = translateMcpTool(mcpTool, 'test:');

    const param = result.parameters.find((p) => p.name === 'custom');
    expect(param?.type).toBe('string');
  });

  it('handles missing properties with empty parameters list', () => {
    const mcpTool = {
      name: 'empty_tool',
      inputSchema: {
        type: 'object' as const,
      },
    };

    const result = translateMcpTool(mcpTool, 'test:');

    expect(result.parameters).toHaveLength(0);
  });

  it('defaults description to empty string', () => {
    const mcpTool = {
      name: 'nodesc_tool',
      inputSchema: {
        type: 'object' as const,
        properties: {
          param: { type: 'string' },
        },
      },
    };

    const result = translateMcpTool(mcpTool, 'test:');

    const param = result.parameters[0];
    expect(param?.description).toBe('');
  });

  it('prefixes tool name correctly', () => {
    const mcpTool = {
      name: 'mine',
      inputSchema: {
        type: 'object' as const,
      },
    };

    const result = translateMcpTool(mcpTool, 'spacemolt:');

    expect(result.name).toBe('spacemolt:mine');
  });

  it('preserves tool description', () => {
    const mcpTool = {
      name: 'tool',
      description: 'This is a useful tool',
      inputSchema: {
        type: 'object' as const,
      },
    };

    const result = translateMcpTool(mcpTool, 'test:');

    expect(result.description).toBe('This is a useful tool');
  });

  it('defaults description to empty string if not provided', () => {
    const mcpTool = {
      name: 'tool',
      inputSchema: {
        type: 'object' as const,
      },
    };

    const result = translateMcpTool(mcpTool, 'test:');

    expect(result.description).toBe('');
  });

  it('correctly identifies required vs optional parameters', () => {
    const mcpTool = {
      name: 'tool',
      inputSchema: {
        type: 'object' as const,
        properties: {
          required_param: { type: 'string' },
          optional_param: { type: 'string' },
        },
        required: ['required_param'],
      },
    };

    const result = translateMcpTool(mcpTool, 'test:');

    const requiredParam = result.parameters.find(
      (p) => p.name === 'required_param'
    );
    const optionalParam = result.parameters.find(
      (p) => p.name === 'optional_param'
    );

    expect(requiredParam?.required).toBe(true);
    expect(optionalParam?.required).toBe(false);
  });
});

describe('flattenMcpContent', () => {
  it('concatenates text fields from content blocks', () => {
    const content = [
      { type: 'text', text: 'First block' },
      { type: 'text', text: 'Second block' },
    ];

    const result = flattenMcpContent(content);

    expect(result).toBe('First block\nSecond block');
  });

  it('ignores non-text blocks', () => {
    const content = [
      { type: 'text', text: 'Text block' },
      { type: 'image', data: 'some-image-data' },
      { type: 'text', text: 'Another text' },
    ];

    const result = flattenMcpContent(content);

    expect(result).toBe('Text block\nAnother text');
  });

  it('handles blocks without text field gracefully', () => {
    const content = [
      { type: 'text', text: 'Block 1' },
      { type: 'text' },
      { type: 'text', text: 'Block 2' },
    ];

    const result = flattenMcpContent(content);

    expect(result).toBe('Block 1\nBlock 2');
  });

  it('returns empty string for no content', () => {
    const content: ReadonlyArray<{ type: string; text?: string }> = [];

    const result = flattenMcpContent(content);

    expect(result).toBe('');
  });

  it('returns empty string when no text blocks', () => {
    const content = [
      { type: 'image', data: 'image-data' },
      { type: 'video', data: 'video-data' },
    ];

    const result = flattenMcpContent(content);

    expect(result).toBe('');
  });

  it('handles single text block', () => {
    const content = [{ type: 'text', text: 'Single block' }];

    const result = flattenMcpContent(content);

    expect(result).toBe('Single block');
  });
});
