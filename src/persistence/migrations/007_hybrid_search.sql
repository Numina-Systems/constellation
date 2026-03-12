-- Add full-text search infrastructure to memory_blocks and messages tables.
--
-- memory_blocks: add generated tsvector column + GIN index (embedding column already exists)
-- messages: add embedding column + generated tsvector column + GIN index

-- memory_blocks: generated tsvector from content
ALTER TABLE memory_blocks
  ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;

CREATE INDEX idx_memory_blocks_search_vector
  ON memory_blocks USING GIN (search_vector);

-- messages: embedding column for semantic search (dimensionless, matching memory_blocks pattern)
ALTER TABLE messages
  ADD COLUMN embedding vector;

-- messages: generated tsvector from content
ALTER TABLE messages
  ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;

CREATE INDEX idx_messages_search_vector
  ON messages USING GIN (search_vector);
