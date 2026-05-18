-- Fix: HNSW indexes on dimensionless vector columns fail when tables are empty.
-- Migration 013 assumed pgvector could build an HNSW index on an untyped vector
-- column with no data — it cannot (hnswbuild.c:InitBuildState requires dimensions).
--
-- Solution: Drop the indexes from 013 if they exist, then recreate them only
-- when data is present. If no embeddings exist yet, skip index creation —
-- the index will be created by a future migration or manually after first data insert.

DROP INDEX IF EXISTS idx_memory_blocks_embedding_hnsw;
DROP INDEX IF EXISTS idx_skill_embeddings_embedding_hnsw;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM memory_blocks WHERE embedding IS NOT NULL LIMIT 1) THEN
    CREATE INDEX IF NOT EXISTS idx_memory_blocks_embedding_hnsw
        ON memory_blocks
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64);
    RAISE NOTICE 'Created HNSW index on memory_blocks';
  ELSE
    RAISE NOTICE 'Skipped HNSW index on memory_blocks (no embeddings yet)';
  END IF;

  IF EXISTS (SELECT 1 FROM skill_embeddings WHERE embedding IS NOT NULL LIMIT 1) THEN
    CREATE INDEX IF NOT EXISTS idx_skill_embeddings_embedding_hnsw
        ON skill_embeddings
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64);
    RAISE NOTICE 'Created HNSW index on skill_embeddings';
  ELSE
    RAISE NOTICE 'Skipped HNSW index on skill_embeddings (no embeddings yet)';
  END IF;
END
$$;
