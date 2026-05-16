-- Session checkpoints table for storing agent session snapshots

CREATE TABLE IF NOT EXISTS session_checkpoints (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    owner TEXT NOT NULL,
    trigger TEXT NOT NULL CHECK (trigger IN ('explicit', 'pre_compaction', 'shutdown', 'interval')),
    checkpoint_data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_checkpoints_conversation_id
    ON session_checkpoints (conversation_id);

CREATE INDEX IF NOT EXISTS idx_session_checkpoints_owner
    ON session_checkpoints (owner);

CREATE INDEX IF NOT EXISTS idx_session_checkpoints_owner_created_at
    ON session_checkpoints (owner, created_at DESC);
