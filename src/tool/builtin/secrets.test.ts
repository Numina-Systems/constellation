// pattern: Functional Core

/**
 * Tests for secret agent tools (secret_set, secret_list, secret_delete).
 * Verifies that secret tools correctly delegate to SecretStore without exposing values.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import type { SecretStore } from '../../secrets/types.js';
import { createSecretTools } from './secrets.js';
import { createMockSecretStore } from '../../secrets/test-utils.js';

describe('Secret Tools', () => {
  let mockStore: SecretStore;
  let storeData: Record<string, string>;

  beforeEach(() => {
    storeData = {};
    mockStore = createMockSecretStore(storeData);
  });

  describe('secret_set', () => {
    test('stores a secret and returns success', async () => {
      const tools = createSecretTools({ store: mockStore, owner: 'test-owner' });
      const setTool = tools.find((t) => t.definition.name === 'secret_set');
      expect(setTool).toBeDefined();

      const result = await setTool!.handler({ key: 'API_KEY', value: 'secret123' });

      expect(result.success).toBe(true);
      expect(result.output).toBe('Secret "API_KEY" stored successfully.');
      expect(storeData['API_KEY']).toBe('secret123');
    });

    test('rejects keys with invalid identifiers (defense-in-depth)', async () => {
      const tools = createSecretTools({ store: mockStore, owner: 'test-owner' });
      const setTool = tools.find((t) => t.definition.name === 'secret_set');

      const result = await setTool!.handler({ key: 'x = 1; malicious(); const y', value: 'payload' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('invalid secret name');
      expect(storeData['x = 1; malicious(); const y']).toBeUndefined();
    });

    test('rejects names reserved by runtime bindings', async () => {
      const tools = createSecretTools({ store: mockStore, owner: 'test-owner' });
      const setTool = tools.find((t) => t.definition.name === 'secret_set');

      for (const key of ['Deno', 'output', 'console', '__callTool__']) {
        const result = await setTool!.handler({ key, value: 'value' });
        expect(result.success).toBe(false);
        expect(result.error).toContain('reserved by the execution environment');
        expect(storeData[key]).toBeUndefined();
      }
    });

    test('rejects keys starting with digits', async () => {
      const tools = createSecretTools({ store: mockStore, owner: 'test-owner' });
      const setTool = tools.find((t) => t.definition.name === 'secret_set');

      const result = await setTool!.handler({ key: '123_KEY', value: 'value' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('invalid secret name');
      expect(storeData['123_KEY']).toBeUndefined();
    });

    test('rejects keys with hyphens', async () => {
      const tools = createSecretTools({ store: mockStore, owner: 'test-owner' });
      const setTool = tools.find((t) => t.definition.name === 'secret_set');

      const result = await setTool!.handler({ key: 'MY-API-KEY', value: 'value' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('invalid secret name');
      expect(storeData['MY-API-KEY']).toBeUndefined();
    });

    test('rejects keys with spaces', async () => {
      const tools = createSecretTools({ store: mockStore, owner: 'test-owner' });
      const setTool = tools.find((t) => t.definition.name === 'secret_set');

      const result = await setTool!.handler({ key: 'MY API KEY', value: 'value' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('invalid secret name');
      expect(storeData['MY API KEY']).toBeUndefined();
    });

    test('accepts keys starting with underscore', async () => {
      const tools = createSecretTools({ store: mockStore, owner: 'test-owner' });
      const setTool = tools.find((t) => t.definition.name === 'secret_set');

      const result = await setTool!.handler({ key: '_PRIVATE_KEY', value: 'secret' });

      expect(result.success).toBe(true);
      expect(storeData['_PRIVATE_KEY']).toBe('secret');
    });

    test('accepts keys starting with dollar sign', async () => {
      const tools = createSecretTools({ store: mockStore, owner: 'test-owner' });
      const setTool = tools.find((t) => t.definition.name === 'secret_set');

      const result = await setTool!.handler({ key: '$SPECIAL_KEY', value: 'secret' });

      expect(result.success).toBe(true);
      expect(storeData['$SPECIAL_KEY']).toBe('secret');
    });

    test('never includes the secret value in output', async () => {
      const tools = createSecretTools({ store: mockStore, owner: 'test-owner' });
      const setTool = tools.find((t) => t.definition.name === 'secret_set');

      const secretValue = 'super-secret-value-12345';
      const result = await setTool!.handler({ key: 'MY_SECRET', value: secretValue });

      expect(result.success).toBe(true);
      expect(result.output).not.toContain(secretValue);
      expect(result.output).not.toContain('super-secret-value-12345');
    });

    test('updates an existing secret', async () => {
      storeData['EXISTING'] = 'old-value';
      const tools = createSecretTools({ store: mockStore, owner: 'test-owner' });
      const setTool = tools.find((t) => t.definition.name === 'secret_set');

      await setTool!.handler({ key: 'EXISTING', value: 'new-value' });

      expect(storeData['EXISTING']).toBe('new-value');
    });
  });

  describe('secret_list', () => {
    test('returns empty message when no secrets exist', async () => {
      const tools = createSecretTools({ store: mockStore, owner: 'test-owner' });
      const listTool = tools.find((t) => t.definition.name === 'secret_list');

      const result = await listTool!.handler({});

      expect(result.success).toBe(true);
      expect(result.output).toBe('No secrets stored.');
    });

    test('returns key names only, never values', async () => {
      storeData['KEY1'] = 'value1';
      storeData['KEY2'] = 'value2';
      storeData['KEY3'] = 'value3';

      const tools = createSecretTools({ store: mockStore, owner: 'test-owner' });
      const listTool = tools.find((t) => t.definition.name === 'secret_list');

      const result = await listTool!.handler({});

      expect(result.success).toBe(true);
      expect(result.output).toContain('KEY1');
      expect(result.output).toContain('KEY2');
      expect(result.output).toContain('KEY3');
      expect(result.output).not.toContain('value1');
      expect(result.output).not.toContain('value2');
      expect(result.output).not.toContain('value3');
    });

    test('lists secrets in sorted order', async () => {
      storeData['ZEBRA'] = 'z';
      storeData['APPLE'] = 'a';
      storeData['BANANA'] = 'b';

      const tools = createSecretTools({ store: mockStore, owner: 'test-owner' });
      const listTool = tools.find((t) => t.definition.name === 'secret_list');

      const result = await listTool!.handler({});

      // Extract keys from output (lines starting with -)
      const lines = result.output.split('\n').map((l) => l.trim());
      const keys = lines
        .filter((l) => l.startsWith('-'))
        .map((l) => l.substring(1).trim());

      expect(keys).toEqual(['APPLE', 'BANANA', 'ZEBRA']);
    });
  });

  describe('secret_delete', () => {
    test('deletes an existing secret and returns success', async () => {
      storeData['TO_DELETE'] = 'some-value';
      const tools = createSecretTools({ store: mockStore, owner: 'test-owner' });
      const deleteTool = tools.find((t) => t.definition.name === 'secret_delete');

      const result = await deleteTool!.handler({ key: 'TO_DELETE' });

      expect(result.success).toBe(true);
      expect(result.output).toBe('Secret "TO_DELETE" deleted.');
      expect(storeData['TO_DELETE']).toBeUndefined();
    });

    test('returns error when secret not found', async () => {
      const tools = createSecretTools({ store: mockStore, owner: 'test-owner' });
      const deleteTool = tools.find((t) => t.definition.name === 'secret_delete');

      const result = await deleteTool!.handler({ key: 'NONEXISTENT' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Secret "NONEXISTENT" not found.');
      expect(result.output).toBe('');
    });
  });

  describe('createSecretTools factory', () => {
    test('returns all three tools', () => {
      const tools = createSecretTools({ store: mockStore, owner: 'test-owner' });

      expect(tools.length).toBe(3);
      const names = tools.map((t) => t.definition.name);
      expect(names).toContain('secret_set');
      expect(names).toContain('secret_list');
      expect(names).toContain('secret_delete');
    });

    test('tools are owned by the specified owner', async () => {
      let capturedOwner = '';

      const customStore: SecretStore = {
        async get(owner) {
          capturedOwner = owner;
          return null;
        },
        async set(owner) {
          capturedOwner = owner;
        },
        async delete(owner) {
          capturedOwner = owner;
          return false;
        },
        async listKeys(owner) {
          capturedOwner = owner;
          return [];
        },
        async getAll(owner) {
          capturedOwner = owner;
          return {};
        },
      };

      const tools = createSecretTools({ store: customStore, owner: 'specific-owner' });
      const listTool = tools.find((t) => t.definition.name === 'secret_list');

      await listTool!.handler({});

      expect(capturedOwner).toBe('specific-owner');
    });
  });
});
