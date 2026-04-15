// pattern: Functional Core (tests for pure schema mapping function)

import { describe, it, expect } from 'bun:test';
import { mapInputSchemaToParameters } from './schema-mapper.ts';

describe('mapInputSchemaToParameters', () => {
  describe('mcp-client.AC4.4: JSON Schema to ToolParameter mapping', () => {
    it('should map string type correctly', () => {
      const schema = {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'A query' },
        },
        required: ['query'],
      };

      const result = mapInputSchemaToParameters(schema);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'query',
        type: 'string',
        description: 'A query',
        required: true,
      });
    });

    it('should map number type correctly', () => {
      const schema = {
        type: 'object',
        properties: {
          count: { type: 'number' },
        },
      };

      const result = mapInputSchemaToParameters(schema);

      expect(result).toHaveLength(1);
      expect(result[0]?.type).toBe('number');
    });

    it('should map integer type to number', () => {
      const schema = {
        type: 'object',
        properties: {
          age: { type: 'integer' },
        },
      };

      const result = mapInputSchemaToParameters(schema);

      expect(result).toHaveLength(1);
      expect(result[0]?.type).toBe('number');
    });

    it('should map boolean type correctly', () => {
      const schema = {
        type: 'object',
        properties: {
          active: { type: 'boolean' },
        },
      };

      const result = mapInputSchemaToParameters(schema);

      expect(result).toHaveLength(1);
      expect(result[0]?.type).toBe('boolean');
    });

    it('should map object type correctly', () => {
      const schema = {
        type: 'object',
        properties: {
          metadata: { type: 'object' },
        },
      };

      const result = mapInputSchemaToParameters(schema);

      expect(result).toHaveLength(1);
      expect(result[0]?.type).toBe('object');
    });

    it('should map array type correctly', () => {
      const schema = {
        type: 'object',
        properties: {
          items: { type: 'array' },
        },
      };

      const result = mapInputSchemaToParameters(schema);

      expect(result).toHaveLength(1);
      expect(result[0]?.type).toBe('array');
    });

    it('should map enum values to strings', () => {
      const schema = {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['active', 'inactive', 'pending'] },
        },
      };

      const result = mapInputSchemaToParameters(schema);

      expect(result).toHaveLength(1);
      expect(result[0]?.enum_values).toEqual(['active', 'inactive', 'pending']);
    });

    it('should convert enum numeric values to strings', () => {
      const schema = {
        type: 'object',
        properties: {
          level: { type: 'number', enum: [1, 2, 3] },
        },
      };

      const result = mapInputSchemaToParameters(schema);

      expect(result).toHaveLength(1);
      expect(result[0]?.enum_values).toEqual(['1', '2', '3']);
    });

    it('should mark properties in required array as required true', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['name'],
      };

      const result = mapInputSchemaToParameters(schema);

      expect(result).toHaveLength(2);
      const nameParam = result.find(p => p.name === 'name');
      const emailParam = result.find(p => p.name === 'email');

      expect(nameParam?.required).toBe(true);
      expect(emailParam?.required).toBe(false);
    });

    it('should default missing description to empty string', () => {
      const schema = {
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
      };

      const result = mapInputSchemaToParameters(schema);

      expect(result).toHaveLength(1);
      expect(result[0]?.description).toBe('');
    });

    it('should default unknown type to string', () => {
      const schema = {
        type: 'object',
        properties: {
          unknown: { type: 'unknown-type' },
        },
      };

      const result = mapInputSchemaToParameters(schema);

      expect(result).toHaveLength(1);
      expect(result[0]?.type).toBe('string');
    });

    it('should return empty array for empty schema', () => {
      const schema = { type: 'object' };

      const result = mapInputSchemaToParameters(schema);

      expect(result).toHaveLength(0);
    });

    it('should return empty array for schema with no properties', () => {
      const schema = {
        type: 'object',
        properties: {},
      };

      const result = mapInputSchemaToParameters(schema);

      expect(result).toHaveLength(0);
    });

    it('should handle missing properties key', () => {
      const schema = { type: 'object', required: ['foo'] };

      const result = mapInputSchemaToParameters(schema);

      expect(result).toHaveLength(0);
    });

    it('should handle missing required key', () => {
      const schema = {
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
      };

      const result = mapInputSchemaToParameters(schema);

      expect(result).toHaveLength(1);
      expect(result[0]?.required).toBe(false);
    });

    it('should handle multiple properties with mixed required status', () => {
      const schema = {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Max results' },
          offset: { type: 'number' },
        },
        required: ['query', 'limit'],
      };

      const result = mapInputSchemaToParameters(schema);

      expect(result).toHaveLength(3);
      expect(result.find(p => p.name === 'query')?.required).toBe(true);
      expect(result.find(p => p.name === 'limit')?.required).toBe(true);
      expect(result.find(p => p.name === 'offset')?.required).toBe(false);
    });
  });
});
