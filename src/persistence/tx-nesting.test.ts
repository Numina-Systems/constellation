import { describe, it, expect, beforeAll, afterEach, afterAll } from 'bun:test';
import { createPostgresProvider } from './postgres.ts';

const DB_CONNECTION_STRING =
  'postgresql://constellation:constellation@localhost:5432/constellation';

let persistence: ReturnType<typeof createPostgresProvider>;

async function cleanupTables(): Promise<void> {
  try {
    await persistence.query('TRUNCATE TABLE tx_test');
  } catch {
    // table may not exist yet
  }
}

async function createTestTable(): Promise<void> {
  try {
    await persistence.query(`
      CREATE TABLE IF NOT EXISTS tx_test (
        id SERIAL PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
  } catch {
    // Table already exists
  }
}

describe('arch-hardening.AC2: Nested transaction support via savepoints', () => {
  beforeAll(async () => {
    persistence = createPostgresProvider({
      url: DB_CONNECTION_STRING,
    });

    await persistence.connect();
    await persistence.runMigrations();

    // Create scratch table for testing
    await createTestTable();
  });

  afterEach(async () => {
    await cleanupTables();
  });

  afterAll(async () => {
    // Drop test table
    await persistence.query('DROP TABLE IF EXISTS tx_test');
    await persistence.disconnect();
  });

  describe('arch-hardening.AC2.1: Top-level transaction issues BEGIN/COMMIT', () => {
    it('inserts row inside withTransaction and is visible after commit', async () => {
      await persistence.withTransaction(async (query) => {
        await query('INSERT INTO tx_test (value) VALUES ($1)', ['committed']);
      });

      const result = await persistence.query<{ value: string }>(
        'SELECT value FROM tx_test'
      );

      expect(result).toHaveLength(1);
      if (result.length > 0) {
        expect(result[0]!.value).toBe('committed');
      }
    });

    it('rolls back transaction on error', async () => {
      try {
        await persistence.withTransaction(async (query) => {
          await query('INSERT INTO tx_test (value) VALUES ($1)', ['rolledback']);
          throw new Error('Test rollback');
        });
      } catch {
        // Expected
      }

      const result = await persistence.query<{ value: string }>(
        'SELECT value FROM tx_test'
      );

      expect(result).toHaveLength(0);
    });
  });

  describe('arch-hardening.AC2.2: Nested withTransaction uses SAVEPOINT', () => {
    it('inserts rows at both levels and both are visible', async () => {
      await persistence.withTransaction(async (query) => {
        await query('INSERT INTO tx_test (value) VALUES ($1)', ['outer']);

        await persistence.withTransaction(async (innerQuery) => {
          await innerQuery('INSERT INTO tx_test (value) VALUES ($1)', ['inner']);
        });
      });

      const result = await persistence.query<{ value: string }>(
        'SELECT value FROM tx_test ORDER BY value'
      );

      expect(result).toHaveLength(2);
      if (result.length >= 2) {
        expect(result[0]!.value).toBe('inner');
        expect(result[1]!.value).toBe('outer');
      }
    });
  });

  describe('arch-hardening.AC2.3: Deeply nested transactions use unique savepoint names', () => {
    it('supports 3 levels of nesting with distinct rows from each level', async () => {
      await persistence.withTransaction(async (query) => {
        await query('INSERT INTO tx_test (value) VALUES ($1)', ['level0']);

        await persistence.withTransaction(async (innerQuery1) => {
          await innerQuery1('INSERT INTO tx_test (value) VALUES ($1)', ['level1']);

          await persistence.withTransaction(async (innerQuery2) => {
            await innerQuery2('INSERT INTO tx_test (value) VALUES ($1)', ['level2']);
          });
        });
      });

      const result = await persistence.query<{ value: string }>(
        'SELECT value FROM tx_test ORDER BY value'
      );

      expect(result).toHaveLength(3);
      if (result.length >= 3) {
        expect(result[0]!.value).toBe('level0');
        expect(result[1]!.value).toBe('level1');
        expect(result[2]!.value).toBe('level2');
      }
    });
  });

  describe('arch-hardening.AC2.4: Nested error + rethrow rolls back entire transaction', () => {
    it('propagates nested error and rolls back all changes', async () => {
      try {
        await persistence.withTransaction(async (query) => {
          await query('INSERT INTO tx_test (value) VALUES ($1)', ['outer']);

          await persistence.withTransaction(async (innerQuery) => {
            await innerQuery('INSERT INTO tx_test (value) VALUES ($1)', ['inner']);
            throw new Error('Nested error');
          });
        });
      } catch {
        // Expected: outer catches nothing, rethrows
      }

      const result = await persistence.query<{ value: string }>(
        'SELECT value FROM tx_test'
      );

      expect(result).toHaveLength(0);
    });
  });

  describe('arch-hardening.AC2.5: Nested error + catch rolls back savepoint but parent continues', () => {
    it('catches nested error, rolls back savepoint, but parent can insert successfully', async () => {
      await persistence.withTransaction(async (query) => {
        await query('INSERT INTO tx_test (value) VALUES ($1)', ['rowA']);

        try {
          await persistence.withTransaction(async (innerQuery) => {
            await innerQuery('INSERT INTO tx_test (value) VALUES ($1)', ['rowB']);
            throw new Error('Nested error');
          });
        } catch {
          // Catch the error: savepoint is rolled back
        }

        // Parent continues and inserts rowC
        await query('INSERT INTO tx_test (value) VALUES ($1)', ['rowC']);
      });

      const result = await persistence.query<{ value: string }>(
        'SELECT value FROM tx_test ORDER BY value'
      );

      expect(result).toHaveLength(2);
      if (result.length >= 2) {
        expect(result[0]!.value).toBe('rowA');
        expect(result[1]!.value).toBe('rowC');
      }
      // rowB should not be visible
    });
  });

  describe('Non-transactional queries', () => {
    it('uses pool directly and is immediately visible', async () => {
      await persistence.query('INSERT INTO tx_test (value) VALUES ($1)', ['immediate']);

      const result = await persistence.query<{ value: string }>(
        'SELECT value FROM tx_test'
      );

      expect(result).toHaveLength(1);
      if (result.length > 0) {
        expect(result[0]!.value).toBe('immediate');
      }
    });
  });
});
