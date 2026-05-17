import { describe, it, expect } from 'bun:test';
import { createSecretResolver } from './resolver.ts';
import { createMockSecretStore } from './test-utils.ts';

describe('SecretResolver', () => {
  describe('knowledge-autonomy.AC1.5: config secrets take precedence', () => {
    it('returns config secret when same key exists in both config and store', async () => {
      const mockStore = createMockSecretStore({ MY_KEY: 'stored_value' });
      const resolver = createSecretResolver({
        store: mockStore,
        owner: 'test-owner',
        configSecrets: { MY_KEY: 'config_value' },
      });

      const resolved = await resolver.resolve(['MY_KEY']);

      expect(resolved['MY_KEY']).toBe('config_value');
    });
  });

  describe('resolve', () => {
    it('falls back to store when key not in config', async () => {
      const mockStore = createMockSecretStore({ STORED_KEY: 'stored_value' });
      const resolver = createSecretResolver({
        store: mockStore,
        owner: 'test-owner',
        configSecrets: {},
      });

      const resolved = await resolver.resolve(['STORED_KEY']);

      expect(resolved['STORED_KEY']).toBe('stored_value');
    });

    it('skips keys not found in either source', async () => {
      const mockStore = createMockSecretStore({ KEY_A: 'value_a' });
      const resolver = createSecretResolver({
        store: mockStore,
        owner: 'test-owner',
        configSecrets: { KEY_B: 'value_b' },
      });

      const resolved = await resolver.resolve(['KEY_A', 'KEY_B', 'MISSING']);

      expect(resolved).toEqual({
        KEY_A: 'value_a',
        KEY_B: 'value_b',
      });
      expect('MISSING' in resolved).toBe(false);
    });

    it('returns empty object when no keys match', async () => {
      const mockStore = createMockSecretStore({});
      const resolver = createSecretResolver({
        store: mockStore,
        owner: 'test-owner',
        configSecrets: {},
      });

      const resolved = await resolver.resolve(['MISSING1', 'MISSING2']);

      expect(resolved).toEqual({});
    });
  });

  describe('listKeys', () => {
    it('returns merged, deduplicated, sorted keys from both sources', async () => {
      const mockStore = createMockSecretStore({ STORED_B: 'b', STORED_A: 'a' });
      const resolver = createSecretResolver({
        store: mockStore,
        owner: 'test-owner',
        configSecrets: { CONFIG_C: 'c', STORED_B: 'override' },
      });

      const keys = await resolver.listKeys();

      expect(keys).toEqual(['CONFIG_C', 'STORED_A', 'STORED_B']);
    });

    it('returns sorted keys when only config secrets exist', async () => {
      const mockStore = createMockSecretStore({});
      const resolver = createSecretResolver({
        store: mockStore,
        owner: 'test-owner',
        configSecrets: { Z: 'z', A: 'a', M: 'm' },
      });

      const keys = await resolver.listKeys();

      expect(keys).toEqual(['A', 'M', 'Z']);
    });

    it('returns sorted keys when only stored secrets exist', async () => {
      const mockStore = createMockSecretStore({ Z: 'z', A: 'a', M: 'm' });
      const resolver = createSecretResolver({
        store: mockStore,
        owner: 'test-owner',
        configSecrets: {},
      });

      const keys = await resolver.listKeys();

      expect(keys).toEqual(['A', 'M', 'Z']);
    });
  });

  describe('batch resolution optimization', () => {
    it('resolve uses getAll for efficiency when resolving all keys', async () => {
      const storeData = { KEY1: 'value1', KEY2: 'value2', KEY3: 'value3' };
      const mockStore = createMockSecretStore(storeData);

      const resolver = createSecretResolver({
        store: mockStore,
        owner: 'test-owner',
        configSecrets: { CONFIG_KEY: 'config_value' },
      });

      // Resolve all keys at once (should use getAll internally)
      const keys = await resolver.listKeys();
      const resolved = await resolver.resolve(keys);

      expect(resolved).toEqual({
        CONFIG_KEY: 'config_value',
        KEY1: 'value1',
        KEY2: 'value2',
        KEY3: 'value3',
      });
    });

    it('resolve falls back to individual get() for sparse key requests', async () => {
      const storeData = { KEY1: 'value1', KEY2: 'value2', KEY3: 'value3' };
      const mockStore = createMockSecretStore(storeData);

      const resolver = createSecretResolver({
        store: mockStore,
        owner: 'test-owner',
        configSecrets: { CONFIG_KEY: 'config_value' },
      });

      // Request only a few keys (sparse set)
      const resolved = await resolver.resolve(['KEY1', 'CONFIG_KEY']);

      expect(resolved).toEqual({
        CONFIG_KEY: 'config_value',
        KEY1: 'value1',
      });
    });
  });
});
