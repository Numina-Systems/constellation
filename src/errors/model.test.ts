import { describe, expect, test } from 'bun:test';
import { ConstellationError } from './base.js';
import { ModelError } from './model.js';

describe('ModelError', () => {
  // AC2.3: Each ModelErrorCode constructs a valid ModelError
  test('constructs PROVIDER_UNAVAILABLE error', () => {
    const error = new ModelError('PROVIDER_UNAVAILABLE', 'Provider unavailable');
    expect(error).toBeDefined();
    expect(error.code).toBe('PROVIDER_UNAVAILABLE');
  });

  test('constructs RATE_LIMITED error', () => {
    const error = new ModelError('RATE_LIMITED', 'Rate limited');
    expect(error).toBeDefined();
    expect(error.code).toBe('RATE_LIMITED');
  });

  test('constructs CONTEXT_OVERFLOW error', () => {
    const error = new ModelError('CONTEXT_OVERFLOW', 'Context overflow');
    expect(error).toBeDefined();
    expect(error.code).toBe('CONTEXT_OVERFLOW');
  });

  test('constructs INVALID_RESPONSE error', () => {
    const error = new ModelError('INVALID_RESPONSE', 'Invalid response');
    expect(error).toBeDefined();
    expect(error.code).toBe('INVALID_RESPONSE');
  });

  test('constructs TIMEOUT error', () => {
    const error = new ModelError('TIMEOUT', 'Request timeout');
    expect(error).toBeDefined();
    expect(error.code).toBe('TIMEOUT');
  });

  // AC2.4: RATE_LIMITED with retryAfter in context
  test('RATE_LIMITED includes retryAfter in context', () => {
    const error = new ModelError(
      'RATE_LIMITED',
      'Rate limited',
      false,
      { retryAfter: 30, provider: 'anthropic' }
    );
    expect(error.context).toBeDefined();
    expect(error.context['retryAfter']).toBe(30);
    expect(error.context['provider']).toBe('anthropic');
  });

  // AC6.4: ModelError instanceof checks
  test('ModelError is instanceof ModelError', () => {
    const error = new ModelError('RATE_LIMITED', 'Rate limited');
    expect(error instanceof ModelError).toBe(true);
  });

  test('ModelError is instanceof ConstellationError', () => {
    const error = new ModelError('RATE_LIMITED', 'Rate limited');
    expect(error instanceof ConstellationError).toBe(true);
  });

  test('ModelError is instanceof Error', () => {
    const error = new ModelError('RATE_LIMITED', 'Rate limited');
    expect(error instanceof Error).toBe(true);
  });

  // retryable field defaults to false
  test('retryable field defaults to false', () => {
    const error = new ModelError('PROVIDER_UNAVAILABLE', 'Provider unavailable');
    expect(error.retryable).toBe(false);
  });

  // retryable field is preserved when true
  test('retryable field is preserved when true', () => {
    const error = new ModelError('RATE_LIMITED', 'Rate limited', true);
    expect(error.retryable).toBe(true);
  });

  // toDisplayString formatting
  test('toDisplayString formats as [model:CODE] message', () => {
    const error = new ModelError('RATE_LIMITED', 'Rate limit exceeded');
    expect(error.toDisplayString()).toBe('[model:RATE_LIMITED] Rate limit exceeded');
  });

  test('toDisplayString includes suggestion when provided', () => {
    const error = new ModelError(
      'RATE_LIMITED',
      'Rate limit exceeded',
      true,
      {},
      { suggestion: 'Wait 30 seconds before retrying' }
    );
    expect(error.toDisplayString()).toBe(
      '[model:RATE_LIMITED] Rate limit exceeded — Suggestion: Wait 30 seconds before retrying'
    );
  });

  // toJSON includes standard fields
  test('toJSON includes standard fields', () => {
    const error = new ModelError('TIMEOUT', 'Request timeout', true, {
      timeout_ms: 30000,
    });
    const json = error.toJSON();
    expect(json.code).toBe('TIMEOUT');
    expect(json.subsystem).toBe('model');
    expect(json.message).toBe('Request timeout');
    expect(json.context['timeout_ms']).toBe(30000);
  });

  test('retryable is not included in toJSON output', () => {
    const error = new ModelError('RATE_LIMITED', 'Rate limited', true);
    const json = error.toJSON();
    // retryable is a direct property, not in context
    expect('retryable' in json).toBe(false);
  });
});
