-- Scope retained-history summary references to the same conversation as the provenance row.
-- Existing rows are checked by PostgreSQL before the constraint is installed; no data is rewritten.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'conversation_history_provenance_summary_message_fk'
    ) THEN
        ALTER TABLE conversation_history_provenance
            ADD CONSTRAINT conversation_history_provenance_summary_message_fk
            FOREIGN KEY (conversation_id, summary_message_id)
            REFERENCES messages (conversation_id, id)
            ON DELETE RESTRICT;
    END IF;
END;
$$;
