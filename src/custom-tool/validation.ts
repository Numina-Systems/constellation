// pattern: Functional Core

import type {Tool, ToolDefinition, ToolParameter, ToolParameterType} from '@/tool/types.js';

const RESERVED_WORDS = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete',
  'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'implements',
  'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null', 'package', 'private', 'protected',
  'public', 'return', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var',
  'void', 'while', 'with', 'yield', 'undefined', 'constructor', 'prototype', '__proto__',
]);

export const RESERVED_RUNTIME_BINDINGS: ReadonlySet<string> = new Set([
  ...RESERVED_WORDS,
  'PARAMS', 'output', 'debug', '__callTool__', 'console', 'Deno', 'globalThis',
]);
const TOOL_TYPES = new Set<ToolParameterType>(['string', 'number', 'boolean', 'object', 'array']);

type ValidationOptions = Readonly<{
  readonly reservedBindings?: ReadonlySet<string>;
  readonly existingNames?: ReadonlySet<string>;
}>;

export type ValidationIssue = Readonly<{path: string; message: string}>;
export type ValidationResult<T> =
  | Readonly<{valid: true; value: T}>
  | Readonly<{valid: false; issues: ReadonlyArray<ValidationIssue>}>;

export type RawToolMetadata = Readonly<{
  readonly name: unknown;
  readonly description: unknown;
  readonly parameters?: unknown;
  readonly inputSchema?: unknown;
  readonly code?: unknown;
}>;

export function isJavaScriptIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) && !RESERVED_WORDS.has(value);
}

export function reservedRuntimeBindings(secretNames: ReadonlyArray<string> = []): ReadonlySet<string> {
  return new Set([...RESERVED_RUNTIME_BINDINGS, ...secretNames.filter((name) => isJavaScriptIdentifier(name))]);
}

export function validateToolMetadata(
  raw: unknown,
  options: ValidationOptions = {},
): ValidationResult<ToolDefinition> {
  const issues: Array<ValidationIssue> = [];
  if (!isRecord(raw)) return {valid: false, issues: [{path: '$', message: 'metadata must be an object'}]};
  const name = raw['name'];
  const description = raw['description'];
  const parametersRaw = raw['parameters'] ?? [];
  const inputSchema = raw['inputSchema'];
  if (!isJavaScriptIdentifier(name)) issues.push({path: 'name', message: 'must be a non-reserved JavaScript identifier'});
  if (typeof name === 'string' && (options.reservedBindings ?? reservedRuntimeBindings()).has(name)) issues.push({path: 'name', message: 'collides with a runtime or credential binding'});
  if (typeof description !== 'string') issues.push({path: 'description', message: 'must be a string'});
  if (options.existingNames?.has(name as string)) issues.push({path: 'name', message: 'conflicts with an existing tool'});
  const parameters = validateParameters(parametersRaw, options.reservedBindings ?? reservedRuntimeBindings(), issues);
  if (inputSchema !== undefined) validateSchema(inputSchema, 'inputSchema', issues);
  if (issues.length > 0) return {valid: false, issues};
  return {valid: true, value: {
    name: name as string,
    description: description as string,
    parameters,
    ...(inputSchema === undefined ? {} : {inputSchema: cloneJson(inputSchema)}),
  } as ToolDefinition};
}

export function validateExecutableTool(
  tool: Readonly<Tool>,
  options: ValidationOptions = {},
): ValidationResult<Tool> {
  const result = validateToolMetadata(tool.definition, options);
  if (!result.valid) return result;
  if (typeof tool.handler !== 'function') return {valid: false, issues: [{path: 'handler', message: 'must be callable'}]};
  return {valid: true, value: {definition: result.value, handler: tool.handler}};
}

export function validationMessage(result: Readonly<{valid: boolean; issues?: ReadonlyArray<ValidationIssue>}>): string {
  return result.valid ? '' : result.issues?.map((issue) => `${issue.path}: ${issue.message}`).join('; ') ?? 'invalid metadata';
}

