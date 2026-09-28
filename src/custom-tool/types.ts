// pattern: Functional Core

import type {ToolParameter} from '@/tool/types.js';
import type {TransactionOutcome} from '@/contracts/outcomes.ts';

export type TransactionMutationResult = TransactionOutcome<CustomToolDefinition | boolean | null>;

export type CustomToolOperationType = 'create' | 'update' | 'delete';
export type CustomToolReceipt = Readonly<{
  readonly operation_id: string;
  readonly operation_type: string;
  readonly status: 'committed' | 'rolled_back' | 'unknown';
}>;

export type CustomToolDefinition = {
  readonly id: string;
  readonly owner: string;
  readonly name: string;
  readonly description: string;
  readonly parameters: ReadonlyArray<ToolParameter>;
  readonly inputSchema?: Readonly<Record<string, unknown>>;
  readonly code: string;
  readonly created_at: Date;
  readonly updated_at: Date;
};

export type CustomToolLoadIssue = Readonly<{
  readonly name: string;
  readonly reason: string;
}>;

export type CustomToolLoadResult = Readonly<{
  readonly definitions: ReadonlyArray<CustomToolDefinition>;
  readonly issues: ReadonlyArray<CustomToolLoadIssue>;
}>;

export type CustomToolStore = {
  create(def: Omit<CustomToolDefinition, 'created_at' | 'updated_at'>, query?: import('@/persistence/types.ts').QueryFunction): Promise<CustomToolDefinition>;
  update(owner: string, name: string, patch: Partial<Pick<CustomToolDefinition, 'description' | 'parameters' | 'inputSchema' | 'code'>>, query?: import('@/persistence/types.ts').QueryFunction): Promise<CustomToolDefinition | null>;
  delete(owner: string, name: string, query?: import('@/persistence/types.ts').QueryFunction): Promise<boolean>;
  /** Optional atomic mutation and receipt support supplied by durable stores. */
  mutate?: (operationId: string, operationType: CustomToolOperationType, action: (query: import('@/persistence/types.ts').QueryFunction) => Promise<CustomToolDefinition | boolean | null>) => Promise<TransactionMutationResult>;
  getReceipt?: (operationId: string) => Promise<CustomToolReceipt | null>;
  list(owner: string): Promise<ReadonlyArray<CustomToolDefinition>>;
  /** Optional tolerant loader that reports row decode failures without aborting the load. */
  listWithIssues?: (owner: string) => Promise<CustomToolLoadResult>;
  getByName(owner: string, name: string): Promise<CustomToolDefinition | null>;
};
