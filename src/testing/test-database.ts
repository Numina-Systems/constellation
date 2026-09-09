// pattern: Imperative Shell

import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createPostgresProvider} from '@/persistence/postgres.ts';
import type {PersistenceProvider} from '@/persistence/types.ts';
import type {DatabaseConfig} from '@/config/config.ts';

const TEST_DATABASE_PREFIX = 'constellation_test_';
const MAX_POSTGRES_IDENTIFIER_BYTES = 63;
const SAFE_LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const REJECTED_CONNECTION_OPTIONS = new Set([
  'host', 'port', 'database', 'dbname', 'user', 'password', 'connection', 'sslmode',
  'ssl', 'options', 'service', 'passfile', 'channel_binding', 'keepalives',
  'connect_timeout', 'statement_timeout', 'lock_timeout', 'idle_in_transaction_session_timeout',
]);

type TestDatabaseConnection = Readonly<{
  host: string;
  port: number;
  database: string;
  user: string | null;
  password: string | null;
}>;

export type TestDatabaseAdminPort = Readonly<{
  readonly createDatabase: (connection: TestDatabaseConnection, databaseName: string) => Promise<void>;
  readonly dropDatabase: (connection: TestDatabaseConnection, databaseName: string) => Promise<void>;
}>;

export type TestDatabaseProviderFactory = (config: Readonly<DatabaseConfig>) => PersistenceProvider;

export type TestDatabaseConfig = {
  readonly adminUrl?: string;
  readonly databaseName?: string;
  readonly adminPort?: TestDatabaseAdminPort;
  readonly providerFactory?: TestDatabaseProviderFactory;
};

export type TestDatabase = {
  readonly databaseName: string;
  readonly url: string;
  readonly persistence: PersistenceProvider;
  readonly teardown: () => Promise<void>;
};

function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = parsed.username ? '<redacted>' : '';
    parsed.password = parsed.password ? '<redacted>' : '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '<redacted database url>';
  }
}

function safeError(error: unknown, sourceUrl: string): Error {
  const raw = error instanceof Error ? error.message : String(error);
  const redacted = raw.replaceAll(sourceUrl, redactUrl(sourceUrl)).replaceAll(/postgres(?:ql)?:\/\/[^\s)]+/gi, '<redacted database url>');
  return new Error(redacted);
}

