// pattern: Imperative Shell

import { toSql } from 'pgvector/utils';
import type { PersistenceProvider } from '../persistence/types.ts';
import type { SkillStore } from './store.ts';

export function createPostgresSkillStore(
  persistence: PersistenceProvider,
): SkillStore {
  async function upsertEmbedding(
    id: string,
    name: string,
    description: string,
    contentHash: string,
    embedding: ReadonlyArray<number>,
  ): Promise<void> {
    const embeddingSql = `'${toSql(embedding as Array<number>)}'::vector`;
    await persistence.query(
      `INSERT INTO skill_embeddings (id, name, description, content_hash, embedding, updated_at)
       VALUES ($1, $2, $3, $4, ${embeddingSql}, NOW())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         content_hash = EXCLUDED.content_hash,
         embedding = EXCLUDED.embedding,
         updated_at = NOW()`,
      [id, name, description, contentHash],
    );
  }

  async function deleteEmbedding(id: string): Promise<void> {
    await persistence.query(
      'DELETE FROM skill_embeddings WHERE id = $1',
      [id],
    );
  }

  async function getByHash(id: string): Promise<string | null> {
    const rows = await persistence.query<{ content_hash: string }>(
      'SELECT content_hash FROM skill_embeddings WHERE id = $1',
      [id],
    );
    return rows[0]?.content_hash ?? null;
  }

  async function searchByEmbedding(
    embedding: ReadonlyArray<number>,
    limit: number,
    threshold: number,
  ): Promise<ReadonlyArray<{ id: string; score: number }>> {
    const embeddingSql = `'${toSql(embedding as Array<number>)}'::vector`;
    const rows = await persistence.query<{ id: string; similarity: number }>(
      `SELECT id, (1 - (embedding <=> ${embeddingSql})) as similarity
       FROM skill_embeddings
       WHERE embedding IS NOT NULL
       ORDER BY similarity DESC
       LIMIT $1`,
      [limit],
    );
    return rows
      .filter(r => r.similarity >= threshold)
      .map(r => ({ id: r.id, score: r.similarity }));
  }

  async function getAllIds(): Promise<ReadonlyArray<string>> {
    const rows = await persistence.query<{ id: string }>(
      'SELECT id FROM skill_embeddings',
      [],
    );
    return rows.map(r => r.id);
  }

  return {
    upsertEmbedding,
    deleteEmbedding,
    getByHash,
    searchByEmbedding,
    getAllIds,
  };
}
