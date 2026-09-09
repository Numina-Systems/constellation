// pattern: Imperative Shell

import type {ToolRegistry, Tool} from '@/tool/types.js';
import type {CodeRuntime} from '@/runtime/types.js';
import type {SecretResolver} from '@/secrets/resolver.js';
import type {CustomToolDefinition, CustomToolStore, TransactionMutationResult} from './types.js';
import {reservedRuntimeBindings, validateExecutableTool, validateToolMetadata, validationMessage} from './validation.js';

export type CustomToolManagerDeps = Readonly<{
  readonly store: CustomToolStore;
  readonly registry: ToolRegistry;
  readonly runtime: CodeRuntime;
  readonly secretResolver: SecretResolver;
  readonly owner: string;
}>;

export type CustomToolManager = Readonly<{
  create(input: Readonly<{name: unknown; description: unknown; parameters: unknown; inputSchema?: unknown; code: unknown}>): Promise<CustomToolDefinition>;
  update(name: string, patch: Partial<Pick<CustomToolDefinition, 'description' | 'parameters' | 'inputSchema' | 'code'>>): Promise<CustomToolDefinition>;
  delete(name: string): Promise<void>;
  list(): Promise<ReadonlyArray<CustomToolDefinition>>;
  loadAll(): Promise<void>;
}>;

type MutationValue = CustomToolDefinition | boolean | null;

