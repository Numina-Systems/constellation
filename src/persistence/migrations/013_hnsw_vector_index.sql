-- HNSW vector index for efficient cosine similarity search on memory block embeddings.
-- Requires pgvector >= 0.5.0 (project uses pgvector/pgvector:pg17 which ships 0.7+).
--
-- The embedding column has no explicit dimension constraint (001_initial_schema.sql comment:
-- "pgvector will infer dimension from the first vector written"). HNSW indexes on
-- untyped vector columns work in pgvector 0.7+ — the index inherits the dimension
-- from existing data.
--
-- If no embeddings exist yet, the index is created empty and populates as vectors
-- are inserted. If the embedding model changes (different dimensions), existing
-- vectors and this index must be rebuilt.

CREATE INDEX IF NOT EXISTS idx_memory_blocks_embedding_hnsw
    ON memory_blocks
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Also index skill_embeddings for skill retrieval performance
CREATE INDEX IF NOT EXISTS idx_skill_embeddings_embedding_hnsw
    ON skill_embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
