// pattern: Functional Core

import type { DataSource } from '../data-source.ts';
import type { ToolProvider } from '../tool-provider.ts';
import type { ToolDefinition } from '../../tool/types.ts';

export type GameState = 'DOCKED' | 'UNDOCKED' | 'COMBAT' | 'TRAVELING';

export type GameStateManager = {
  getGameState(): GameState;
  updateFromEvent(event: SpaceMoltEvent): void;
  updateFromToolResult(toolName: string, result: Record<string, unknown>): void;
  reset(initialState: GameState): void;
};

export type SpaceMoltEvent = {
  readonly type: string;
  readonly payload: Record<string, unknown>;
};

export interface SpaceMoltDataSource extends DataSource {
  readonly name: 'spacemolt';
  getGameState(): GameState;
}

export interface SpaceMoltToolProvider extends ToolProvider {
  readonly name: 'spacemolt';
  refreshTools(): Promise<void>;
  close(): Promise<void>;
}

export type { ToolDefinition };
