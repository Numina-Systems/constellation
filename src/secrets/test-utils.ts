// pattern: Functional Core

/**
 * Shared test utilities for SecretStore mocking.
 */

import type { SecretStore } from './types.js';

export function createMockSecretStore(data: Record<string, string>): SecretStore {
  return {
    async get(_owner, key) {
      return data[key] ?? null;
    },
    async set(_owner, key, value) {
      data[key] = value;
    },
    async delete(_owner, key) {
      const had = key in data;
      delete data[key];
      return had;
    },
    async listKeys(_owner) {
      return Object.keys(data).sort();
    },
    async getAll(_owner) {
      return { ...data };
    },
  };
}
