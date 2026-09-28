import {describe, expect, it} from 'bun:test';
import {evaluateMaintenanceMemoryMutation, evaluatePublicMemoryDeletion, type MaintenanceMemoryConstraints, type MemoryDeletionRejection} from './deletion-policy.ts';
import type {MemoryBlock} from './types.ts';

const OWNER = 'owner-a';
const CONSTRAINTS: MaintenanceMemoryConstraints = {
  allowedTiers: ['archival'],
  requireUnpinned: true,
  requireReadwrite: true,
};

function block(overrides: Partial<MemoryBlock> = {}): MemoryBlock {
  return {
    id: 'block-1', owner: OWNER, tier: 'archival', label: 'label', content: 'content',
    embedding: null, permission: 'readwrite', pinned: false,
    created_at: new Date(0), updated_at: new Date(0), ...overrides,
  };
}

describe('memory_delete_authorization_matrix', () => {
  const cases: Array<[string, MemoryBlock | null, MemoryDeletionRejection]> = [
    ['foreign', block({owner: 'owner-b'}), 'missing_or_foreign'],
    ['missing', null, 'missing_or_foreign'],
    ['readonly', block({permission: 'readonly'}), 'readonly'],
    ['familiar', block({permission: 'familiar'}), 'familiar'],
    ['append-only', block({permission: 'append'}), 'append_only'],
    ['pinned', block({pinned: true}), 'pinned'],
    ['core', block({tier: 'core'}), 'core'],
  ];

  for (const [name, candidate, reason] of cases) {
    it(`rejects ${name} safely`, () => {
      const result = evaluatePublicMemoryDeletion(OWNER, candidate);
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.reason).toBe(reason);
    });
  }

  it('permits owner-owned unprotected readwrite non-core blocks', () => {
    expect(evaluatePublicMemoryDeletion(OWNER, block())).toEqual({allowed: true});
  });

  it('does not disclose foreign block metadata', () => {
    const foreign = evaluatePublicMemoryDeletion(OWNER, block({owner: 'owner-b', label: 'private'}));
    const missing = evaluatePublicMemoryDeletion(OWNER, null);
    expect(foreign).toEqual(missing);
  });
});

describe('maintenance_owner_tier_boundaries', () => {
  it('permits only the configured owner and archival unpinned readwrite rows', () => {
    expect(evaluateMaintenanceMemoryMutation(OWNER, block(), CONSTRAINTS)).toEqual({allowed: true});
    expect(evaluateMaintenanceMemoryMutation(OWNER, block({owner: 'owner-b'}), CONSTRAINTS).allowed).toBe(false);
    expect(evaluateMaintenanceMemoryMutation(OWNER, block({tier: 'working'}), CONSTRAINTS).allowed).toBe(false);
    expect(evaluateMaintenanceMemoryMutation(OWNER, block({pinned: true}), CONSTRAINTS).allowed).toBe(false);
    expect(evaluateMaintenanceMemoryMutation(OWNER, block({permission: 'append'}), CONSTRAINTS).allowed).toBe(false);
  });
});
