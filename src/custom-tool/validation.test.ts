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

describe('schema_enforcement_matrix', () => {
  const toolWith = (inputSchema: Record<string, unknown>) => {
    const result = validateToolMetadata({name: 'schema_tool', description: 'schema tool', parameters: [], inputSchema});
    expect(result.valid).toBe(true);
    return result.valid ? result.value : undefined;
  };

  test('object keywords bind without an explicit object type', () => {
    const tool = toolWith({type: 'object', properties: {payload: {properties: {count: {type: 'integer'}}, required: ['count']}}});
    if (!tool) return;
    expect(validateInput(tool, {payload: {}})).toContain('missing required property');
    expect(validateInput(tool, {payload: {count: 'bad'}})).toContain('expected integer');
    expect(validateInput(tool, {payload: {count: 2}})).toBeNull();
  });

  test('items keyword binds on type unions', () => {
    const tool = toolWith({type: 'object', properties: {list: {type: ['array', 'null'], items: {type: 'integer'}}}});
    if (!tool) return;
    expect(validateInput(tool, {list: ['bad']})).toContain('expected integer');
    expect(validateInput(tool, {list: [1, 2]})).toBeNull();
    expect(validateInput(tool, {list: null})).toBeNull();
  });

  test('anyOf and oneOf are evaluated independently when both are present', () => {
    const tool = toolWith({type: 'object', properties: {v: {anyOf: [{type: 'string'}, {type: 'number'}], oneOf: [{type: 'string'}, {type: 'boolean'}]}}});
    if (!tool) return;
    expect(validateInput(tool, {v: 'text'})).toBeNull();
    expect(validateInput(tool, {v: 1})).toContain('exactly one');
  });

  test('enum and const compare JSON values structurally', () => {
    const tool = toolWith({type: 'object', properties: {shape: {enum: [{kind: 'circle', r: 1}, [1, 2]]}, mode: {const: 'approved'}}});
    if (!tool) return;
    expect(validateInput(tool, {shape: {r: 1, kind: 'circle'}, mode: 'approved'})).toBeNull();
    expect(validateInput(tool, {shape: {kind: 'circle', r: 2}, mode: 'approved'})).toContain('not in enum');
    expect(validateInput(tool, {shape: [1, 2], mode: 'approved'})).toBeNull();
    expect(validateInput(tool, {shape: {kind: 'circle', r: 1}, mode: 'rejected'})).toContain('does not match const');
  });

  test('unsupported assertion keywords fail closed at publication', () => {
    for (const schema of [
      {type: 'object', properties: {v: {type: 'string'}}, additionalProperties: false},
      {type: 'object', properties: {v: {const: 'x', unevaluatedProperties: false}}},
      {type: 'object', properties: {v: {type: 'string', pattern: '^a'}}, allOf: []},
    ]) {
      expect(validateToolMetadata({name: 'schema_tool', description: 'schema tool', parameters: [], inputSchema: schema}).valid).toBe(false);
    }
    expect(validateToolMetadata({name: 'schema_tool', description: 'schema tool', parameters: [], inputSchema: {type: 'object', properties: {v: {const: 'x'}}}}).valid).toBe(true);
  });
});