export function createCustomToolManager(deps: CustomToolManagerDeps): CustomToolManager {
  const {store, registry, runtime, secretResolver, owner} = deps;
  const definitionCache = new Map<string, CustomToolDefinition>();
  let tail: Promise<unknown> = Promise.resolve();

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation, operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  }

  function buildHandler(definition: CustomToolDefinition): Tool['handler'] {
    return async (params, options) => {
      const cached = definitionCache.get(definition.name);
      if (!cached) return {success: false, output: '', error: `custom tool is unavailable: ${definition.name}`};
      const paramsBlock = `const PARAMS = ${JSON.stringify(params)} as const;`;
      const wrappedCode = `${paramsBlock}\n${cached.code}`;
      const keys = await secretResolver.listKeys();
      const secrets = await secretResolver.resolve(keys);
      const result = await runtime.execute(wrappedCode, registry.generateStubs(), {secrets, ...options});
      return result.success
        ? {success: true, output: result.output}
        : {success: false, output: '', error: result.error ?? 'execution failed'};
    };
  }

  function executable(definition: CustomToolDefinition): Tool {
    const tool: Tool = {
      definition: {
        name: definition.name,
        description: definition.description,
        parameters: [...definition.parameters],
        ...(definition.inputSchema === undefined ? {} : {inputSchema: definition.inputSchema}),
      },
      handler: buildHandler(definition),
    };
    const result = validateExecutableTool(tool, {reservedBindings: reservedRuntimeBindings()});
    if (!result.valid) throw new Error(`invalid persisted custom tool: ${validationMessage(result)}`);
    return result.value;
  }

  function publish(name: string, definition: CustomToolDefinition, previous: CustomToolDefinition | null): void {
    const tool = executable(definition);
    if (registry.replaceReserved) registry.replaceReserved(name, tool);
    else {
      if (previous) registry.unregister(name);
      registry.register(tool);
    }
    definitionCache.set(name, definition);
  }

  function safeErrorText(error: unknown): string {
    const text = error instanceof Error ? error.message : String(error);
    return text.replace(/[\r\n]+/g, ' ').slice(0, 500);
  }

  function mutationResultValue(name: string, result: TransactionMutationResult): MutationValue {
    if (result.status === 'confirmed_commit' || result.status === 'reconciled_commit') return result.value;
    if (result.status === 'confirmed_rollback' || result.status === 'reconciled_rollback') throw new Error(`custom tool mutation rolled back: ${safeErrorText(result.error)}`);
    if (result.status === 'committed_publication_failed') {
      const reason = `custom tool mutation committed but publication failed for ${name}: ${safeErrorText(result.error)}`;
      registry.quarantine?.(name, reason);
      throw new Error(reason);
    }
    if (result.status === 'provisional') {
      const reason = `custom tool mutation outcome is provisional for ${name}; publication refused`;
      registry.quarantine?.(name, reason);
      throw new Error(reason);
    }
    const reason = `custom tool mutation outcome unknown for ${name}: ${safeErrorText(result.error)}`;
    registry.quarantine?.(name, reason);
    throw new Error(reason);
  }

  async function runMutation<T extends MutationValue>(name: string, operationId: string, operationType: 'create' | 'update' | 'delete', action: (query?: import('@/persistence/types.ts').QueryFunction) => Promise<T>, publishValue: (value: T) => void): Promise<T> {
    if (!store.mutate) {
      const value = await action();
      try {
        publishValue(value);
      } catch (error) {
        const reason = `custom tool publication failed for ${name}: ${safeErrorText(error)}`;
        registry.quarantine?.(name, reason);
        throw error;
      }
      return value;
    }
    const result = await store.mutate(operationId, operationType, async (query) => action(query));
    const value = mutationResultValue(name, result) as T;
    try {
      publishValue(value);
    } catch (error) {
      const reason = `custom tool publication failed after commit for ${name}: ${safeErrorText(error)}`;
      registry.quarantine?.(name, reason);
      throw error;
    }
    return value;
  }

  return {
    create(input) {
      return enqueue(async () => {
        if (typeof input.code !== 'string') throw new Error('invalid custom tool metadata: code: must be a string');
        const secretNames = await secretResolver.listKeys();
        const raw = {name: input.name, description: input.description, parameters: input.parameters, ...(input.inputSchema === undefined ? {} : {inputSchema: input.inputSchema}), code: input.code};
        const metadata = validateToolMetadata(raw, {reservedBindings: reservedRuntimeBindings(secretNames), existingNames: new Set(registry.getDefinitions().map((definition) => definition.name))});
        if (!metadata.valid) throw new Error(`invalid custom tool metadata: ${validationMessage(metadata)}`);
        const id = crypto.randomUUID();
        const candidate: CustomToolDefinition = {name: metadata.value.name, description: metadata.value.description, parameters: metadata.value.parameters, ...(metadata.value.inputSchema === undefined ? {} : {inputSchema: metadata.value.inputSchema}), code: input.code, id, owner, created_at: new Date(0), updated_at: new Date(0)};
        const name = candidate.name;
        registry.reserve?.(name);
        try {
          const created = await runMutation(name, crypto.randomUUID(), 'create', (query) => store.create(candidate, query), (value) => publish(name, value as CustomToolDefinition, null));
          return created as CustomToolDefinition;
        } catch (error) {
          registry.release?.(name);
          throw error;
        }
      });
    },

    update(name, patch) {
      return enqueue(async () => {
        const previous = await store.getByName(owner, name);
        if (!previous) throw new Error(`custom tool not found: ${name}`);
        const candidate = {...previous, ...patch};
        if (typeof candidate.code !== 'string') throw new Error('invalid custom tool metadata: code: must be a string');
        const secretNames = await secretResolver.listKeys();
        const metadata = validateToolMetadata(candidate, {reservedBindings: reservedRuntimeBindings(secretNames)});
        if (!metadata.valid) throw new Error(`invalid custom tool metadata: ${validationMessage(metadata)}`);
        registry.reserve?.(name);
        try {
          const updated = await runMutation(name, crypto.randomUUID(), 'update', (query) => store.update(owner, name, {
            ...patch,
            parameters: candidate.parameters,
            ...(candidate.inputSchema === undefined ? {} : {inputSchema: candidate.inputSchema}),
          }, query), (value) => {
            if (!value) throw new Error(`custom tool update returned no definition: ${name}`);
            publish(name, value, previous);
          });
          return updated as CustomToolDefinition;
        } catch (error) {
          registry.release?.(name);
          throw error;
        }
      });
    },

    delete(name) {
      return enqueue(async () => {
        const previous = await store.getByName(owner, name);
        if (!previous) throw new Error(`custom tool not found: ${name}`);
        registry.reserve?.(name);
        try {
          await runMutation(name, crypto.randomUUID(), 'delete', (query) => store.delete(owner, name, query), (deleted) => {
            if (!deleted) throw new Error(`custom tool delete returned no definition: ${name}`);
            definitionCache.delete(name);
            registry.unregister(name);
          });
        } catch (error) {
          registry.release?.(name);
          throw error;
        }
      });
    },

    list() { return store.list(owner); },

    loadAll() {
      return enqueue(async () => {
        const loaded = store.listWithIssues ? await store.listWithIssues(owner) : {definitions: await store.list(owner), issues: []};
        const definitions = loaded.definitions;
        const secretNames = await secretResolver.listKeys();
        let invalidCount = 0;
        for (const issue of loaded.issues) {
          invalidCount += 1;
          registry.quarantine?.(issue.name, `invalid persisted definition: ${issue.reason}`);
        }
        for (const definition of definitions) {
          try {
            const result = validateToolMetadata(definition, {reservedBindings: reservedRuntimeBindings(secretNames)});
            if (!result.valid) throw new Error(validationMessage(result));
            if (registry.getDefinitions().some((registered) => registered.name === definition.name)) continue;
            registry.reserve?.(definition.name, {trustedRecovery: true});
            publish(definition.name, definition, null);
          } catch (error) {
            invalidCount += 1;
            registry.quarantine?.(definition.name, `invalid persisted definition: ${safeErrorText(error)}`);
          }
        }
        if (invalidCount > 0) console.warn(`[custom-tool] quarantined ${invalidCount} invalid persisted definition(s)`);
      });
    },
  };
}
