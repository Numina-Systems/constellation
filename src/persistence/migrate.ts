import { loadConfig } from "../config/config.ts";
import { createPostgresProvider } from "./postgres.ts";

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createPostgresProvider(config.database);

  try {
    await db.connect();
    console.log("Connected to database");

    await db.runMigrations();
    console.log("Migrations complete");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await db.disconnect();
  }
}

main();
