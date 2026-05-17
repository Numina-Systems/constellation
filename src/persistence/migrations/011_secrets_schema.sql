-- Secrets table for agent-managed API keys and credentials

CREATE TABLE IF NOT EXISTS secrets (
    owner TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (owner, key)
);

CREATE INDEX IF NOT EXISTS idx_secrets_owner
    ON secrets (owner);
