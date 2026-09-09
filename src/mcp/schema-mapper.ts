// pattern: Functional Core

import type { ToolParameter, ToolParameterType } from '@/tool/types.ts';
import { McpDiscoveryError } from './types.ts';

type JsonObject = Readonly<Record<string, unknown>>;
const JSON_SCHEMA_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);
const UNSUPPORTED_SCHEMA_KEYS = new Set(['$ref', '$dynamicRef', '$recursiveRef', 'pattern', 'format', 'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties', 'dependentRequired', 'dependentSchemas', 'allOf', 'patternProperties', 'prefixItems', 'dependencies']);

/** Validates the complete MCP input schema and returns a lossless frozen copy. */
export function validateMcpInputSchema(inputSchema: unknown, toolName: string): Readonly<Record<string, unknown>> {
  const issues: Array<string> = [];
  validateSchemaNode(inputSchema, '$', issues, 0);
  if (issues.length > 0) {
    throw new McpDiscoveryError(
      'mcp_discovery_invalid_schema',
      `invalid input schema for MCP tool ${toolName}: ${issues[0] ?? 'invalid schema'}`,
      {tool: toolName, path: issues[0] ?? '$'},
    );
  }
  return deepFreeze(cloneJson(inputSchema) as Record<string, unknown>);
}

/**
 * Projects a valid JSON Schema into the legacy flat parameter shape.
 * The projection is advisory only; the complete inputSchema remains authoritative.
 */
export function mapInputSchemaToParameters(
  inputSchema: Readonly<Record<string, unknown>>,
): Array<ToolParameter> {
  const properties = asRecord(inputSchema['properties']);
  const required = new Set(stringArray(inputSchema['required']));
  const parameters: Array<ToolParameter> = [];

  for (const [name, propertySchema] of Object.entries(properties)) {
    if (!isRecord(propertySchema)) continue;
    const type = projectType(propertySchema);
    const description = typeof propertySchema['description'] === 'string' ? propertySchema['description'] : '';
    const parameter: ToolParameter = {name, type, description, required: required.has(name)};
    const enumValues = propertySchema['enum'];
    if (Array.isArray(enumValues) && enumValues.every(isJsonValue)) {
      parameter.enum_values = enumValues.map((value) => String(value));
    }
    parameters.push(parameter);
  }
  return parameters;
}

/** Strict discovery helper: validate first, then produce the compatibility projection. */
export function mapValidatedInputSchemaToParameters(
  inputSchema: unknown,
  toolName: string,
): {readonly schema: Readonly<Record<string, unknown>>; readonly parameters: ReadonlyArray<ToolParameter>} {
  const schema = validateMcpInputSchema(inputSchema, toolName);
  return {schema, parameters: mapInputSchemaToParameters(schema)};
}

function validateSchemaNode(value: unknown, path: string, issues: Array<string>, depth: number): void {
  if (depth > 32) { issues.push(`${path}: schema nesting exceeds limit`); return; }
  if (!isRecord(value)) { issues.push(`${path}: must be a JSON Schema object`); return; }
  for (const key of Object.keys(value)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(key)) issues.push(`${path}.${key}: keyword is not supported safely by registry validation`);
  }
  const type = value['type'];
  if (type !== undefined) {
    if (typeof type === 'string') {
      if (!JSON_SCHEMA_TYPES.has(type)) issues.push(`${path}.type: unsupported type ${type}`);
    } else if (Array.isArray(type) && (type.length === 0 || type.some((item) => typeof item !== 'string' || !JSON_SCHEMA_TYPES.has(item)))) {
      issues.push(`${path}.type: must contain only supported type names`);
    } else if (!Array.isArray(type)) {
      issues.push(`${path}.type: must be a supported type name or type union`);
    }
  }
  const enumValues = value['enum'];
  if (enumValues !== undefined && (!Array.isArray(enumValues) || enumValues.length === 0 || enumValues.some((item) => !isJsonValue(item)))) {
    issues.push(`${path}.enum: must be a non-empty JSON value array`);
  }
  for (const keyword of ['anyOf', 'oneOf']) {
    const alternatives = value[keyword];
    if (alternatives !== undefined) {
      if (!Array.isArray(alternatives) || alternatives.length === 0) issues.push(`${path}.${keyword}: must be a non-empty schema array`);
      else alternatives.forEach((item, index) => validateSchemaNode(item, `${path}.${keyword}[${index}]`, issues, depth + 1));
    }
  }
  const properties = value['properties'];
  if (properties !== undefined) {
    if (!isRecord(properties)) issues.push(`${path}.properties: must be an object`);
    else for (const [name, child] of Object.entries(properties)) validateSchemaNode(child, `${path}.properties.${name}`, issues, depth + 1);
  }
  const required = value['required'];
  if (required !== undefined && (!Array.isArray(required) || required.some((item) => typeof item !== 'string') || new Set(required).size !== required.length)) {
    issues.push(`${path}.required: must be an array of unique property names`);
  }
  if (value['items'] !== undefined) {
    if (Array.isArray(value['items'])) issues.push(`${path}.items: tuple schemas are not supported safely`);
    else validateSchemaNode(value['items'], `${path}.items`, issues, depth + 1);
  }
  for (const keyword of ['additionalProperties', 'contains', 'not', 'if', 'then', 'else', 'propertyNames']) {
    if (value[keyword] !== undefined) issues.push(`${path}.${keyword}: keyword is not supported safely by registry validation`);
  }
}

function projectType(schema: JsonObject): ToolParameterType {
  const type = schema['type'];
  if (type === 'number' || type === 'integer') return 'number';
  if (type === 'boolean') return 'boolean';
  if (type === 'array') return 'array';
  if (type === 'object') return 'object';
  if (type === 'string') return 'string';
  if (Array.isArray(type) && type.length > 0) {
    const projected = type.map((item) => projectType({type: item}));
    return projected.every((item) => item === projected[0]) ? (projected[0] ?? 'object') : 'object';
  }
  return 'string';
}

function stringArray(value: unknown): Array<string> {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
function asRecord(value: unknown): JsonObject {
  return isRecord(value) ? value : {};
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return Number.isFinite(value as number) || typeof value !== 'number';
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (isRecord(value)) return Object.values(value).every(isJsonValue);
  return false;
}
function cloneJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
