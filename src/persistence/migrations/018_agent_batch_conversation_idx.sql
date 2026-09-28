-- Hot-path support for integrity lifecycle receipts. Batch receipts are
-- addressed by primary key, and recovery scans filter unfinished batches per
-- conversation through their details document. This migration is additive and
-- repeat-safe; existing rows are untouched.
CREATE INDEX IF NOT EXISTS idx_operation_receipts_agent_batch_conversation
    ON operation_receipts (operation_type, (details->>'conversationId'), created_at);
