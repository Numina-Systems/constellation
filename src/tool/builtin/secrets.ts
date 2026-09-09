// pattern: Imperative Shell

/**
 * Built-in secret management tools for storing, listing, and deleting agent-managed secrets.
 * These tools delegate to the SecretStore port interface.
 */

import {isJavaScriptIdentifier, reservedRuntimeBindings} from '@/custom-tool/validation.js';
import type { SecretStore } from '../../secrets/types.js';
import type { Tool } from '../types.js';

/**
 * Validate that a string is a valid TypeScript identifier for use as a const name.
 * Pattern: must start with letter, underscore, or dollar sign.
 * Can contain letters, digits, underscores, or dollar signs.
 */
function isValidIdentifier(key: string): boolean {
  return isJavaScriptIdentifier(key);
}

type SecretToolDeps = {
  readonly store: SecretStore;
  readonly owner: string;
};

export function createSecretTools(deps: SecretToolDeps): ReadonlyArray<Tool> {
  const { store, owner } = deps;

  const secretSet: Tool = {
    definition: {
      name: 'secret_set',
      description:
        'Store an API key or credential securely. The value is persisted and available for sandbox code execution. Values are never returned in tool output.',
      parameters: [
        {
          name: 'key',
          type: 'string',
          description:
            'Secret name — must be a valid identifier: letters, digits, underscores, starting with a letter or underscore (e.g., MY_API_KEY)',
          required: true,
        },
        {
          name: 'value',
          type: 'string',
          description: 'Secret value',
          required: true,
        },
      ],
    },
    handler: async (params) => {
      const key = params['key'] as string;
      const value = params['value'] as string;

      // Defense-in-depth: validate key at entry point
      if (!isValidIdentifier(key)) {
        return {
          success: false,
          output: '',
          error: `invalid secret name "${key}": must be a valid non-reserved identifier`,
        };
      }
      if (reservedRuntimeBindings().has(key)) {
        return {
          success: false,
          output: '',
          error: `invalid secret name "${key}": reserved by the execution environment`,
        };
      }

      await store.set(owner, key, value);
      return { success: true, output: `Secret "${key}" stored successfully.` };
    },
  };

  const secretList: Tool = {
    definition: {
      name: 'secret_list',
      description: 'List all stored secret key names. Values are never exposed.',
      parameters: [],
    },
    handler: async () => {
      const keys = await store.listKeys(owner);
      if (keys.length === 0) {
        return { success: true, output: 'No secrets stored.' };
      }
      return {
        success: true,
        output: `Stored secrets:\n${keys.map((k) => `  - ${k}`).join('\n')}`,
      };
    },
  };

  const secretDelete: Tool = {
    definition: {
      name: 'secret_delete',
      description: 'Delete a stored secret by key name.',
      parameters: [
        {
          name: 'key',
          type: 'string',
          description: 'Secret name to delete',
          required: true,
        },
      ],
    },
    handler: async (params) => {
      const key = params['key'] as string;
      const deleted = await store.delete(owner, key);
      if (!deleted) {
        return {
          success: false,
          output: '',
          error: `Secret "${key}" not found.`,
        };
      }
      return { success: true, output: `Secret "${key}" deleted.` };
    },
  };

  return [secretSet, secretList, secretDelete];
}
