// pattern: Imperative Shell

import type { ToolRegistry, Tool, ToolParameter } from '@/tool/types.js';
import type { CodeRuntime } from '@/runtime/types.js';
import type { SecretResolver } from '@/secrets/resolver.js';
import type { CustomToolDefinition, CustomToolStore } from './types.js';

export type CustomToolManagerDeps = {
  readonly store: CustomToolStore;
  readonly registry: ToolRegistry;
  readonly runtime: CodeRuntime;
  readonly secretResolver: SecretResolver;
  readonly owner: string;
};

export type CustomToolManager = {
  create(def: {
    name: string;
    description: string;
    parameters: ReadonlyArray<ToolParameter>;
    code: string;
  }): Promise<CustomToolDefinition>;
  update(
    name: string,
    patch: Partial<Pick<CustomToolDefinition, 'description' | 'parameters' | 'code'>>,
  ): Promise<CustomToolDefinition>;
  delete(name: string): Promise<void>;
  list(): Promise<ReadonlyArray<CustomToolDefinition>>;
  loadAll(): Promise<void>;
};

export function createCustomToolManager(deps: CustomToolManagerDeps): CustomToolManager {
  const { store, registry, runtime, secretResolver, owner } = deps;
  const definitionCache = new Map<string, CustomToolDefinition>();

  function buildHandler(def: CustomToolDefinition): Tool['handler'] {
    return async (params) => {
      const cached = definitionCache.get(def.name);
      const code = cached?.code ?? def.code;

      const paramsBlock = `const PARAMS = ${JSON.stringify(params)} as const;`;
      const wrappedCode = `${paramsBlock}\n${code}`;

      const allKeys = await secretResolver.listKeys();
      const secrets = await secretResolver.resolve(allKeys);
      const stubs = registry.generateStubs();

      const result = await runtime.execute(wrappedCode, stubs, { secrets });

      if (!result.success) {
        return { success: false, output: '', error: result.error ?? 'execution failed' };
      }
      return { success: true, output: result.output };
    };
  }

  function registerInRegistry(def: CustomToolDefinition): void {
    const tool: Tool = {
      definition: {
        name: def.name,
        description: def.description,
        parameters: [...def.parameters],
      },
      handler: buildHandler(def),
    };
    registry.register(tool);
  }

  return {
    async create(input) {
      const existingDefs = registry.getDefinitions();
      const existingNames = new Set(existingDefs.map(d => d.name));
      if (existingNames.has(input.name)) {
        throw new Error(`tool name conflicts with existing tool: ${input.name}`);
      }

      const id = crypto.randomUUID();
      const def = await store.create({
        id,
        owner,
        name: input.name,
        description: input.description,
        parameters: input.parameters,
        code: input.code,
      });

      definitionCache.set(def.name, def);
      registerInRegistry(def);
      return def;
    },

    async update(name, patch) {
      const updated = await store.update(owner, name, patch);
      if (!updated) {
        throw new Error(`custom tool not found: ${name}`);
      }

      definitionCache.set(name, updated);
      registry.unregister(name);
      registerInRegistry(updated);
      return updated;
    },

    async delete(name) {
      const deleted = await store.delete(owner, name);
      if (!deleted) {
        throw new Error(`custom tool not found: ${name}`);
      }
      definitionCache.delete(name);
      registry.unregister(name);
    },

    async list() {
      return store.list(owner);
    },

    async loadAll() {
      const definitions = await store.list(owner);
      for (const def of definitions) {
        definitionCache.set(def.name, def);
        try {
          registerInRegistry(def);
        } catch {
          // Tool name may conflict with a built-in added since the custom tool was created.
          // Skip silently — the tool remains in the DB but isn't registered.
          console.warn(`[custom-tool] skipped conflicting tool: ${def.name}`);
        }
      }
    },
  };
}
