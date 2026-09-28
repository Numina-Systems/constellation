import {afterEach, describe, expect, it} from 'bun:test';
import {createDeferred} from './deferred.ts';
import {
  createTestDatabase,
  teardownTestDatabase,
  validateTestDatabaseAdminUrl,
} from './test-database.ts';
import {createCompositionSeam} from '@/composition-seam.ts';
import {createInMemoryPersistence, type TestPersistence} from './ports.ts';
import {createFakeProcess} from './process.ts';
import {createMockHttpTransport, createMockSseTransport} from './transports.ts';
import {createMockMcpTransport} from './mcp-transport.ts';
import type {JSONRPCMessage} from '@modelcontextprotocol/sdk/types.js';
import {isToolOutcome, parseToolOutcome} from '@/contracts/outcomes.ts';

function transactionOutcomeProvider(): TestPersistence {
  return createInMemoryPersistence();
}

describe('Phase 0 / AC.1 safe test database infrastructure', () => {
  it('test_db_rejects_unsafe_target', () => {
    expect(() => validateTestDatabaseAdminUrl(null)).toThrow('TEST_DATABASE_ADMIN_URL');
    expect(validateTestDatabaseAdminUrl('postgresql://user:pass@[::1]:5432/admin').hostname).toBe('[::1]');
    expect(() => validateTestDatabaseAdminUrl('postgresql://user:pass@example.com/test')).toThrow('not local');
    expect(() => validateTestDatabaseAdminUrl('postgresql://user:pass@localhost/template1')).toThrow('local endpoint');
    expect(() => validateTestDatabaseAdminUrl('postgresql://user:pass@localhost/test?host=evil.example')).toThrow('connection option host');
    expect(() => validateTestDatabaseAdminUrl('postgresql://user:pass@localhost/test?port=5433')).toThrow('connection option port');
    expect(() => validateTestDatabaseAdminUrl('postgresql://user:pass@localhost/test?password=leaked')).toThrow('connection option password');
  });

  it('test_db_teardown_retries_after_failed_drop_and_redacts_setup_cause', async () => {
    let drops = 0;
    const adminError = new Error('password=secret postgres://user:secret@localhost/admin');
    const provider = createInMemoryPersistence();
    const database = await createTestDatabase({
      adminUrl: 'postgresql://user:secret@localhost/admin',
      databaseName: 'constellation_test_retry',
      adminPort: {
        createDatabase: async () => undefined,
        dropDatabase: async () => { drops += 1; if (drops === 1) throw adminError; },
      },
      providerFactory: () => provider,
    });
    await expect(database.teardown()).rejects.toThrow();
    await expect(database.teardown()).resolves.toBeUndefined();
    expect(drops).toBe(2);
    await expect(createTestDatabase({adminUrl: 'postgresql://user:secret@localhost/admin', adminPort: {
      createDatabase: async () => { throw adminError; }, dropDatabase: async () => undefined,
    }})).rejects.not.toThrow('secret');
  });

  it('test_db_teardown_drops_exactly_the_created_database', async () => {
    const dropped: Array<string> = [];
    const database = await createTestDatabase({
      adminUrl: 'postgresql://user:secret@localhost/admin',
      databaseName: 'constellation_test_exact_drop',
      adminPort: {
        createDatabase: async () => undefined,
        dropDatabase: async (_connection, databaseName) => { dropped.push(databaseName); },
      },
      providerFactory: () => createInMemoryPersistence(),
    });
    await teardownTestDatabase(database);
    expect(dropped).toEqual([database.databaseName]);
  });

  it('test_db_teardown_only_owned_database', async () => {
    const database = {
      databaseName: 'constellation_test_owned',
      teardown: async () => undefined,
    };
    await expect(teardownTestDatabase(database)).resolves.toBeUndefined();
    await expect(teardownTestDatabase({databaseName: 'constellation', teardown: async () => undefined})).rejects.toThrow('not owned');
  });

  it('integration_mode_requires_database', async () => {
    const prior = process.env['TEST_DATABASE_ADMIN_URL'];
    delete process.env['TEST_DATABASE_ADMIN_URL'];
    try {
      await expect(createTestDatabase()).rejects.toThrow('integration database required');
    } finally {
      if (prior === undefined) delete process.env['TEST_DATABASE_ADMIN_URL'];
      else process.env['TEST_DATABASE_ADMIN_URL'] = prior;
    }
  });

  it('composition_seam_import_is_side_effect_free', () => {
    const seam = createCompositionSeam();
    expect(seam).toBeDefined();
    expect(seam.createAgent).toBeFunction();
  });
});

