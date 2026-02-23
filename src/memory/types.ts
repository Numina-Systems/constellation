// pattern: Functional Core

/**
 * Memory system types for the three-tier memory architecture.
 * These types define the domain model for Core, Working, and Archival memory blocks.
 */

export type MemoryTier = 'core' | 'working' | 'archival';

export type MemoryPermission = 'readonly' | 'familiar' | 'append' | 'readwrite';

export type MemoryBlock = {
  id: string;
  owner: string;
  tier: MemoryTier;
  label: string;
  content: string;
  embedding: ReadonlyArray<number> | null;
  permission: MemoryPermission;
  pinned: boolean;
  created_at: Date;
  updated_at: Date;
};

export type MemoryEvent = {
  id: string;
  block_id: string;
  event_type: 'create' | 'update' | 'delete' | 'archive';
  old_content: string | null;
  new_content: string | null;
  created_at: Date;
};

export type PendingMutation = {
  id: string;
  block_id: string;
  proposed_content: string;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected';
  feedback: string | null;
  created_at: Date;
  resolved_at: Date | null;
};

export type MemorySearchResult = {
  block: MemoryBlock;
  similarity: number;
};

export type MemoryWriteResult =
  | { applied: true; block: MemoryBlock }
  | { applied: false; mutation: PendingMutation }
  | { applied: false; error: string };
