-- Allow memory_events to retain delete audit records after block deletion.
-- Changes block_id from NOT NULL with ON DELETE CASCADE
-- to nullable with ON DELETE SET NULL.

ALTER TABLE memory_events
  DROP CONSTRAINT memory_events_block_id_fkey;

ALTER TABLE memory_events
  ALTER COLUMN block_id DROP NOT NULL;

ALTER TABLE memory_events
  ADD CONSTRAINT memory_events_block_id_fkey
    FOREIGN KEY (block_id) REFERENCES memory_blocks(id)
    ON DELETE SET NULL;
