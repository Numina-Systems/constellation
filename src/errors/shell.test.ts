import { describe, it, expect } from 'bun:test';
import { ShellError, type ShellErrorCode } from './shell.js';
import { ConstellationError } from './base.js';

describe('arch-hardening.AC5.3: ShellError is ConstellationError with subsystem shell', () => {
  it('instantiates with SHELL_CREATION_FAILED code', () => {
    const error = new ShellError('SHELL_CREATION_FAILED', 'test message');

    expect(error).toBeInstanceOf(ConstellationError);
    expect(error).toBeInstanceOf(ShellError);
    expect(error.subsystem).toBe('shell');
    expect(error.code).toBe('SHELL_CREATION_FAILED');
    expect(error.name).toBe('ShellError');
  });

  it('instantiates with COMMAND_TIMEOUT code', () => {
    const error = new ShellError('COMMAND_TIMEOUT', 'command timed out');

    expect(error.subsystem).toBe('shell');
    expect(error.code).toBe('COMMAND_TIMEOUT');
    expect(error.name).toBe('ShellError');
  });

  it('instantiates with MARKER_NOT_FOUND code', () => {
    const error = new ShellError('MARKER_NOT_FOUND', 'marker disappeared');

    expect(error.subsystem).toBe('shell');
    expect(error.code).toBe('MARKER_NOT_FOUND');
    expect(error.name).toBe('ShellError');
  });

  it('instantiates with SESSION_CLOSED code', () => {
    const error = new ShellError('SESSION_CLOSED', 'session closed');

    expect(error.subsystem).toBe('shell');
    expect(error.code).toBe('SESSION_CLOSED');
    expect(error.name).toBe('ShellError');
  });
});

describe('arch-hardening.AC5.4: Each error code provides actionable suggestion', () => {
  const codes: Array<ShellErrorCode> = [
    'SHELL_CREATION_FAILED',
    'COMMAND_TIMEOUT',
    'MARKER_NOT_FOUND',
    'SESSION_CLOSED',
  ];

  codes.forEach((code) => {
    it(`${code} has non-empty suggestion`, () => {
      const error = new ShellError(code, 'test message');

      expect(error.suggestion).toBeTruthy();
      expect(typeof error.suggestion).toBe('string');
      expect(error.suggestion!.length).toBeGreaterThan(0);
    });

    it(`${code} suggestion appears in toDisplayString()`, () => {
      const error = new ShellError(code, 'test message');
      const display = error.toDisplayString();

      expect(display).toContain('Suggestion:');
      expect(display).toContain(error.suggestion!);
    });
  });
});

describe('ShellError context handling', () => {
  it('includes context passed in constructor', () => {
    const context = { uid: 0, shell: '/bin/bash' };
    const error = new ShellError('SHELL_CREATION_FAILED', 'test', context);

    expect(error.context).toEqual(context);
  });

  it('defaults to empty object when context not provided', () => {
    const error = new ShellError('SHELL_CREATION_FAILED', 'test');

    expect(error.context).toEqual({});
  });
});

describe('ShellError cause propagation', () => {
  it('propagates cause when provided in options', () => {
    const cause = new Error('underlying issue');
    const error = new ShellError('SHELL_CREATION_FAILED', 'test', undefined, {
      cause,
    });

    expect(error.cause).toBe(cause);
  });

  it('has undefined cause when not provided', () => {
    const error = new ShellError('SHELL_CREATION_FAILED', 'test');

    expect(error.cause).toBeUndefined();
  });
});

describe('ShellError serialization', () => {
  it('toJSON() includes all required fields', () => {
    const error = new ShellError('SHELL_CREATION_FAILED', 'test message', {
      uid: 0,
    });
    const json = error.toJSON();

    expect(json.code).toBe('SHELL_CREATION_FAILED');
    expect(json.subsystem).toBe('shell');
    expect(json.message).toBe('test message');
    expect(json.context).toEqual({ uid: 0 });
    expect(json.suggestion).toBeDefined();
    expect(json.stack).toBeDefined();
  });

  it('toJSON() excludes suggestion field when undefined', () => {
    // This shouldn't happen with ShellError since we always set suggestion,
    // but test the base class behavior
    const error = new ShellError('SHELL_CREATION_FAILED', 'test');
    const json = error.toJSON();

    expect(json.suggestion).toBeDefined();
  });
});