describe('Phase 0 / bounded shared boundary helpers', () => {
  it('rejects oversized or malformed tool outcomes', () => {
    expect(() => parseToolOutcome({kind: 'success', output: 'x'.repeat(64 * 1024 + 1)})).toThrow('exceeds byte bound');
    expect(isToolOutcome({kind: 'error', code: 'safe_code', message: 'error text'})).toBe(true);
    expect(isToolOutcome({kind: 'error', code: 'bad code', message: 'x'})).toBe(false);
  });

  it('fake process closes idempotently and rejects late output', async () => {
    const process = createFakeProcess();
    await process.close(7);
    await expect(process.exitCode).resolves.toBe(7);
    await expect(process.close(8)).resolves.toBeUndefined();
    await expect(process.writeStdout(new Uint8Array([1]))).rejects.toThrow('closed');
  });

  it('abort closes fake process and SSE transport', async () => {
    const controller = new AbortController();
    const process = createFakeProcess(controller.signal);
    const sse = createMockSseTransport(controller.signal);
    controller.abort();
    await expect(process.exitCode).resolves.toBe(1);
    await expect(process.writeStdout(new Uint8Array([1]))).rejects.toThrow('closed');
    expect(() => sse.send('event', 'data')).toThrow('closed');
  });

  it('mock transports are deterministic and bounded', async () => {
    const http = createMockHttpTransport();
    const response = http.fetch('http://loopback.test/one');
    http.respond(new Response('ok'));
    await expect(response).resolves.toBeInstanceOf(Response);
    http.close();
    await expect(http.fetch('http://loopback.test/two')).rejects.toThrow('closed');
    const sse = createMockSseTransport();
    sse.close();
    expect(() => sse.close()).not.toThrow();
    expect(() => sse.send('event', 'data')).toThrow('closed');
  });

  it('mock MCP transport delivers messages in order and aborts', async () => {
    const controller = new AbortController();
    const transport = createMockMcpTransport(controller.signal);
    const received: Array<JSONRPCMessage> = [];
    transport.onmessage = (message) => { received.push(message); };
    const first = {jsonrpc: '2.0', id: 1, method: 'first', params: {}} as JSONRPCMessage;
    const second = {jsonrpc: '2.0', id: 2, method: 'second', params: {}} as JSONRPCMessage;
    await transport.send(first);
    await transport.send(second);
    transport.deliver(first);
    transport.deliver(second);
    expect(transport.sent).toEqual([first, second]);
    expect(received).toEqual([first, second]);
    controller.abort();
    await expect(transport.send(first)).rejects.toThrow('closed');
  });

  it('mock MCP transport enforces the 128-send bound', async () => {
    const transport = createMockMcpTransport();
    const message = {jsonrpc: '2.0', id: 1, method: 'bounded', params: {}} as JSONRPCMessage;
    for (let index = 0; index < 128; index += 1) await transport.send(message);
    await expect(transport.send(message)).rejects.toThrow('bound exceeded');
  });

  it('already-aborted MCP signal fires the close path', async () => {
    const controller = new AbortController();
    controller.abort();
    const transport = createMockMcpTransport(controller.signal);
    let closed = false;
    transport.onclose = () => { closed = true; };
    expect(closed).toBe(true);
    await expect(transport.start()).rejects.toThrow('closed');
    await transport.close();
    expect(closed).toBe(true);
  });
});

