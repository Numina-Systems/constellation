import {describe, expect, it} from 'bun:test';
import {createTestDatabase, teardownTestDatabase} from './test-database.ts';

describe('Phase 0 isolated PostgreSQL integration gate', () => {
  it('integration_mode_requires_database', async () => {
    const adminUrl = process.env['TEST_DATABASE_ADMIN_URL'];
    if (!adminUrl) {
      throw new Error('integration prerequisites unavailable: TEST_DATABASE_ADMIN_URL is required; refusing to skip');
    }
    const database = await createTestDatabase({adminUrl});
    try {
      const rows = await database.persistence.query<{value: number}>('SELECT 1 AS value');
      expect(rows[0]?.value).toBe(1);
    } finally {
      await teardownTestDatabase(database);
    }
  });
});
