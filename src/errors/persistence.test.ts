import { describe, expect, test } from 'bun:test';
import { ConstellationError } from './base.js';
import { PersistenceError, sanitizeQuery } from './persistence.js';

describe('PersistenceError', () => {
  // AC2.5: Each PersistenceErrorCode constructs a valid PersistenceError
  test('constructs CONNECTION_FAILED error', () => {
    const error = new PersistenceError('CONNECTION_FAILED', 'Connection failed');
    expect(error).toBeDefined();
    expect(error.code).toBe('CONNECTION_FAILED');
  });

  test('constructs MIGRATION_FAILED error', () => {
    const error = new PersistenceError('MIGRATION_FAILED', 'Migration failed');
    expect(error).toBeDefined();
    expect(error.code).toBe('MIGRATION_FAILED');
  });

  test('constructs QUERY_FAILED error', () => {
    const error = new PersistenceError('QUERY_FAILED', 'Query failed');
    expect(error).toBeDefined();
    expect(error.code).toBe('QUERY_FAILED');
  });

  // AC2.6: QUERY_FAILED includes sanitized query context
  test('QUERY_FAILED includes sanitized query in context', () => {
    const query = 'SELECT * FROM messages WHERE id = $1';
    const error = new PersistenceError(
      'QUERY_FAILED',
      'Query failed',
      { query: sanitizeQuery(query) }
    );
    expect(error.context).toBeDefined();
    expect(error.context['query']).toBe('SELECT * FROM messages WHERE id = $1');
  });

  // Instanceof checks
  test('PersistenceError is instanceof PersistenceError', () => {
    const error = new PersistenceError('CONNECTION_FAILED', 'Connection failed');
    expect(error instanceof PersistenceError).toBe(true);
  });

  test('PersistenceError is instanceof ConstellationError', () => {
    const error = new PersistenceError('CONNECTION_FAILED', 'Connection failed');
    expect(error instanceof ConstellationError).toBe(true);
  });

  test('PersistenceError is instanceof Error', () => {
    const error = new PersistenceError('CONNECTION_FAILED', 'Connection failed');
    expect(error instanceof Error).toBe(true);
  });

  test('toDisplayString formats correctly', () => {
    const error = new PersistenceError('QUERY_FAILED', 'Query failed');
    expect(error.toDisplayString()).toBe('[persistence:QUERY_FAILED] Query failed');
  });

  test('toDisplayString includes suggestion when provided', () => {
    const error = new PersistenceError(
      'CONNECTION_FAILED',
      'Connection failed',
      {},
      { suggestion: 'Check database server is running' }
    );
    expect(error.toDisplayString()).toBe(
      '[persistence:CONNECTION_FAILED] Connection failed — Suggestion: Check database server is running'
    );
  });

  test('default context is empty object when not provided', () => {
    const error = new PersistenceError('CONNECTION_FAILED', 'Connection failed');
    expect(error.context).toEqual({});
  });
});

describe('sanitizeQuery', () => {
  test('normalizes whitespace to single spaces', () => {
    const multiline = `SELECT   *
      FROM messages
      WHERE id = $1`;
    const result = sanitizeQuery(multiline);
    expect(result).toBe('SELECT * FROM messages WHERE id = $1');
  });

  test('trims leading and trailing whitespace', () => {
    const query = '   SELECT * FROM messages   ';
    const result = sanitizeQuery(query);
    expect(result).toBe('SELECT * FROM messages');
  });

  test('truncates queries longer than 200 characters', () => {
    const longQuery = 'SELECT ' + 'column, '.repeat(50);
    const result = sanitizeQuery(longQuery);
    expect(result.length).toBeLessThanOrEqual(200);
  });

  test('preserves parameter placeholders', () => {
    const query = 'INSERT INTO foo VALUES ($1, $2, $3)';
    const result = sanitizeQuery(query);
    expect(result).toContain('$1');
    expect(result).toContain('$2');
    expect(result).toContain('$3');
  });

  test('handles complex parameterized query', () => {
    const query = `UPDATE users SET name = $1, email = $2
                   WHERE id = $3 AND status = $4`;
    const result = sanitizeQuery(query);
    expect(result).toContain('$1');
    expect(result).toContain('$2');
    expect(result).toContain('$3');
    expect(result).toContain('$4');
    expect(result).not.toContain('\n');
  });
});
