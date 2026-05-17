import { describe, it, expect, beforeAll, afterEach, afterAll } from 'bun:test';
import { createPostgresProvider } from '../persistence/postgres.ts';
import { createPostgresSecretStore } from './postgres-store.ts';

const DB_CONNECTION_STRING =
  'postgresql://constellation:constellation@localhost:5432/constellation';

let persistence: ReturnType<typeof createPostgresProvider>;
const TEST_OWNER = 'test-secrets-' + Math.random().toString(36).substring(7);

async function cleanupSecrets(): Promise<void> {
  await persistence.query('DELETE FROM secrets WHERE owner = $1', [TEST_OWNER]);
}

describe('PostgresSecretStore', () => {
  beforeAll(async () => {
    persistence = createPostgresProvider({
      url: DB_CONNECTION_STRING,
    });

    await persistence.connect();
    await persistence.runMigrations();
    await cleanupSecrets();
  });

  afterEach(async () => {
    await cleanupSecrets();
  });

  afterAll(async () => {
    await persistence.disconnect();
  });

  describe('knowledge-autonomy.AC1.1: set and get', () => {
    it('stores a secret and retrieves it', async () => {
      const store = createPostgresSecretStore(persistence);

      await store.set(TEST_OWNER, 'MY_KEY', 'my_secret_value');
      const value = await store.get(TEST_OWNER, 'MY_KEY');

      expect(value).toBe('my_secret_value');
    });

    it('updates the value when setting an existing key', async () => {
      const store = createPostgresSecretStore(persistence);

      await store.set(TEST_OWNER, 'MY_KEY', 'first_value');
      await store.set(TEST_OWNER, 'MY_KEY', 'updated_value');
      const value = await store.get(TEST_OWNER, 'MY_KEY');

      expect(value).toBe('updated_value');
    });

    it('returns null for non-existent secret', async () => {
      const store = createPostgresSecretStore(persistence);

      const value = await store.get(TEST_OWNER, 'NONEXISTENT');

      expect(value).toBeNull();
    });
  });

  describe('knowledge-autonomy.AC1.3: delete', () => {
    it('deletes a secret and returns true', async () => {
      const store = createPostgresSecretStore(persistence);

      await store.set(TEST_OWNER, 'MY_KEY', 'my_secret_value');
      const deleted = await store.delete(TEST_OWNER, 'MY_KEY');
      const value = await store.get(TEST_OWNER, 'MY_KEY');

      expect(deleted).toBe(true);
      expect(value).toBeNull();
    });

    it('returns false when deleting non-existent secret', async () => {
      const store = createPostgresSecretStore(persistence);

      const deleted = await store.delete(TEST_OWNER, 'NONEXISTENT');

      expect(deleted).toBe(false);
    });
  });

  describe('listKeys', () => {
    it('returns all keys for owner, sorted alphabetically', async () => {
      const store = createPostgresSecretStore(persistence);

      await store.set(TEST_OWNER, 'ZEBRA', 'z');
      await store.set(TEST_OWNER, 'ALPHA', 'a');
      await store.set(TEST_OWNER, 'BETA', 'b');

      const keys = await store.listKeys(TEST_OWNER);

      expect(keys).toEqual(['ALPHA', 'BETA', 'ZEBRA']);
    });

    it('returns empty array for owner with no secrets', async () => {
      const store = createPostgresSecretStore(persistence);

      const keys = await store.listKeys(TEST_OWNER);

      expect(keys).toEqual([]);
    });
  });

  describe('getAll', () => {
    it('returns all secrets for owner as a single object', async () => {
      const store = createPostgresSecretStore(persistence);

      await store.set(TEST_OWNER, 'KEY1', 'value1');
      await store.set(TEST_OWNER, 'KEY2', 'value2');
      await store.set(TEST_OWNER, 'KEY3', 'value3');

      const allSecrets = await store.getAll(TEST_OWNER);

      expect(allSecrets).toEqual({
        KEY1: 'value1',
        KEY2: 'value2',
        KEY3: 'value3',
      });
    });

    it('returns empty object for owner with no secrets', async () => {
      const store = createPostgresSecretStore(persistence);

      const allSecrets = await store.getAll(TEST_OWNER);

      expect(allSecrets).toEqual({});
    });

    it('returns secrets in single query (batch efficiency)', async () => {
      const store = createPostgresSecretStore(persistence);

      // Set many secrets to verify they all come back in one call
      const secretCount = 10;
      for (let i = 0; i < secretCount; i++) {
        await store.set(TEST_OWNER, `KEY_${i}`, `value_${i}`);
      }

      const allSecrets = await store.getAll(TEST_OWNER);

      expect(Object.keys(allSecrets).length).toBe(secretCount);
      for (let i = 0; i < secretCount; i++) {
        expect(allSecrets[`KEY_${i}`]).toBe(`value_${i}`);
      }
    });
  });

  describe('owner isolation', () => {
    it('secrets from owner A are not visible to owner B', async () => {
      const store = createPostgresSecretStore(persistence);
      const OWNER_A = 'owner-a-' + Math.random().toString(36).substring(7);
      const OWNER_B = 'owner-b-' + Math.random().toString(36).substring(7);

      await store.set(OWNER_A, 'SECRET_A', 'value_a');
      await store.set(OWNER_B, 'SECRET_B', 'value_b');

      const keysA = await store.listKeys(OWNER_A);
      const keysB = await store.listKeys(OWNER_B);
      const valueA = await store.get(OWNER_B, 'SECRET_A');

      expect(keysA).toEqual(['SECRET_A']);
      expect(keysB).toEqual(['SECRET_B']);
      expect(valueA).toBeNull();

      // cleanup
      await persistence.query('DELETE FROM secrets WHERE owner IN ($1, $2)', [OWNER_A, OWNER_B]);
    });

    it('getAll only returns secrets for the specified owner', async () => {
      const store = createPostgresSecretStore(persistence);
      const OWNER_A = 'owner-a-' + Math.random().toString(36).substring(7);
      const OWNER_B = 'owner-b-' + Math.random().toString(36).substring(7);

      await store.set(OWNER_A, 'SECRET_A', 'value_a');
      await store.set(OWNER_B, 'SECRET_B', 'value_b');

      const allA = await store.getAll(OWNER_A);
      const allB = await store.getAll(OWNER_B);

      expect(allA).toEqual({ SECRET_A: 'value_a' });
      expect(allB).toEqual({ SECRET_B: 'value_b' });

      // cleanup
      await persistence.query('DELETE FROM secrets WHERE owner IN ($1, $2)', [OWNER_A, OWNER_B]);
    });
  });
});
