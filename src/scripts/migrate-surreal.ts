// pattern: Imperative Shell

/**
 * One-shot migration script: imports selected memory blocks from a SurrealDB
 * JSON dump into Constellation's PostgreSQL memory_blocks table.
 *
 * Imports:
 *   - 2 core memories (resonances, social_coordination_lesson_paul_frazee_thread)
 *   - 23 bluesky user profile caches (latest version per handle)
 *
 * Usage: bun run src/scripts/migrate-surreal.ts
 *
 * Requires DATABASE_URL or config.toml database settings.
 * Uses ON CONFLICT (owner, label) DO UPDATE to be safely re-runnable.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../config/config.ts';
import { createPostgresProvider } from '../persistence/postgres.ts';
import type { QueryFunction } from '../persistence/types.ts';

const AGENT_OWNER = 'spirit';
const DUMP_DIR = resolve(import.meta.dirname!, '../../data/surreal-dump');

const CORE_MEMORY_IDS = new Set([
  'mem:656b9bfd6c874bb3b7e116c3f73a12da', // resonances
  'mem:5fc6d01df1ba4653a5273b0e87004c79', // social_coordination_lesson_paul_frazee_thread
]);

type SurrealMem = {
  id: string;
  label: string;
  memory_type: 'core' | 'working' | 'archival';
  value: string;
  permission: string;
  pinned: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  owner_id: string;
  metadata: Record<string, unknown>;
};

type SurrealResponse = Array<{ result: Array<SurrealMem>; status: string }>;

function mapPermission(surreal: string): string {
  const mapping: Record<string, string> = {
    read_write: 'readwrite',
    read_only: 'readonly',
    append: 'append',
    readwrite: 'readwrite',
    readonly: 'readonly',
  };
  return mapping[surreal] ?? 'readwrite';
}

function dedupeContent(text: string): string {
  const paragraphs = text.split('\n\n');
  const seen = new Set<string>();
  const unique: Array<string> = [];

  for (const p of paragraphs) {
    const normalized = p.trim();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      unique.push(normalized);
    }
  }

  return unique.join('\n\n') + '\n';
}

function loadMemDump(): Array<SurrealMem> {
  const raw = readFileSync(resolve(DUMP_DIR, 'mem.json'), 'utf-8');
  const parsed: SurrealResponse = JSON.parse(raw);
  return parsed[0]!.result;
}

function selectCoreMemories(mems: Array<SurrealMem>): Array<SurrealMem> {
  return mems.filter((m) => CORE_MEMORY_IDS.has(m.id));
}

function selectLatestProfiles(mems: Array<SurrealMem>): Array<SurrealMem> {
  const bsky = mems.filter((m) => m.label.startsWith('bluesky_user_'));
  const latest = new Map<string, SurrealMem>();

  for (const m of bsky) {
    const existing = latest.get(m.label);
    if (!existing || m.updated_at > existing.updated_at) {
      latest.set(m.label, m);
    }
  }

  return Array.from(latest.values());
}

async function main(): Promise<void> {
  const config = loadConfig();
  const persistence = createPostgresProvider(config.database);
  await persistence.connect();

  try {
    const allMems = loadMemDump();
    const toImport = [
      ...selectCoreMemories(allMems),
      ...selectLatestProfiles(allMems),
    ];

    console.log(`Importing ${toImport.length} memory blocks...`);

    let inserted = 0;
    let updated = 0;

    await persistence.withTransaction(async (query: QueryFunction) => {
      for (const mem of toImport) {
        const id = randomUUID();
        const tier = mem.memory_type;
        const permission = mapPermission(mem.permission);

        const content = dedupeContent(mem.value);

        const rows = await query<{ id: string; xmax: string }>(
          `INSERT INTO memory_blocks
           (id, owner, tier, label, content, embedding, permission, pinned, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, $9)
           ON CONFLICT (owner, label) DO UPDATE SET
             content = EXCLUDED.content,
             updated_at = EXCLUDED.updated_at
           RETURNING id, xmax::text`,
          [
            id,
            AGENT_OWNER,
            tier,
            mem.label,
            content,
            permission,
            mem.pinned,
            mem.created_at,
            mem.updated_at,
          ],
        );

        // xmax = '0' means fresh insert, non-zero means update
        const row = rows[0]!;
        if (row.xmax === '0') {
          inserted++;
        } else {
          updated++;
        }

        console.log(
          `  ${row.xmax === '0' ? '+' : '~'} [${tier}] ${mem.label}`,
        );
      }
    });

    console.log(`\nDone: ${inserted} inserted, ${updated} updated`);
  } finally {
    await persistence.disconnect();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
