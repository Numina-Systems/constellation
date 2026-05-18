-- Fix: HNSW indexes on dimensionless vector columns fail because pgvector's
-- hnswbuild.c:InitBuildState requires an explicit dimension, even when data exists.
--
-- Solution: Detect the actual dimension from existing data and create the index
-- using a cast to vector(N). If no embeddings exist, skip index creation entirely.

DROP INDEX IF EXISTS idx_memory_blocks_embedding_hnsw;
DROP INDEX IF EXISTS idx_skill_embeddings_embedding_hnsw;

DO $$
DECLARE
  dim integer;
BEGIN
  -- memory_blocks
  SELECT vector_dims(embedding) INTO dim
    FROM memory_blocks
    WHERE embedding IS NOT NULL
    LIMIT 1;

  IF dim IS NOT NULL THEN
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_memory_blocks_embedding_hnsw
         ON memory_blocks
         USING hnsw ((embedding::vector(%s)) vector_cosine_ops)
         WITH (m = 16, ef_construction = 64)',
      dim
    );
    RAISE NOTICE 'Created HNSW index on memory_blocks (% dimensions)', dim;
  ELSE
    RAISE NOTICE 'Skipped HNSW index on memory_blocks (no embeddings yet)';
  END IF;

  -- skill_embeddings
  dim := NULL;
  SELECT vector_dims(embedding) INTO dim
    FROM skill_embeddings
    WHERE embedding IS NOT NULL
    LIMIT 1;

  IF dim IS NOT NULL THEN
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_skill_embeddings_embedding_hnsw
         ON skill_embeddings
         USING hnsw ((embedding::vector(%s)) vector_cosine_ops)
         WITH (m = 16, ef_construction = 64)',
      dim
    );
    RAISE NOTICE 'Created HNSW index on skill_embeddings (% dimensions)', dim;
  ELSE
    RAISE NOTICE 'Skipped HNSW index on skill_embeddings (no embeddings yet)';
  END IF;
END
$$;
