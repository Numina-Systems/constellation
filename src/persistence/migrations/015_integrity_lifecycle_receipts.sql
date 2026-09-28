-- Phase 0 integrity lifecycle foundation: immutable operation receipts.
-- This migration is intentionally additive; existing transcript and memory rows remain untouched.
CREATE TABLE IF NOT EXISTS operation_receipts (
    operation_id TEXT PRIMARY KEY,
    operation_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('committed', 'rolled_back', 'unknown')),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operation_receipts_type_status
    ON operation_receipts (operation_type, status);
