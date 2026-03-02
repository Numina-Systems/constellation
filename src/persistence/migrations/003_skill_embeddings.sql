CREATE TABLE skill_embeddings (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    embedding vector,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_skill_embeddings_name ON skill_embeddings (name);
