-- Custom tools table for agent-defined runtime tools

CREATE TABLE IF NOT EXISTS custom_tools (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    parameters JSONB NOT NULL DEFAULT '[]',
    code TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (owner, name)
);

CREATE INDEX IF NOT EXISTS idx_custom_tools_owner
    ON custom_tools (owner);
