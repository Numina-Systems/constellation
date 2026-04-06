// pattern: Functional Core

import type { ToolParameter } from '../tool/types.ts';

export type SkillSource = 'builtin' | 'agent' | 'mcp';

export type SkillToolDefinition = {
  readonly name: string;
  readonly description: string;
  readonly parameters: ReadonlyArray<ToolParameter>;
};

export type SkillMetadata = {
  readonly name: string;
  readonly description: string;
  readonly version?: string;
  readonly tags?: ReadonlyArray<string>;
  readonly companions?: ReadonlyArray<string>;
  readonly tools?: ReadonlyArray<SkillToolDefinition>;
};

export type SkillDefinition = {
  readonly id: string;
  readonly metadata: SkillMetadata;
  readonly body: string;
  readonly companions: ReadonlyArray<{ readonly name: string; readonly content: string }>;
  readonly source: SkillSource;
  readonly filePath: string;
  readonly contentHash: string;
};

export type SkillSearchResult = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly score: number;
};

export type ParseResult =
  | { readonly success: true; readonly metadata: SkillMetadata; readonly body: string }
  | { readonly success: false; readonly error: string };

export type LoadResult = {
  readonly loaded: ReadonlyArray<SkillDefinition>;
  readonly errors: ReadonlyArray<{ readonly path: string; readonly error: string }>;
};

export interface SkillRegistry {
  load(): Promise<void>;
  getAll(): Array<SkillDefinition>;
  getByName(name: string): SkillDefinition | null;
  search(query: string, limit?: number): Promise<Array<SkillSearchResult>>;
  getRelevant(context: string, limit?: number, threshold?: number): Promise<Array<SkillDefinition>>;
  createAgentSkill(name: string, description: string, body: string, tags?: ReadonlyArray<string>): Promise<SkillDefinition>;
  updateAgentSkill(name: string, description: string, body: string, tags?: ReadonlyArray<string>): Promise<SkillDefinition>;
}
