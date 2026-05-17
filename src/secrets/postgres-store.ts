// pattern: Imperative Shell

import type { PersistenceProvider } from '@/persistence/types.js';
import type { SecretStore } from './types.js';

export function createPostgresSecretStore(persistence: PersistenceProvider): SecretStore {
  return {
    async get(owner, key) {
      const rows = await persistence.query<{ value: string }>(
        'SELECT value FROM secrets WHERE owner = $1 AND key = $2',
        [owner, key],
      );
      return rows[0]?.value ?? null;
    },

    async set(owner, key, value) {
      await persistence.query(
        `INSERT INTO secrets (owner, key, value, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (owner, key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [owner, key, value],
      );
    },

    async delete(owner, key) {
      const rows = await persistence.query(
        'DELETE FROM secrets WHERE owner = $1 AND key = $2 RETURNING key',
        [owner, key],
      );
      return rows.length > 0;
    },

    async listKeys(owner) {
      const rows = await persistence.query<{ key: string }>(
        'SELECT key FROM secrets WHERE owner = $1 ORDER BY key',
        [owner],
      );
      return rows.map(r => r.key);
    },
  };
}