function parseConnection(adminUrl: URL): TestDatabaseConnection {
  const port = adminUrl.port === '' ? 5432 : Number(adminUrl.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('unsafe test database admin URL: port must be a valid TCP port');
  }
  const user = adminUrl.username === '' ? null : decodeURIComponent(adminUrl.username);
  const password = adminUrl.password === '' ? null : decodeURIComponent(adminUrl.password);
  const database = decodeURIComponent(adminUrl.pathname.replace(/^\//, ''));
  return {host: adminUrl.hostname, port, database, user, password};
}

export function validateTestDatabaseAdminUrl(adminUrl: string | null | undefined): URL {
  if (!adminUrl) {
    throw new Error('integration database required: set TEST_DATABASE_ADMIN_URL');
  }
  let parsed: URL;
  try {
    parsed = new URL(adminUrl);
  } catch {
    throw new Error('unsafe test database admin URL: invalid URL');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('unsafe test database admin URL: expected postgres protocol');
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!SAFE_LOCAL_HOSTS.has(hostname)) {
    throw new Error(`unsafe test database admin URL: host ${hostname} is not local`);
  }
  if (parsed.hash !== '') {
    throw new Error('unsafe test database admin URL: fragments are not allowed');
  }
  for (const key of parsed.searchParams.keys()) {
    if (REJECTED_CONNECTION_OPTIONS.has(key.toLowerCase()) || key !== key.trim()) {
      throw new Error(`unsafe test database admin URL: connection option ${key} is not allowed`);
    }
  }
  if ([...parsed.searchParams.keys()].length > 0) {
    throw new Error('unsafe test database admin URL: query parameters are not allowed');
  }
  const connection = parseConnection(parsed);
  if (!connection.database || connection.database === 'template1' || connection.database === 'template0') {
    throw new Error('unsafe test database admin URL: admin database must be an explicit local endpoint');
  }
  return parsed;
}

function validateDatabaseName(databaseName: string): void {
  if (!/^[a-z_][a-z0-9_]*$/.test(databaseName) || !databaseName.startsWith(TEST_DATABASE_PREFIX)) {
    throw new Error('unsafe test database name: must be a lowercase owned harness identifier');
  }
  if (new TextEncoder().encode(databaseName).byteLength > MAX_POSTGRES_IDENTIFIER_BYTES) {
    throw new Error('unsafe test database name: exceeds PostgreSQL identifier limit');
  }
}

function createDatabaseUrl(connection: TestDatabaseConnection, databaseName: string): string {
  const target = new URL('postgresql://localhost');
  target.hostname = connection.host;
  target.port = String(connection.port);
  target.pathname = `/${databaseName}`;
  if (connection.user !== null) target.username = connection.user;
  if (connection.password !== null) target.password = connection.password;
  return target.toString();
}

function createPoolAdminPort(): TestDatabaseAdminPort {
  return {
    createDatabase: async (connection, databaseName) => {
      const pool = new Pool({
        host: connection.host,
        port: connection.port,
        database: connection.database,
        ...(connection.user === null ? {} : {user: connection.user}),
        ...(connection.password === null ? {} : {password: connection.password}),
      });
      try {
        await pool.query(`CREATE DATABASE "${databaseName}"`);
      } finally {
        await pool.end();
      }
    },
    dropDatabase: async (connection, databaseName) => {
      const pool = new Pool({
        host: connection.host,
        port: connection.port,
        database: connection.database,
        ...(connection.user === null ? {} : {user: connection.user}),
        ...(connection.password === null ? {} : {password: connection.password}),
      });
      try {
        await pool.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      } finally {
        await pool.end();
      }
    },
  };
}

export async function createTestDatabase(config: Readonly<TestDatabaseConfig> = {}): Promise<TestDatabase> {
  const adminUrl = validateTestDatabaseAdminUrl(config.adminUrl ?? process.env['TEST_DATABASE_ADMIN_URL']);
  const connection = parseConnection(adminUrl);
  const databaseName = config.databaseName ?? `${TEST_DATABASE_PREFIX}${randomUUID().replaceAll('-', '')}`;
  validateDatabaseName(databaseName);
  const databaseUrl = createDatabaseUrl(connection, databaseName);
  const adminPort = config.adminPort ?? createPoolAdminPort();
  const providerFactory = config.providerFactory ?? createPostgresProvider;
  let created = false;
  let persistence: PersistenceProvider | null = null;
  let setupStage = 'create';
  try {
    await adminPort.createDatabase(connection, databaseName);
    created = true;
    setupStage = 'connect';
    persistence = providerFactory({url: databaseUrl});
    await persistence.connect();
    setupStage = 'migrate';
    await persistence.runMigrations();
  } catch (error) {
    if (persistence !== null) {
      try { await persistence.disconnect(); } catch { /* cleanup is best effort before reporting setup failure */ }
    }
    if (created) {
      try { await adminPort.dropDatabase(connection, databaseName); } catch { /* preserve setup failure */ }
    }
    throw new Error(`failed to ${setupStage} isolated test database via ${redactUrl(adminUrl.toString())}`, {
      cause: safeError(error, adminUrl.toString()),
    });
  }
  if (persistence === null) throw new Error('failed to initialize isolated test database provider');
  let tornDown = false;
  return {
    databaseName,
    url: databaseUrl,
    persistence,
    teardown: async () => {
      if (tornDown) return;
      let firstError: unknown = null;
      try {
        await persistence!.disconnect();
      } catch (error) {
        firstError = error;
      }
      try {
        await adminPort.dropDatabase(connection, databaseName);
      } catch (error) {
        if (firstError === null) firstError = error;
      }
      if (firstError !== null) throw firstError;
      tornDown = true;
    },
  };
}

export function requireTestDatabase(): string {
  const adminUrl = process.env['TEST_DATABASE_ADMIN_URL'];
  validateTestDatabaseAdminUrl(adminUrl);
  return adminUrl as string;
}

export async function teardownTestDatabase(database: Readonly<Pick<TestDatabase, 'databaseName' | 'teardown'>>): Promise<void> {
  if (!database.databaseName.startsWith(TEST_DATABASE_PREFIX)) {
    throw new Error('refusing to tear down a database not owned by the test harness');
  }
  await database.teardown();
}
