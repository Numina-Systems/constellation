// pattern: Functional Core

import type {MemoryBlock, MemoryPermission, MemoryTier} from './types.ts';

export type MemoryDeletionRejection =
  | 'missing_or_foreign'
  | 'readonly'
  | 'familiar'
  | 'append_only'
  | 'pinned'
  | 'core';

export type MemoryDeletionDecision =
  | {readonly allowed: true}
  | {readonly allowed: false; readonly reason: MemoryDeletionRejection; readonly message: string};

const PERMISSION_MESSAGES: Readonly<Record<Exclude<MemoryPermission, 'readwrite'>, {readonly reason: MemoryDeletionRejection; readonly message: string}>> = {
  readonly: {reason: 'readonly', message: 'cannot delete a read-only memory block'},
  familiar: {reason: 'familiar', message: 'cannot delete a familiar memory block'},
  append: {reason: 'append_only', message: 'cannot delete an append-only memory block'},
};

/**
 * Decides whether a caller may publicly delete a memory block.
 *
 * A null block deliberately represents both a missing ID and a block owned by
 * another agent. Callers receive the same safe result in either case.
 */
export function evaluatePublicMemoryDeletion(
  owner: string,
  block: Readonly<MemoryBlock> | null,
): MemoryDeletionDecision {
  if (!block || block.owner !== owner) {
    return {
      allowed: false,
      reason: 'missing_or_foreign',
      message: 'memory block not found',
    };
  }

  if (block.tier === 'core') {
    return {
      allowed: false,
      reason: 'core',
      message: 'cannot delete a core memory block',
    };
  }

  if (block.permission !== 'readwrite') {
    const permission = PERMISSION_MESSAGES[block.permission];
    return {allowed: false, ...permission};
  }

  if (block.pinned) {
    return {
      allowed: false,
      reason: 'pinned',
      message: 'cannot delete a pinned memory block',
    };
  }

  return {allowed: true};
}

export type MaintenanceMemoryConstraints = {
  readonly allowedTiers: ReadonlyArray<MemoryTier>;
  readonly requireUnpinned: boolean;
  readonly requireReadwrite: boolean;
};

export type MaintenanceMemoryDecision =
  | {readonly allowed: true}
  | {readonly allowed: false; readonly reason: 'missing_or_foreign' | 'tier' | 'pinned' | 'permission'; readonly message: string};

/**
 * Validates a trusted maintenance mutation against its explicit scope.
 * Maintenance callers still cannot cross owners or mutate protected rows.
 */
export function evaluateMaintenanceMemoryMutation(
  owner: string,
  block: Readonly<MemoryBlock> | null,
  constraints: Readonly<MaintenanceMemoryConstraints>,
): MaintenanceMemoryDecision {
  if (!block || block.owner !== owner) {
    return {allowed: false, reason: 'missing_or_foreign', message: 'memory block not found'};
  }
  if (!constraints.allowedTiers.includes(block.tier)) {
    return {allowed: false, reason: 'tier', message: 'memory block is outside the maintenance tier scope'};
  }
  if (constraints.requireUnpinned && block.pinned) {
    return {allowed: false, reason: 'pinned', message: 'cannot maintain a pinned memory block'};
  }
  if (constraints.requireReadwrite && block.permission !== 'readwrite') {
    return {allowed: false, reason: 'permission', message: 'cannot maintain a protected memory block'};
  }
  return {allowed: true};
}
