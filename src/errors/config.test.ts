import { describe, expect, test } from 'bun:test';
import { ConstellationError } from './base.js';
import { ConfigError } from './config.js';

describe('ConfigError', () => {
  // AC2.8: Each ConfigErrorCode constructs a valid ConfigError
  test('constructs VALIDATION_FAILED error', () => {
    const error = new ConfigError('VALIDATION_FAILED', 'Validation failed');
    expect(error).toBeDefined();
    expect(error.code).toBe('VALIDATION_FAILED');
  });

  test('constructs MISSING_REQUIRED error', () => {
    const error = new ConfigError('MISSING_REQUIRED', 'Missing required field');
    expect(error).toBeDefined();
    expect(error.code).toBe('MISSING_REQUIRED');
  });

  // Instanceof checks
  test('ConfigError is instanceof ConfigError', () => {
    const error = new ConfigError('VALIDATION_FAILED', 'Validation failed');
    expect(error instanceof ConfigError).toBe(true);
  });

  test('ConfigError is instanceof ConstellationError', () => {
    const error = new ConfigError('VALIDATION_FAILED', 'Validation failed');
    expect(error instanceof ConstellationError).toBe(true);
  });

  test('ConfigError is instanceof Error', () => {
    const error = new ConfigError('VALIDATION_FAILED', 'Validation failed');
    expect(error instanceof Error).toBe(true);
  });

  test('toDisplayString formats correctly', () => {
    const error = new ConfigError('VALIDATION_FAILED', 'Invalid model provider');
    expect(error.toDisplayString()).toBe('[config:VALIDATION_FAILED] Invalid model provider');
  });

  test('toDisplayString includes suggestion when provided', () => {
    const error = new ConfigError(
      'MISSING_REQUIRED',
      'Missing API key',
      {},
      { suggestion: 'Set the ANTHROPIC_API_KEY environment variable or add it to config.toml' }
    );
    expect(error.toDisplayString()).toBe(
      '[config:MISSING_REQUIRED] Missing API key — Suggestion: Set the ANTHROPIC_API_KEY environment variable or add it to config.toml'
    );
  });

  // AC2.9: VALIDATION_FAILED includes Zod error path in context
  test('VALIDATION_FAILED includes Zod error path in context', () => {
    const error = new ConfigError(
      'VALIDATION_FAILED',
      'Configuration validation failed',
      {
        path: ['model', 'provider'],
        zodErrors: [{ message: 'Required', path: ['model', 'provider'] }],
      }
    );
    expect(error.context).toBeDefined();
    expect(error.context['path']).toEqual(['model', 'provider']);
    expect(error.context['zodErrors']).toBeDefined();
  });

  // MISSING_REQUIRED with field and suggestion
  test('MISSING_REQUIRED includes field and suggestion in context and options', () => {
    const suggestion = 'Set the ANTHROPIC_API_KEY environment variable or add it to config.toml';
    const error = new ConfigError(
      'MISSING_REQUIRED',
      'Missing required field ANTHROPIC_API_KEY',
      { field: 'ANTHROPIC_API_KEY' },
      { suggestion }
    );
    expect(error.context['field']).toBe('ANTHROPIC_API_KEY');
    expect(error.suggestion).toBe(suggestion);
  });

  test('default context is empty object when not provided', () => {
    const error = new ConfigError('VALIDATION_FAILED', 'Validation failed');
    expect(error.context).toEqual({});
  });
});
