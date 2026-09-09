import {describe, it, expect, beforeAll, afterEach, afterAll} from 'bun:test';
import {createTestDatabase, teardownTestDatabase, type TestDatabase} from '@/testing/test-database.ts';

let database: TestDatabase;

async function cleanupTables(): Promise<void> {
  await database.persistence.query('TRUNCATE TABLE tx_test');
}

async function createTestTable(): Promise<void> {
  await database.persistence.query(`
    CREATE TABLE IF NOT EXISTS tx_test (
      id SERIAL PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}

describe('arch-hardening.AC2: Nested transaction support via savepoints', () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    await createTestTable();
  });

  afterEach(async () => {
    await cleanupTables();
  });

  afterAll(async () => {
    if (database) {
      await database.persistence.query('DROP TABLE IF EXISTS tx_test');
      await teardownTestDatabase(database);
    }
  });

  it('inserts row inside withTransaction and is visible after commit', async () => {
    await database.persistence.withTransaction(async (query) => {
      await query('INSERT INTO tx_test (value) VALUES ($1)', ['committed']);
    });
    const result = await database.persistence.query<{value: string}>('SELECT value FROM tx_test');
    expect(result).toHaveLength(1);
    expect(result[0]?.value).toBe('committed');
  });

  it('rolls back transaction on error', async () => {
    try {
      await database.persistence.withTransaction(async (query) => {
        await query('INSERT INTO tx_test (value) VALUES ($1)', ['rolledback']);
        throw new Error('test rollback');
      });
    } catch {
      // expected
    }
    const result = await database.persistence.query<{value: string}>('SELECT value FROM tx_test');
    expect(result).toHaveLength(0);
  });

  it('inserts rows at both levels and both are visible', async () => {
    await database.persistence.withTransaction(async (query) => {
      await query('INSERT INTO tx_test (value) VALUES ($1)', ['outer']);
      await database.persistence.withTransaction(async (innerQuery) => {
        await innerQuery('INSERT INTO tx_test (value) VALUES ($1)', ['inner']);
      });
    });
    const result = await database.persistence.query<{value: string}>('SELECT value FROM tx_test ORDER BY value');
    expect(result.map((row) => row.value)).toEqual(['inner', 'outer']);
  });

  it('supports 3 levels of nesting with distinct rows from each level', async () => {
    await database.persistence.withTransaction(async (query) => {
      await query('INSERT INTO tx_test (value) VALUES ($1)', ['level0']);
      await database.persistence.withTransaction(async (innerQuery1) => {
        await innerQuery1('INSERT INTO tx_test (value) VALUES ($1)', ['level1']);
        await database.persistence.withTransaction(async (innerQuery2) => {
          await innerQuery2('INSERT INTO tx_test (value) VALUES ($1)', ['level2']);
        });
      });
    });
    const result = await database.persistence.query<{value: string}>('SELECT value FROM tx_test ORDER BY value');
    expect(result.map((row) => row.value)).toEqual(['level0', 'level1', 'level2']);
  });

  it('propagates nested error and rolls back all changes', async () => {
    try {
      await database.persistence.withTransaction(async (query) => {
        await query('INSERT INTO tx_test (value) VALUES ($1)', ['outer']);
        await database.persistence.withTransaction(async (innerQuery) => {
          await innerQuery('INSERT INTO tx_test (value) VALUES ($1)', ['inner']);
          throw new Error('nested error');
        });
      });
    } catch {
      // expected
    }
    const result = await database.persistence.query<{value: string}>('SELECT value FROM tx_test');
    expect(result).toHaveLength(0);
  });

  it('catches nested error, rolls back savepoint, and parent continues', async () => {
    await database.persistence.withTransaction(async (query) => {
      await query('INSERT INTO tx_test (value) VALUES ($1)', ['rowA']);
      try {
        await database.persistence.withTransaction(async (innerQuery) => {
          await innerQuery('INSERT INTO tx_test (value) VALUES ($1)', ['rowB']);
          throw new Error('nested error');
        });
      } catch {
        // savepoint rollback is expected
      }
      await query('INSERT INTO tx_test (value) VALUES ($1)', ['rowC']);
    });
    const result = await database.persistence.query<{value: string}>('SELECT value FROM tx_test ORDER BY value');
    expect(result.map((row) => row.value)).toEqual(['rowA', 'rowC']);
  });

  it('uses pool directly for non-transactional queries', async () => {
    await database.persistence.query('INSERT INTO tx_test (value) VALUES ($1)', ['immediate']);
    const result = await database.persistence.query<{value: string}>('SELECT value FROM tx_test');
    expect(result).toHaveLength(1);
    expect(result[0]?.value).toBe('immediate');
  });
});