export function validateInput(
  definition: Readonly<ToolDefinition>,
  params: unknown,
): string | null {
  if (!isRecord(params)) return 'parameters must be an object';
  if (definition.inputSchema !== undefined) {
    const error = validateSchemaValue(params, definition.inputSchema, '$');
    if (error !== null) return error;
    // A complete inputSchema is the sole dispatch authority. Flat parameters
    // are only a compatibility projection for model/stub generation.
    return null;
  }
  for (const parameter of definition.parameters) {
    if (parameter.required && !Object.hasOwn(params, parameter.name)) return `missing required parameter: ${parameter.name}`;
    if (!Object.hasOwn(params, parameter.name)) continue;
    const value = params[parameter.name];
    if (!matchesType(value, parameter.type)) return `invalid type for parameter ${parameter.name}: expected ${parameter.type}`;
    if (parameter.enum_values !== undefined && !parameter.enum_values.includes(value as string)) {
      return `invalid value for parameter ${parameter.name}: expected one of [${parameter.enum_values.join(', ')}], got ${value}`;
    }
  }
  return null;
}

export function quoteForGeneratedCode(value: string): string {
  return JSON.stringify(value);
}

function validateParameters(raw: unknown, bindings: ReadonlySet<string>, issues: Array<ValidationIssue>): Array<ToolParameter> {
  if (!Array.isArray(raw)) { issues.push({path: 'parameters', message: 'must be an array'}); return []; }
  const names = new Set<string>();
  const result: Array<ToolParameter> = [];
  raw.forEach((item, index) => {
    const path = `parameters[${index}]`;
    if (!isRecord(item)) { issues.push({path, message: 'must be an object'}); return; }
    const name = item['name'];
    const type = item['type'];
    const description = item['description'];
    const required = item['required'];
    if (!isJavaScriptIdentifier(name)) issues.push({path: `${path}.name`, message: 'must be a non-reserved JavaScript identifier'});
    if (typeof name === 'string' && names.has(name)) issues.push({path: `${path}.name`, message: 'duplicate parameter name'});
    if (typeof name === 'string') names.add(name);
    if (typeof name === 'string' && bindings.has(name)) issues.push({path: `${path}.name`, message: 'collides with a runtime or credential binding'});
    if (typeof type !== 'string' || !TOOL_TYPES.has(type as ToolParameterType)) issues.push({path: `${path}.type`, message: 'must be a supported type'});
    if (typeof description !== 'string') issues.push({path: `${path}.description`, message: 'must be a string'});
    if (typeof required !== 'boolean') issues.push({path: `${path}.required`, message: 'must be a boolean'});
    const enumValues = item['enum_values'];
    if (enumValues !== undefined) {
      if (!Array.isArray(enumValues) || enumValues.some((value) => typeof value !== 'string') || new Set(enumValues).size !== enumValues.length) {
        issues.push({path: `${path}.enum_values`, message: 'must be an array of unique strings'});
      }
    }
    if (typeof name === 'string' && typeof type === 'string' && TOOL_TYPES.has(type as ToolParameterType) &&
      typeof description === 'string' && typeof required === 'boolean' &&
      (enumValues === undefined || (Array.isArray(enumValues) && enumValues.every((value) => typeof value === 'string')))) {
      result.push({name, type: type as ToolParameterType, description, required, ...(enumValues === undefined ? {} : {enum_values: [...enumValues]})});
    }
  });
  return result;
}

