-- Retained transcript with a revisioned active projection.
-- Messages remain canonical and are never deleted by history compaction.

CREATE TABLE IF NOT EXISTS conversation_history_state (
    conversation_id TEXT PRIMARY KEY,
    revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'messages_conversation_id_id_key'
    ) THEN
        ALTER TABLE messages ADD CONSTRAINT messages_conversation_id_id_key UNIQUE (conversation_id, id);
    END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS conversation_history_membership (
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    position BIGINT NOT NULL CHECK (position >= 0),
    PRIMARY KEY (conversation_id, message_id),
    UNIQUE (conversation_id, position),
    CONSTRAINT fk_history_membership_message
        FOREIGN KEY (conversation_id, message_id)
        REFERENCES messages (conversation_id, id)
        ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_history_membership_order
    ON conversation_history_membership (conversation_id, position);

CREATE TABLE IF NOT EXISTS conversation_history_provenance (
    operation_id TEXT PRIMARY KEY REFERENCES operation_receipts(operation_id) ON DELETE RESTRICT,
    conversation_id TEXT NOT NULL,
    source_message_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    source_archive_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    previous_revision BIGINT NOT NULL CHECK (previous_revision >= 0),
    new_revision BIGINT NOT NULL CHECK (new_revision > previous_revision),
    summary_message_id TEXT REFERENCES messages(id) ON DELETE RESTRICT,
    supersedes_operation_id TEXT REFERENCES conversation_history_provenance(operation_id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_history_provenance_conversation
    ON conversation_history_provenance (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS conversation_history_archive_refs (
    operation_id TEXT NOT NULL REFERENCES conversation_history_provenance(operation_id) ON DELETE RESTRICT,
    archive_block_id TEXT NOT NULL REFERENCES memory_blocks(id) ON DELETE RESTRICT,
    PRIMARY KEY (operation_id, archive_block_id)
);

ALTER TABLE memory_blocks
    ADD COLUMN IF NOT EXISTS history_owned BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS history_owner_operation_id TEXT;

ALTER TABLE memory_blocks
    DROP CONSTRAINT IF EXISTS fk_memory_blocks_history_owner;
ALTER TABLE memory_blocks
    ADD CONSTRAINT fk_memory_blocks_history_owner
    FOREIGN KEY (history_owner_operation_id)
    REFERENCES operation_receipts(operation_id)
    ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION prevent_history_owned_memory_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.history_owned AND current_setting('app.history_operation_id', true) IS DISTINCT FROM OLD.history_owner_operation_id THEN
        RAISE EXCEPTION 'history-owned memory block is immutable' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    IF OLD.history_owned AND (NEW.content IS DISTINCT FROM OLD.content
        OR NEW.embedding IS DISTINCT FROM OLD.embedding
        OR NEW.tier IS DISTINCT FROM OLD.tier
        OR NEW.permission IS DISTINCT FROM OLD.permission
        OR NEW.pinned IS DISTINCT FROM OLD.pinned
        OR NEW.owner IS DISTINCT FROM OLD.owner
        OR NEW.label IS DISTINCT FROM OLD.label) THEN
        RAISE EXCEPTION 'history-owned memory block is immutable' USING ERRCODE = '42501';
    END IF;
    IF OLD.history_owned AND (NOT NEW.history_owned OR NEW.history_owner_operation_id IS DISTINCT FROM OLD.history_owner_operation_id) THEN
        RAISE EXCEPTION 'history ownership cannot be removed' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_history_owned_memory ON memory_blocks;
CREATE TRIGGER trg_protect_history_owned_memory
BEFORE UPDATE OR DELETE ON memory_blocks
FOR EACH ROW EXECUTE FUNCTION prevent_history_owned_memory_mutation();

CREATE OR REPLACE FUNCTION append_message_to_active_history()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    next_position BIGINT;
BEGIN
    INSERT INTO conversation_history_state (conversation_id, revision)
    VALUES (NEW.conversation_id, 0)
    ON CONFLICT (conversation_id) DO UPDATE SET revision = conversation_history_state.revision;
    SELECT COALESCE(MAX(position), -1) + 1 INTO next_position
      FROM conversation_history_membership
      WHERE conversation_id = NEW.conversation_id;
    INSERT INTO conversation_history_membership (conversation_id, message_id, position)
    VALUES (NEW.conversation_id, NEW.id, next_position);
    UPDATE conversation_history_state
       SET revision = revision + 1, updated_at = NOW()
     WHERE conversation_id = NEW.conversation_id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_append_message_to_active_history ON messages;
CREATE TRIGGER trg_append_message_to_active_history
AFTER INSERT ON messages
FOR EACH ROW EXECUTE FUNCTION append_message_to_active_history();

-- Deterministic, repeat-safe backfill for installations that existed before this migration.
INSERT INTO conversation_history_state (conversation_id, revision)
SELECT conversation_id, COUNT(*)
FROM messages
GROUP BY conversation_id
ON CONFLICT (conversation_id) DO NOTHING;

INSERT INTO conversation_history_membership (conversation_id, message_id, position)
SELECT conversation_id, id,
       ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY created_at ASC, id ASC) - 1
FROM messages
ON CONFLICT (conversation_id, message_id) DO NOTHING;

UPDATE conversation_history_state state
SET revision = counts.message_count,
    updated_at = NOW()
FROM (
    SELECT conversation_id, COUNT(*)::BIGINT AS message_count
    FROM conversation_history_membership
    GROUP BY conversation_id
) counts
WHERE state.conversation_id = counts.conversation_id
  AND state.revision < counts.message_count;

CREATE INDEX IF NOT EXISTS idx_history_state_updated_at
    ON conversation_history_state (updated_at);
