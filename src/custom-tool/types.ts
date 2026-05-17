// pattern: Functional Core

import type { ToolParameter } from '@/tool/types.js';

export type CustomToolDefinition = {
  readonly id: string;
  readonly owner: string;
  readonly name: string;
  readonly description: string;
  readonly parameters: ReadonlyArray<ToolParameter>;
  readonly code: string;
  readonly created_at: Date;
  readonly updated_at: Date;
};

export type CustomToolStore = {
  create(def: Omit<CustomToolDefinition, 'created_at' | 'updated_at'>): Promise<CustomToolDefinition>;
  update(owner: string, name: string, patch: Partial<Pick<CustomToolDefinition, 'description' | 'parameters' | 'code'>>): Promise<CustomToolDefinition | null>;
  delete(owner: string, name: string): Promise<boolean>;
  list(owner: string): Promise<ReadonlyArray<CustomToolDefinition>>;
  getByName(owner: string, name: string): Promise<CustomToolDefinition | null>;
};
