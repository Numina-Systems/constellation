import {describe, expect, test} from 'bun:test';
import {createToolRegistry} from '@/tool/registry.js';
import type {CodeRuntime} from '@/runtime/types.js';
import type {CustomToolDefinition, CustomToolStore} from './types.js';
import {createCustomToolManager} from './manager.js';

function runtime(): CodeRuntime {
  return {
    async execute(): Promise<ReturnType<CodeRuntime['execute']> extends Promise<infer TResult> ? TResult : never> {
      return {success: true, output: 'ok', error: null, tool_calls_made: 0, duration_ms: 0};
    },
  };
}

function definition(name: string, overrides: Readonly<Record<string, unknown>> = {}): CustomToolDefinition {
  return {
    id: crypto.randomUUID(),
    owner: 'quarantine-owner',
    name,
    description: 'persisted tool',
    parameters: [],
    code: 'output("ok")',
    created_at: new Date(0),
    updated_at: new Date(0),
    ...overrides,
  } as CustomToolDefinition;
}

function store(rows: ReadonlyArray<CustomToolDefinition>): CustomToolStore {
  return {
    async create() { throw new Error('not used'); },
    async update() { throw new Error('not used'); },
    async delete() { throw new Error('not used'); },
    async list() { return rows; },
    async getByName() { return null; },
  };
}

describe('invalid_persisted_tool_quarantine', () => {
  test('skips malformed rows, registers valid rows, preserves storage, and reports a bounded count', async () => {
    const rows = [
      definition('valid_persisted'),
      definition('bad-name', {description: 'bad identifier'}),
      definition('duplicate_param', {parameters: [
        {name: 'value', type: 'string', description: 'value', required: true},
        {name: 'value', type: 'string', description: 'duplicate', required: false},
      ]}),
      definition('bad_shapes', {parameters: [{name: 'value', type: 'string', description: 'value', required: 'yes'}]}),
      definition('schema_poison', {inputSchema: {type: 'object', required: ['value', 'value']}}),
    ];
    const registry = createToolRegistry();
    const manager = createCustomToolManager({
      store: store(rows),
      registry,
      runtime: runtime(),
      secretResolver: {listKeys: async () => [], resolve: async () => ({})},
      owner: 'quarantine-owner',
    });
    const warnings: Array<string> = [];
    const originalWarn = console.warn;
    console.warn = (message: string): void => { warnings.push(message); };
    try {
      await manager.loadAll();
    } finally {
      console.warn = originalWarn;
    }

    expect(registry.getDefinitions().map((item) => item.name)).toEqual(['valid_persisted']);
    expect(registry.getQuarantines?.()).toHaveLength(4);
    expect(registry.getQuarantines?.().map((item) => item.name)).toEqual([
      'bad-name', 'duplicate_param', 'bad_shapes', 'schema_poison',
    ]);
    expect(registry.getQuarantines?.().every((item) => item.reason.length <= 500)).toBe(true);
    expect(warnings).toEqual(['[custom-tool] quarantined 4 invalid persisted definition(s)']);
    expect(rows[0]?.code).toBe('output("ok")');
    expect(rows[4]?.inputSchema).toEqual({type: 'object', required: ['value', 'value']});
  });

  test('quarantined names cannot be reserved without trusted recovery', () => {
    const registry = createToolRegistry();
    registry.quarantine?.('recoverable_tool', 'unknown durable outcome');
    expect(() => registry.reserve?.('recoverable_tool')).toThrow('quarantined');
    expect(() => registry.reserve?.('recoverable_tool', {trustedRecovery: true})).not.toThrow();
  });
});