describe('Phase 0 / AC.21 persistence transaction boundary', () => {
  afterEach(async () => undefined);

  it('transaction_context_isolation_keeps_writes_and_reads_provider_local', async () => {
    const first = createInMemoryPersistence();
    const second = createInMemoryPersistence();
    await first.withTransaction(async (query) => {
      await query('INSERT INTO first (value) VALUES ($1)', ['one']);
      const secondRows = await second.query('SELECT * FROM second');
      expect(secondRows).toHaveLength(0);
    });
    expect(first.rows.has('first')).toBe(true);
    expect(second.rows.has('second')).toBe(false);
  });

  it('callback-swallowed SQL error followed by rollback-tagged COMMIT is confirmed rollback', async () => {
    const persistence = transactionOutcomeProvider();
    const commitError = new Error('callback observed SQL error');
    persistence.failures.push({operation: 'commit', error: commitError, commandTag: 'ROLLBACK'});
    const result = await persistence.withTransactionOutcome(async (scope) => {
      try { await scope.query('SELECT * FROM broken'); } catch { /* callback intentionally swallows SQL failure */ }
      return 'value';
    });
    expect(result.status).toBe('confirmed_rollback');
    expect(persistence.rows.has('broken')).toBe(false);
  });

  it('missing reconciled value preserves root commit error as commit_unknown', async () => {
    const persistence = transactionOutcomeProvider();
    const commitError = new Error('lost commit acknowledgement');
    persistence.failures.push({operation: 'commit', error: commitError});
    const result = await persistence.withTransactionOutcome(async () => 'value', async () => ({truth: 'committed'}));
    expect(result.status).toBe('commit_unknown');
    if (result.status === 'commit_unknown') expect(String(result.error)).toContain('without a durable value');
  });

  it('reconciler failure after confirmed commit is commit_unknown, not publication failure', async () => {
    const persistence = transactionOutcomeProvider();
    const reconcileError = new Error('receipt query failed');
    const result = await persistence.withTransactionOutcome(async () => 'value', async () => { throw reconcileError; });
    expect(result.status).toBe('commit_unknown');
    if (result.status === 'commit_unknown') expect(result.error).toBe(reconcileError);
  });

  it('reconciliation unknown preserves root and reconciler errors', async () => {
    const persistence = transactionOutcomeProvider();
    const commitError = new Error('lost commit acknowledgement');
    const reconcileError = new Error('receipt query failed');
    persistence.failures.push({operation: 'commit', error: commitError});
    const result = await persistence.withTransactionOutcome(async () => 'value', async () => { throw reconcileError; });
    expect(result.status).toBe('commit_unknown');
    if (result.status === 'commit_unknown') {
      expect(result.error).toBeInstanceOf(AggregateError);
      expect(String(result.error)).toContain(commitError.message);
      expect(String(result.error)).toContain(reconcileError.message);
    }
  });

  it('committed publication failure is distinct from reconciliation failure', async () => {
    const persistence = transactionOutcomeProvider();
    const result = await persistence.withTransactionOutcome(async (scope) => {
      scope.registerAfterCommit(() => { throw new Error('publication failed'); });
      scope.registerAfterCommit(() => undefined);
      return 'value';
    });
    expect(result.status).toBe('committed_publication_failed');
    if (result.status === 'committed_publication_failed') expect(result.details).toEqual({attempted: 1, skipped: 1});
  });

  it('nested_reconciliation_callback_observes_completed_outer_scope', async () => {
    const persistence = transactionOutcomeProvider();
    const deferred = createDeferred<void>();
    const stages: Array<string> = [];
    const result = await persistence.withTransactionOutcome(
      async () => {
        stages.push('nested');
        const nested = await persistence.withTransactionOutcome(async () => 'nested-value');
        expect(nested.status).toBe('provisional');
        return 'outer-value';
      },
      async () => {
        stages.push('reconcile');
        deferred.resolve(undefined);
        return {truth: 'committed'};
      },
    );
    await deferred.promise;
    expect(result.status).toBe('confirmed_commit');
    expect(stages).toEqual(['nested', 'reconcile']);
  });
});
