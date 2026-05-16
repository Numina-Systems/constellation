// pattern: Functional Core

import { expect, test } from 'bun:test';
import { ConstellationError } from './base.js';

test('AC1.1: ConstellationError is instanceof Error', () => {
  const error = new ConstellationError(
    'test message',
    'TEST_CODE',
    'test',
    {},
  );

  expect(error instanceof Error).toBe(true);
  expect(error instanceof ConstellationError).toBe(true);
});

test('AC1.2: Constructor sets code, subsystem, context, and suggestion correctly', () => {
  const context = { userId: '123', action: 'delete' };
  const suggestion = 'Try again later';

  const error = new ConstellationError(
    'test message',
    'TEST_CODE',
    'auth',
    context,
    { suggestion },
  );

  expect(error.code).toBe('TEST_CODE');
  expect(error.subsystem).toBe('auth');
  expect(error.context).toBe(context);
  expect(error.suggestion).toBe(suggestion);
});

test('AC1.3: message and stack are preserved from Error base class', () => {
  const message = 'test error message';
  const error = new ConstellationError(message, 'CODE', 'system', {});

  expect(error.message).toBe(message);
  expect(error.stack).toBeDefined();
  expect(error.stack).toContain('ConstellationError');
});

test('AC1.4: Passing cause option sets error.cause to original error', () => {
  const originalError = new Error('original');
  const error = new ConstellationError(
    'wrapped',
    'CODE',
    'system',
    {},
    { cause: originalError },
  );

  expect(error.cause).toBe(originalError);
});

test('AC1.5: Empty context object is valid', () => {
  const error = new ConstellationError(
    'message',
    'CODE',
    'system',
    {},
  );

  expect(error.context).toEqual({});

  const json = error.toJSON();
  expect(json.context).toEqual({});
});

test('AC4.1: toDisplayString() returns [subsystem:CODE] message', () => {
  const error = new ConstellationError(
    'connection failed',
    'TIMEOUT',
    'database',
    {},
  );

  const display = error.toDisplayString();
  expect(display).toBe('[database:TIMEOUT] connection failed');
});

test('AC4.2: toDisplayString() appends suggestion if present', () => {
  const error = new ConstellationError(
    'connection failed',
    'TIMEOUT',
    'database',
    {},
    { suggestion: 'increase connection timeout' },
  );

  const display = error.toDisplayString();
  expect(display).toBe(
    '[database:TIMEOUT] connection failed — Suggestion: increase connection timeout',
  );
});

test('AC4.3: toJSON() returns object with all expected keys', () => {
  const context = { userId: '123' };
  const error = new ConstellationError(
    'test message',
    'CODE',
    'auth',
    context,
    { suggestion: 'Try this' },
  );

  const json = error.toJSON();

  expect(json.code).toBe('CODE');
  expect(json.subsystem).toBe('auth');
  expect(json.message).toBe('test message');
  expect(json.context).toEqual(context);
  expect(json.suggestion).toBe('Try this');
  expect(json.stack).toBeDefined();
});

test('AC4.4: toJSON() omits suggestion when absent', () => {
  const error = new ConstellationError(
    'test message',
    'CODE',
    'auth',
    {},
  );

  const json = error.toJSON();

  expect('suggestion' in json).toBe(false);
});

test('AC4.5: Context with circular reference is safely serialized', () => {
  const context: Record<string, unknown> = { data: {} };
  context.data = context; // circular reference

  const error = new ConstellationError(
    'message',
    'CODE',
    'system',
    context,
  );

  const json = error.toJSON();
  expect(json.context).toBeDefined();
  // Should have replaced circular ref with string or omitted it
  expect(typeof json.context).toBe('object');
});

test('AC4.5: Context with function value is safely serialized', () => {
  const context = {
    callback: () => {
      // noop
    },
    data: 'valid',
  };

  const error = new ConstellationError(
    'message',
    'CODE',
    'system',
    context,
  );

  const json = error.toJSON();
  expect(json.context).toBeDefined();
  expect(typeof json.context).toBe('object');
  // data should be included, callback omitted or stringified
  expect((json.context as Record<string, unknown>).data).toBe('valid');
});

test('AC6.1: catch block with instanceof Error matches ConstellationError', () => {
  const error = new ConstellationError('test', 'CODE', 'system', {});

  let caught = false;
  try {
    throw error;
  } catch (e) {
    caught = e instanceof Error;
  }

  expect(caught).toBe(true);
});

test('AC6.2: error.message returns human-readable message string', () => {
  const msg = 'database connection refused';
  const error = new ConstellationError(msg, 'CONN_REFUSED', 'db', {});

  try {
    throw error;
  } catch (e) {
    if (e instanceof Error) {
      expect(e.message).toBe(msg);
    }
  }
});
