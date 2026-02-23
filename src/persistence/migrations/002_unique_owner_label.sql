-- Add unique constraint on (owner, label) to ensure memory block labels are unique per owner
CREATE UNIQUE INDEX idx_memory_blocks_owner_label ON memory_blocks (owner, label);
