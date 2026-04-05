// pattern: Functional Core

import type { GameState, GameStateManager, SpaceMoltEvent } from './types.ts';

export function nextStateFromEvent(
  current: GameState,
  event: SpaceMoltEvent,
): GameState {
  switch (event.type) {
    case 'combat_update':
      return 'COMBAT';
    case 'player_died':
      return 'DOCKED';
    case 'mining_yield':
      return 'UNDOCKED';
    default:
      return current;
  }
}

export function nextStateFromToolResult(
  current: GameState,
  toolName: string,
  result: Record<string, unknown>,
): GameState {
  switch (toolName) {
    case 'dock':
      return 'DOCKED';
    case 'undock':
      return 'UNDOCKED';
    case 'travel':
    case 'jump':
      if ('destination' in result || 'arrival_tick' in result) {
        return 'TRAVELING';
      }
      return current;
    case 'attack':
      return 'COMBAT';
    default:
      return current;
  }
}

export function createGameStateManager(
  initialState?: GameState,
): GameStateManager {
  let currentState: GameState = initialState ?? 'UNDOCKED';

  return {
    getGameState(): GameState {
      return currentState;
    },
    updateFromEvent(event: SpaceMoltEvent): void {
      currentState = nextStateFromEvent(currentState, event);
    },
    updateFromToolResult(toolName: string, result: Record<string, unknown>): void {
      currentState = nextStateFromToolResult(currentState, toolName, result);
    },
    reset(state: GameState): void {
      currentState = state;
    },
  };
}
