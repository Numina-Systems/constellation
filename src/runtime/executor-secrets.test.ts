// pattern: Functional Core

/**
 * Tests for secret constants generation in the Deno executor.
 * Verifies that `generateSecretConstants` produces valid TypeScript const declarations.
 */

import { describe, test, expect } from 'bun:test';
import type { ExecutionContext } from './types.js';
import { generateSecretConstants, isValidIdentifier } from './executor.js';

describe('generateSecretConstants', () => {
  test('returns empty string when context is undefined', () => {
    const result = generateSecretConstants(undefined);
    expect(result).toBe('');
  });

  test('returns empty string when secrets is undefined', () => {
    const result = generateSecretConstants({});
    expect(result).toBe('');
  });

  test('returns empty string when secrets object is empty', () => {
    const context: ExecutionContext = { secrets: {} };
    const result = generateSecretConstants(context);
    expect(result).toBe('');
  });

  test('generates const declaration for a single secret', () => {
    const context: ExecutionContext = { secrets: { API_KEY: 'secret-value' } };
    const result = generateSecretConstants(context);

    expect(result).toContain('const API_KEY = "secret-value";');
  });

  test('generates const declarations for multiple secrets', () => {
    const context: ExecutionContext = {
      secrets: {
        API_KEY: 'key-value',
        DB_PASSWORD: 'pass-value',
        TOKEN: 'token-value',
      },
    };
    const result = generateSecretConstants(context);

    expect(result).toContain('const API_KEY = "key-value";');
    expect(result).toContain('const DB_PASSWORD = "pass-value";');
    expect(result).toContain('const TOKEN = "token-value";');
  });

  test('properly JSON-escapes values with quotes', () => {
    const context: ExecutionContext = { secrets: { API_KEY: 'value with "quotes"' } };
    const result = generateSecretConstants(context);

    expect(result).toContain('const API_KEY = "value with \\"quotes\\"";');
  });

  test('properly JSON-escapes values with newlines', () => {
    const context: ExecutionContext = { secrets: { MULTILINE: 'line1\nline2' } };
    const result = generateSecretConstants(context);

    expect(result).toContain('const MULTILINE = "line1\\nline2";');
  });

  test('properly JSON-escapes values with backslashes', () => {
    const context: ExecutionContext = { secrets: { PATH: 'C:\\Users\\test' } };
    const result = generateSecretConstants(context);

    expect(result).toContain('const PATH = "C:\\\\Users\\\\test";');
  });

  test('generates valid TypeScript that can be evaluated', () => {
    const context: ExecutionContext = {
      secrets: {
        SECRET1: 'value1',
        SECRET2: 'value2',
      },
    };
    const code = generateSecretConstants(context);

    // This should not throw when evaluated
    const fn = new Function(code + '; return { SECRET1, SECRET2 }');
    const result = fn();

    expect(result.SECRET1).toBe('value1');
    expect(result.SECRET2).toBe('value2');
  });

  test('each secret is on its own line', () => {
    const context: ExecutionContext = {
      secrets: {
        KEY1: 'val1',
        KEY2: 'val2',
      },
    };
    const result = generateSecretConstants(context);
    const lines = result.split('\n');

    expect(lines.length).toBe(2);
    expect(lines[0]).toMatch(/^const KEY\d = "val\d";$/);
    expect(lines[1]).toMatch(/^const KEY\d = "val\d";$/);
  });

  test('handles secrets with special characters in keys', () => {
    const context: ExecutionContext = { secrets: { MY_API_KEY_123: 'secret' } };
    const result = generateSecretConstants(context);

    expect(result).toContain('const MY_API_KEY_123 = "secret";');
  });

  test('handles empty string values', () => {
    const context: ExecutionContext = { secrets: { EMPTY: '' } };
    const result = generateSecretConstants(context);

    expect(result).toContain('const EMPTY = "";');
  });

  test('includes context with secrets and other fields', () => {
    const context: ExecutionContext = {
      bluesky: {
        service: 'https://bsky.social',
        pdsUrl: 'https://pds.bsky.social',
        accessToken: 'token',
        refreshToken: 'refresh',
        did: 'did:plc:123',
        handle: 'test.bsky.social',
      },
      secrets: { API_KEY: 'secret' },
    };
    const result = generateSecretConstants(context);

    // Should only generate secret constants, not Bluesky credentials
    expect(result).toContain('const API_KEY = "secret";');
    expect(result).not.toContain('BSKY');
  });

  describe('security: defense against code injection via key names', () => {
    test('skips runtime binding collisions while retaining valid secrets', () => {
      const context: ExecutionContext = {
        secrets: {Deno: 'bad', output: 'bad', console: 'bad', __callTool__: 'bad', VALID_KEY: 'good'},
      };
      const warnings: Array<string> = [];
      const originalWarn = console.warn;
      console.warn = (message: string): void => { warnings.push(message); };
      try {
        const result = generateSecretConstants(context);
        expect(result).toBe('const VALID_KEY = "good";');
      } finally {
        console.warn = originalWarn;
      }
      expect(warnings).toHaveLength(4);
      expect(warnings.every((warning) => warning.includes('reserved by execution environment'))).toBe(true);
    });

    test('skips keys with invalid identifiers (injection attempt: semicolon and statement)', () => {
      const context: ExecutionContext = {
        secrets: {
          'x = 1; malicious(); const y': 'payload',
          VALID_KEY: 'value',
        },
      };
      const result = generateSecretConstants(context);

      // Should only contain the valid key, not the injection attempt
      expect(result).toContain('const VALID_KEY = "value";');
      expect(result).not.toContain('malicious');
      expect(result).not.toContain('x = 1');
    });

    test('skips keys starting with a digit', () => {
      const context: ExecutionContext = {
        secrets: {
          '123_KEY': 'value',
          VALID_KEY: 'value',
        },
      };
      const result = generateSecretConstants(context);

      expect(result).toContain('const VALID_KEY = "value";');
      expect(result).not.toContain('123_KEY');
    });

    test('skips keys with hyphens (common but invalid in identifiers)', () => {
      const context: ExecutionContext = {
        secrets: {
          'MY-API-KEY': 'value',
          MY_API_KEY: 'value',
        },
      };
      const result = generateSecretConstants(context);

      expect(result).toContain('const MY_API_KEY = "value";');
      expect(result).not.toContain('MY-API-KEY');
    });

    test('skips keys with spaces', () => {
      const context: ExecutionContext = {
        secrets: {
          'MY API KEY': 'value',
          MY_API_KEY: 'value',
        },
      };
      const result = generateSecretConstants(context);

      expect(result).toContain('const MY_API_KEY = "value";');
      expect(result).not.toContain('MY API KEY');
    });

    test('skips keys with dots', () => {
      const context: ExecutionContext = {
        secrets: {
          'api.key': 'value',
          api_key: 'value',
        },
      };
      const result = generateSecretConstants(context);

      expect(result).toContain('const api_key = "value";');
      expect(result).not.toContain('api.key');
    });

    test('accepts keys starting with underscore', () => {
      const context: ExecutionContext = { secrets: { _PRIVATE_KEY: 'value' } };
      const result = generateSecretConstants(context);

      expect(result).toContain('const _PRIVATE_KEY = "value";');
    });

    test('accepts keys starting with dollar sign', () => {
      const context: ExecutionContext = { secrets: { $SPECIAL_KEY: 'value' } };
      const result = generateSecretConstants(context);

      expect(result).toContain('const $SPECIAL_KEY = "value";');
    });

    test('result with injected keys still produces valid TypeScript', () => {
      // If somehow we had an invalid key, the valid ones should still be evaluable
      const context: ExecutionContext = {
        secrets: {
          'x = 1; bad();': 'bad',
          VALID1: 'v1',
          VALID2: 'v2',
        },
      };
      const code = generateSecretConstants(context);

      // Should not throw when evaluated
      const fn = new Function(code + '; return { VALID1, VALID2 }');
      const result = fn();

      expect(result.VALID1).toBe('v1');
      expect(result.VALID2).toBe('v2');
    });
  });
});

describe('isValidIdentifier', () => {
  test('accepts valid identifiers', () => {
    expect(isValidIdentifier('myKey')).toBe(true);
    expect(isValidIdentifier('MY_KEY')).toBe(true);
    expect(isValidIdentifier('_privateKey')).toBe(true);
    expect(isValidIdentifier('$special')).toBe(true);
    expect(isValidIdentifier('API_KEY_123')).toBe(true);
    expect(isValidIdentifier('a')).toBe(true);
    expect(isValidIdentifier('_')).toBe(true);
    expect(isValidIdentifier('$')).toBe(true);
  });

  test('rejects invalid identifiers', () => {
    expect(isValidIdentifier('123key')).toBe(false);
    expect(isValidIdentifier('my-key')).toBe(false);
    expect(isValidIdentifier('my key')).toBe(false);
    expect(isValidIdentifier('my.key')).toBe(false);
    expect(isValidIdentifier('my@key')).toBe(false);
    expect(isValidIdentifier('')).toBe(false);
    expect(isValidIdentifier('x = 1; bad()')).toBe(false);
    expect(isValidIdentifier('key;')).toBe(false);
  });
});
