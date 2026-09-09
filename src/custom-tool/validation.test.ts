import {describe, expect, test} from 'bun:test';
import {createToolRegistry} from '@/tool/registry.js';
import {quoteForGeneratedCode, reservedRuntimeBindings, validateInput, validateToolMetadata} from './validation.js';

describe('custom_metadata_rejection_matrix', () => {
  const valid = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    name: 'safe_tool', description: 'safe', parameters: [], code: 'output("ok")', ...overrides,
  });
  test('rejects coercion, identifier, duplicate, binding, type, required, and enum hazards', () => {
    const cases: Array<unknown> = [
      valid({name: 12}), valid({parameters: 'not-an-array'}),
      valid({parameters: [{name: 'x', type: 'string', description: 'x', required: 'true'}]}),
      valid({parameters: [{name: 'x', type: 'string', description: 'x', required: true}, {name: 'x', type: 'string', description: 'x', required: false}]}),
      valid({parameters: [{name: 'PARAMS', type: 'string', description: 'x', required: true}]}),
      valid({parameters: [{name: 'x', type: 'wat', description: 'x', required: true}]}),
      valid({parameters: [{name: 'x', type: 'string', description: 'x', required: true, enum_values: [1]}]}),
    ];
    for (const candidate of cases) expect(validateToolMetadata(candidate).valid).toBe(false);
    expect(validateToolMetadata(valid({parameters: [{name: 'API_KEY', type: 'string', description: 'x', required: true}]}), {reservedBindings: reservedRuntimeBindings(['API_KEY'])}).valid).toBe(false);
  });
  test('accepts integer and type union schemas for registry-side validation', () => {
    const result = validateToolMetadata(valid({
      inputSchema: {type: 'object', properties: {value: {type: ['string', 'integer']}}},
    }));
    expect(result.valid).toBe(true);
  });
  test('preserves nested schema semantics and rejects invalid dispatch input', () => {
    const result = validateToolMetadata(valid({parameters: [{name: 'payload', type: 'object', description: 'payload', required: true}], inputSchema: {type: 'object', properties: {payload: {type: 'object', properties: {count: {type: 'number'}}, required: ['count']}}, required: ['payload']}}));
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(validateInput(result.value, {payload: {count: 'wrong'}})).toContain('expected number');
      expect(validateInput(result.value, {payload: {count: 2}})).toBeNull();
    }
  });
  test('registry rejects conflicting names and generated strings use JSON escaping', () => {
    const registry = createToolRegistry();
    registry.register({definition: {name: 'safe_tool', description: 'line\nquote', parameters: [{name: 'value', type: 'string', description: 'x', required: true}]}, handler: async () => ({success: true, output: 'ok'})});
    expect(() => registry.register({definition: {name: 'safe_tool', description: 'duplicate', parameters: []}, handler: async () => ({success: true, output: 'ok'})})).toThrow('already registered');
    expect(quoteForGeneratedCode('"\\\n')).toBe(JSON.stringify('"\\\n'));
    expect(registry.generateStubs()).toContain('safe_tool');
  });
});