function validateSchema(raw: unknown, path: string, issues: Array<ValidationIssue>): void {
  if (!isRecord(raw)) { issues.push({path, message: 'must be a JSON Schema object'}); return; }
  const type = raw['type'];
  if (type !== undefined) {
    if (typeof type === 'string') {
      if (!['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(type)) {
        issues.push({path: `${path}.type`, message: `unsupported JSON Schema type: ${type}`});
      }
    } else if (Array.isArray(type)) {
      if (type.length === 0) issues.push({path: `${path}.type`, message: 'must contain at least one JSON Schema type'});
      const unsupported = type.filter((value): value is unknown => typeof value !== 'string' || !['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(value));
      if (unsupported.length > 0) issues.push({path: `${path}.type`, message: `unsupported JSON Schema type(s): ${unsupported.map(String).join(', ')}`});
    } else {
      issues.push({path: `${path}.type`, message: 'must be a supported JSON Schema type or type union'});
    }
  }
  if (raw['enum'] !== undefined && (!Array.isArray(raw['enum']) || raw['enum'].length === 0)) issues.push({path: `${path}.enum`, message: 'must be a non-empty array'});
  if (raw['required'] !== undefined && (!Array.isArray(raw['required']) || raw['required'].some((value) => typeof value !== 'string') || new Set(raw['required']).size !== raw['required'].length)) issues.push({path: `${path}.required`, message: 'must be an array of unique strings'});
  if (raw['properties'] !== undefined) {
    if (!isRecord(raw['properties'])) issues.push({path: `${path}.properties`, message: 'must be an object'});
    else for (const [key, value] of Object.entries(raw['properties'])) validateSchema(value, `${path}.properties.${key}`, issues);
  }
  if (raw['items'] !== undefined) validateSchema(raw['items'], `${path}.items`, issues);
  for (const keyword of ['anyOf', 'oneOf']) {
    if (raw[keyword] !== undefined) {
      if (!Array.isArray(raw[keyword]) || raw[keyword].length === 0) issues.push({path: `${path}.${keyword}`, message: 'must be a non-empty array'});
      else raw[keyword].forEach((value, index) => validateSchema(value, `${path}.${keyword}[${index}]`, issues));
    }
  }
}

function validateSchemaValue(value: unknown, schema: unknown, path: string): string | null {
  if (!isRecord(schema)) return `${path}: invalid schema`;
  const alternatives = schema['anyOf'] ?? schema['oneOf'];
  if (alternatives !== undefined && Array.isArray(alternatives)) {
    const matches = alternatives.filter((candidate) => validateSchemaValue(value, candidate, path) === null).length;
    if (schema['anyOf'] !== undefined && matches === 0) return `${path}: does not match any schema`;
    if (schema['oneOf'] !== undefined && matches !== 1) return `${path}: must match exactly one schema`;
  }
  const type = schema['type'];
  if (typeof type === 'string' && !matchesJsonType(value, type)) return `${path}: expected ${type}`;
  if (Array.isArray(type) && !type.some((candidate): candidate is string => typeof candidate === 'string' && matchesJsonType(value, candidate))) {
    return `${path}: expected one of ${type.map(String).join(', ')}`;
  }
  const enumValues = schema['enum'];
  if (Array.isArray(enumValues) && !enumValues.some((candidate) => Object.is(candidate, value))) return `${path}: value is not in enum`;
  if ((type === 'object' || (Array.isArray(type) && type.includes('object'))) && isRecord(value)) {
    const required = schema['required'];
    if (Array.isArray(required)) for (const key of required) if (!Object.hasOwn(value, key as string)) return `${path}: missing required property ${String(key)}`;
    const properties = schema['properties'];
    if (isRecord(properties)) for (const [key, child] of Object.entries(properties)) if (Object.hasOwn(value, key)) {
      const error = validateSchemaValue(value[key], child, `${path}.${key}`); if (error !== null) return error;
    }
  }
  if (type === 'array' && Array.isArray(value) && schema['items'] !== undefined) for (const [index, item] of value.entries()) {
    const error = validateSchemaValue(item, schema['items'], `${path}[${index}]`); if (error !== null) return error;
  }
  return null;
}

function matchesType(value: unknown, expected: ToolParameterType): boolean {
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'object') return isRecord(value);
  return typeof value === expected;
}
function matchesJsonType(value: unknown, expected: string): boolean {
  if (expected === 'null') return value === null;
  if (expected === 'object') return isRecord(value);
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'integer') return typeof value === 'number' && Number.isInteger(value);
  return typeof value === expected;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function cloneJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}
