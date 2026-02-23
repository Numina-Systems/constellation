import { Pool } from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import type { PersistenceProvider } from "./types.ts";
import type { DatabaseConfig } from "../config/config.ts";

export function createPostgresProvider(
  config: DatabaseConfig,
): PersistenceProvider {
  const pool = new Pool({ connectionString: config.url });

  async function connect(): Promise<void> {
    const client = await pool.connect();
    client.release();
  }

  async function disconnect(): Promise<void> {
    await pool.end();
  }

  async function runMigrations(): Promise<void> {
    const migrationsDir = resolve(
      (import.meta as unknown as { dir: string }).dir,
      "migrations",
    );
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          name TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      const applied = await client.query<{ name: string }>(
        "SELECT name FROM schema_migrations ORDER BY name",
      );
      const appliedSet = new Set(applied.rows.map((r) => r.name));

      for (const file of files) {
        if (appliedSet.has(file)) continue;

        const sql = readFileSync(join(migrationsDir, file), "utf-8");
        await client.query("BEGIN");
        try {
          await client.query(sql);
          await client.query(
            "INSERT INTO schema_migrations (name) VALUES ($1)",
            [file],
          );
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      }
    } finally {
      client.release();
    }
  }

  async function query<T extends Record<string, unknown>>(
    sql: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<Array<T>> {
    const result = await pool.query(sql, params as Array<unknown>);
    return result.rows as Array<T>;
  }

  async function withTransaction<T>(
    fn: (queryFn: typeof query) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect();
    const txQuery = async <R extends Record<string, unknown>>(
      sql: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<Array<R>> => {
      const result = await client.query(sql, params as Array<unknown>);
      return result.rows as Array<R>;
    };
    try {
      await client.query("BEGIN");
      const result = await fn(txQuery);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    connect,
    disconnect,
    runMigrations,
    query,
    withTransaction,
  };
}
