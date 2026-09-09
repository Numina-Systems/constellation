import {describe, expect, test} from 'bun:test';
import {createToolRegistry} from '@/tool/registry.js';
import type {CodeRuntime} from '@/runtime/types.js';
import type {CustomToolDefinition, CustomToolStore, TransactionMutationResult} from './types.js';
import {createCustomToolManager} from './manager.js';

type MutableStore = CustomToolStore & {
  readonly definitions: Map<string, CustomToolDefinition>;
  outcome: TransactionMutationResult | null;
};

function createRuntime(): CodeRuntime {
  return {
    async execute(): Promise<ReturnType<CodeRuntime['execute']> extends Promise<infer Result> ? Result : never> {
      return {success: true, output: 'ok', error: null, tool_calls_made: 0, duration_ms: 0};
    },
  };
}

function definition(input: Readonly<{
  readonly name: string;
  readonly description: string;
  readonly code: string;
}>): CustomToolDefinition {
  return {
    id: crypto.randomUUID(),
    owner: 'owner',
    name: input.name,
    description: input.description,
    parameters: [],
    code: input.code,
    created_at: new Date(0),
    updated_at: new Date(0),
  };
}

function createStore(): MutableStore {
  const definitions = new Map<string, CustomToolDefinition>();
  let outcome: TransactionMutationResult | null = null;
  return {
    definitions,
    get outcome() { return outcome; },
    set outcome(value: TransactionMutationResult | null) { outcome = value; },
    async create(candidate) {
      const persisted = {...candidate, created_at: new Date(0), updated_at: new Date(0)};
      definitions.set(persisted.name, persisted);
      return persisted;
    },
    async update(_owner, name, patch) {
      const prior = definitions.get(name);
      if (!prior) return null;
      const updated = {...prior, ...patch, updated_at: new Date(0)};
      definitions.set(name, updated);
      return updated;
    },
    async delete(_owner, name) { return definitions.delete(name); },
    async list(owner) { return [...definitions.values()].filter((candidate) => candidate.owner === owner); },
    async getByName(owner, name) {
      return definitions.get(name)?.owner === owner ? definitions.get(name) ?? null : null;
    },
    async mutate(_operationId, _operationType, action = async () => null) {
      if (outcome !== null) {
        const selected = outcome;
        outcome = null;
        return selected;
      }
      const value = await action(async <T extends Record<string, unknown>>(_sql: string, _params?: ReadonlyArray<unknown>): Promise<Array<T>> => []);
      return {status: 'confirmed_commit', value};
    },
  };
}

function createManager(store: MutableStore, registry: ReturnType<typeof createToolRegistry>) {
  return createCustomToolManager({
    store,
    registry,
    runtime: createRuntime(),
    secretResolver: {listKeys: async () => [], resolve: async () => ({})},
    owner: 'owner',
  });
}

describe('registry_reservation_commit_failure', () => {
  test('beforeCommit fault rolls back, releases reservation, and preserves prior dispatchable definition', async () => {
    const registry = createToolRegistry();
    const store = createStore();
    const manager = createManager(store, registry);
    const prior = definition({name: 'stable_tool', description: 'prior', code: 'output("prior")'});
    store.definitions.set(prior.name, prior);
    await manager.loadAll();
    const beforeCommit = new Error('before commit fault');
    store.outcome = {status: 'confirmed_rollback', error: beforeCommit};

    await expect(manager.update('stable_tool', {description: 'new'})).rejects.toThrow('before commit fault');
    expect(registry.getDefinitions().find((tool) => tool.name === 'stable_tool')?.description).toBe('prior');
    await expect(registry.dispatch('stable_tool', {})).resolves.toMatchObject({success: true, output: 'ok'});
    expect(registry.getQuarantines?.()).toEqual([]);
  });

  test('afterCommit lost acknowledgement quarantines the affected name and blocks dispatch', async () => {
    const registry = createToolRegistry();
    const store = createStore();
    const manager = createManager(store, registry);
    store.outcome = {status: 'commit_unknown', error: new Error('lost acknowledgement')};

    await expect(manager.create({name: 'unknown_tool', description: 'unknown', parameters: [], code: 'output("new")'})).rejects.toThrow('outcome unknown');
    expect(registry.getQuarantines?.()).toEqual([{name: 'unknown_tool', reason: expect.stringContaining('lost acknowledgement')}]);
    await expect(registry.dispatch('unknown_tool', {})).resolves.toMatchObject({success: false, error: expect.stringContaining('unknown tool')});
  });

  test('reconciled committed truth publishes the committed definition', async () => {
    const registry = createToolRegistry();
    const store = createStore();
    const manager = createManager(store, registry);
    const committed = definition({name: 'reconciled_tool', description: 'committed', code: 'output("committed")'});
    store.outcome = {status: 'reconciled_commit', value: committed, error: new Error('lost acknowledgement')};

    await expect(manager.create({name: committed.name, description: committed.description, parameters: [], code: committed.code})).resolves.toMatchObject({name: committed.name});
    expect(registry.getDefinitions().find((tool) => tool.name === committed.name)?.description).toBe('committed');
  });

  test('reconciliation unavailable remains quarantined fail-closed', async () => {
    const registry = createToolRegistry();
    const store = createStore();
    const manager = createManager(store, registry);
    store.outcome = {status: 'commit_unknown', error: new Error('reconciliation unavailable')};

    await expect(manager.create({name: 'unresolved_tool', description: 'unresolved', parameters: [], code: 'output("new")'})).rejects.toThrow('outcome unknown');
    expect(registry.getQuarantines?.()).toEqual([{name: 'unresolved_tool', reason: expect.stringContaining('reconciliation unavailable')}]);
    await expect(registry.dispatch('unresolved_tool', {})).resolves.toMatchObject({success: false, error: expect.stringContaining('unknown tool')});
  });

  test('provisional nested outcome is quarantined and never published', async () => {
    const registry = createToolRegistry();
    const store = createStore();
    const manager = createManager(store, registry);
    store.outcome = {status: 'provisional', value: definition({name: 'provisional_tool', description: 'must not publish', code: 'output("new")'})};

    await expect(manager.create({name: 'provisional_tool', description: 'new', parameters: [], code: 'output("new")'})).rejects.toThrow('provisional');
    expect(registry.getDefinitions().some((tool) => tool.name === 'provisional_tool')).toBe(false);
    expect(registry.getQuarantines?.()).toEqual([{name: 'provisional_tool', reason: expect.stringContaining('provisional')}]);
  });

  test('publication failure after confirmed commit quarantines and surfaces the error', async () => {
    const baseRegistry = createToolRegistry();
    const publicationError = new Error('registry publication fault');
    const registry = {
      ...baseRegistry,
      replaceReserved() { throw publicationError; },
    } as ReturnType<typeof createToolRegistry>;
    const store = createStore();
    const manager = createManager(store, registry);

    await expect(manager.create({name: 'publication_fault_tool', description: 'committed', parameters: [], code: 'output("new")'})).rejects.toBe(publicationError);
    expect(registry.getDefinitions().some((tool) => tool.name === 'publication_fault_tool')).toBe(false);
    expect(registry.getQuarantines?.()).toEqual([{name: 'publication_fault_tool', reason: expect.stringContaining('publication fault')}]);
    expect(store.definitions.has('publication_fault_tool')).toBe(true);
  });
});
