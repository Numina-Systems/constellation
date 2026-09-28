import {describe, expect, it} from 'bun:test';
import {mapValidatedInputSchemaToParameters} from './schema-mapper.ts';

// Cycle-8 regression: the advisory flat projection must never introduce
// validation errors for schemas the strict validator accepts. Stringifying
// object/mixed enums produced duplicate '[object Object]' entries that failed
// publication; structural enums stay authoritative in the full inputSchema.
describe('MCP flat parameter projection', () => {
  it('projects only unique all-string enums', () => {
    const {schema, parameters} = mapValidatedInputSchemaToParameters({
      type: 'object',
      properties: {
        mode: {type: 'string', enum: ['fast', 'slow']},
        choice: {enum: [{kind: 'a'}, {kind: 'b'}]},
        mixed: {enum: [1, '1']},
      },
      required: ['mode'],
    }, 'projection_tool');

    expect(schema).toBeDefined();
    const byName = new Map(parameters.map((parameter) => [parameter.name, parameter]));
    expect(byName.get('mode')?.enum_values).toEqual(['fast', 'slow']);
    expect(byName.get('choice')?.enum_values).toBeUndefined();
    expect(byName.get('mixed')?.enum_values).toBeUndefined();
  });
});
