-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Memory blocks table (three-tier memory)
CREATE TABLE memory_blocks (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    tier TEXT NOT NULL CHECK (tier IN ('core', 'working', 'archival')),
    label TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    -- Embedding vector without explicit dimension specification to allow hot-swapping embedding models.
    -- pgvector will infer dimension from the first vector written, enabling model flexibility.
    embedding vector,
    permission TEXT NOT NULL CHECK (permission IN ('readonly', 'familiar', 'append', 'readwrite')),
    pinned BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_memory_blocks_owner ON memory_blocks (owner);
CREATE INDEX idx_memory_blocks_tier ON memory_blocks (tier);
CREATE INDEX idx_memory_blocks_label ON memory_blocks (label);
CREATE INDEX idx_memory_blocks_owner_tier ON memory_blocks (owner, tier);

-- Memory events table (event sourcing)
CREATE TABLE memory_events (
    id TEXT PRIMARY KEY,
    block_id TEXT NOT NULL REFERENCES memory_blocks(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN ('create', 'update', 'delete', 'archive')),
    old_content TEXT,
    new_content TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_memory_events_block_id ON memory_events (block_id);
CREATE INDEX idx_memory_events_created_at ON memory_events (created_at);

-- Conversation messages table
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content TEXT NOT NULL,
    tool_calls JSONB,
    tool_call_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation_id ON messages (conversation_id);
CREATE INDEX idx_messages_created_at ON messages (created_at);
CREATE INDEX idx_messages_conversation_created ON messages (conversation_id, created_at);

-- Pending mutations table (familiar permission approval flow)
CREATE TABLE pending_mutations (
    id TEXT PRIMARY KEY,
    block_id TEXT NOT NULL REFERENCES memory_blocks(id) ON DELETE CASCADE,
    proposed_content TEXT NOT NULL,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    feedback TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_pending_mutations_block_id ON pending_mutations (block_id);
CREATE INDEX idx_pending_mutations_status ON pending_mutations (status);
