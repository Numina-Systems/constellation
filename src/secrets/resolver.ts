// pattern: Imperative Shell

import { SecretsError } from '@/errors/secrets.js';
import type { SecretStore } from './types.js';

export type SecretResolver = {
  resolve(keys: ReadonlyArray<string>): Promise<Record<string, string>>;
  listKeys(): Promise<ReadonlyArray<string>>;
};

type SecretResolverOptions = {
  readonly store: SecretStore;
  readonly owner: string;
  readonly configSecrets: Readonly<Record<string, string>>;
};

export function createSecretResolver(options: SecretResolverOptions): SecretResolver {
  const { store, owner, configSecrets } = options;

  return {
    async resolve(keys) {
      try {
        const result: Record<string, string> = {};
        for (const key of keys) {
          if (key in configSecrets) {
            result[key] = configSecrets[key]!;
            continue;
          }
          const stored = await store.get(owner, key);
          if (stored !== null) {
            result[key] = stored;
          }
        }
        return result;
      } catch (error) {
        if (error instanceof SecretsError) {
          throw error;
        }
        throw new SecretsError('RESOLVE_FAILED', `failed to resolve secrets`, { keyCount: keys.length }, { cause: error as Error });
      }
    },

    async listKeys() {
      try {
        const storedKeys = await store.listKeys(owner);
        const configKeys = Object.keys(configSecrets);
        const allKeys = new Set([...configKeys, ...storedKeys]);
        return [...allKeys].sort();
      } catch (error) {
        if (error instanceof SecretsError) {
          throw error;
        }
        throw new SecretsError('RESOLVE_FAILED', `failed to list secret keys`, {}, { cause: error as Error });
      }
    },
  };
}
