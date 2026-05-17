// pattern: Imperative Shell

import type { PersistenceProvider } from '@/persistence/types.js';
import { SecretsError } from '@/errors/secrets.js';
import type { SecretStore } from './types.js';

export function createPostgresSecretStore(persistence: PersistenceProvider): SecretStore {
  return {
    async get(owner, key) {
      try {
        const rows = await persistence.query<{ value: string }>(
          'SELECT value FROM secrets WHERE owner = $1 AND key = $2',
          [owner, key],
        );
        return rows[0]?.value ?? null;
      } catch (error) {
        throw new SecretsError('STORE_FAILED', `failed to retrieve secret`, { key }, { cause: error as Error });
      }
    },

    async set(owner, key, value) {
      try {
        await persistence.query(
          `INSERT INTO secrets (owner, key, value, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (owner, key)
           DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [owner, key, value],
        );
      } catch (error) {
        throw new SecretsError('STORE_FAILED', `failed to store secret`, { key }, { cause: error as Error });
      }
    },

    async delete(owner, key) {
      try {
        const rows = await persistence.query(
          'DELETE FROM secrets WHERE owner = $1 AND key = $2 RETURNING key',
          [owner, key],
        );
        return rows.length > 0;
      } catch (error) {
        throw new SecretsError('STORE_FAILED', `failed to delete secret`, { key }, { cause: error as Error });
      }
    },

    async listKeys(owner) {
      try {
        const rows = await persistence.query<{ key: string }>(
          'SELECT key FROM secrets WHERE owner = $1 ORDER BY key',
          [owner],
        );
        return rows.map(r => r.key);
      } catch (error) {
        throw new SecretsError('STORE_FAILED', `failed to list secrets`, {}, { cause: error as Error });
      }
    },

    async getAll(owner) {
      try {
        const rows = await persistence.query<{ key: string; value: string }>(
          'SELECT key, value FROM secrets WHERE owner = $1',
          [owner],
        );
        const result: Record<string, string> = {};
        for (const row of rows) {
          result[row.key] = row.value;
        }
        return result;
      } catch (error) {
        throw new SecretsError('STORE_FAILED', `failed to fetch all secrets`, {}, { cause: error as Error });
      }
    },
  };
}
