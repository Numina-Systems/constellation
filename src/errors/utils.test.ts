// pattern: Functional Core

import { expect, test } from 'bun:test';
import { isConstellationError, wrapError } from './utils.js';
import { ConstellationError } from './base.js';

test('isConstellationError returns true for ConstellationError instance', () => {
  const error = new ConstellationError('test', 'CODE', 'system', {});

  expect(isConstellationError(error)).toBe(true);
});

test('isConstellationError returns false for plain Error', () => {
  const error = new Error('test');

  expect(isConstellationError(error)).toBe(false);
});

test('isConstellationError returns false for null', () => {
  expect(isConstellationError(null)).toBe(false);
});

test('isConstellationError returns false for undefined', () => {
  expect(isConstellationError(undefined)).toBe(false);
});

test('isConstellationError returns false for string', () => {
  expect(isConstellationError('error message')).toBe(false);
});

test('isConstellationError returns false for number', () => {
  expect(isConstellationError(42)).toBe(false);
});

test('wrapError given Error preserves message and sets as cause', () => {
  const originalError = new Error('original message');

  const wrapped = wrapError(
    originalError,
    'WRAPPED_CODE',
    'wrapper',
  );

  expect(wrapped.message).toBe('original message');
  expect(wrapped.cause).toBe(originalError);
  expect(wrapped.code).toBe('WRAPPED_CODE');
  expect(wrapped.subsystem).toBe('wrapper');
});

test('wrapError given string uses string as message', () => {
  const wrapped = wrapError(
    'error string',
    'CODE',
    'system',
  );

  expect(wrapped.message).toBe('error string');
  expect(wrapped.cause).toBeUndefined();
});

test('wrapError given non-Error non-string value uses "Unknown error" as message', () => {
  const wrapped = wrapError(42, 'CODE', 'system');

  expect(wrapped.message).toBe('Unknown error');
  expect(wrapped.cause).toBeUndefined();
});

test('wrapError sets provided code, subsystem, and context', () => {
  const context = { userId: '123', operation: 'delete' };

  const wrapped = wrapError(
    new Error('failed'),
    'OP_FAILED',
    'database',
    context,
  );

  expect(wrapped.code).toBe('OP_FAILED');
  expect(wrapped.subsystem).toBe('database');
  expect(wrapped.context).toBe(context);
});

test('wrapError with no context argument produces empty context', () => {
  const wrapped = wrapError(
    new Error('failed'),
    'CODE',
    'system',
  );

  expect(wrapped.context).toEqual({});
});

test('AC6.5: Catching mix of Error and ConstellationError with instanceof narrowing', () => {
  const plainError = new Error('plain');
  const constellationError = new ConstellationError('const', 'CODE', 'system', {});

  function processError(error: unknown): string {
    if (isConstellationError(error)) {
      return `constellation: ${error.code}/${error.subsystem}`;
    }
    if (error instanceof Error) {
      return `error: ${error.message}`;
    }
    return 'unknown';
  }

  expect(processError(plainError)).toBe('error: plain');
  expect(processError(constellationError)).toBe('constellation: CODE/system');
  expect(processError('string error')).toBe('unknown');
});
