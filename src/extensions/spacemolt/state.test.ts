// pattern: Mixed (test file)

import { expect, test, describe } from 'bun:test';
import {
  nextStateFromEvent,
  nextStateFromToolResult,
  createGameStateManager,
} from './state.ts';
import type { SpaceMoltEvent } from './types.ts';

describe('nextStateFromEvent', () => {
  test('AC3.2: combat_update transitions to COMBAT from DOCKED', () => {
    const event: SpaceMoltEvent = { type: 'combat_update', payload: {} };
    const result = nextStateFromEvent('DOCKED', event);
    expect(result).toBe('COMBAT');
  });

  test('AC3.2: combat_update transitions to COMBAT from UNDOCKED', () => {
    const event: SpaceMoltEvent = { type: 'combat_update', payload: {} };
    const result = nextStateFromEvent('UNDOCKED', event);
    expect(result).toBe('COMBAT');
  });

  test('AC3.2: combat_update transitions to COMBAT from TRAVELING', () => {
    const event: SpaceMoltEvent = { type: 'combat_update', payload: {} };
    const result = nextStateFromEvent('TRAVELING', event);
    expect(result).toBe('COMBAT');
  });

  test('player_died transitions to DOCKED from COMBAT', () => {
    const event: SpaceMoltEvent = { type: 'player_died', payload: {} };
    const result = nextStateFromEvent('COMBAT', event);
    expect(result).toBe('DOCKED');
  });

  test('player_died transitions to DOCKED from UNDOCKED', () => {
    const event: SpaceMoltEvent = { type: 'player_died', payload: {} };
    const result = nextStateFromEvent('UNDOCKED', event);
    expect(result).toBe('DOCKED');
  });

  test('mining_yield transitions to UNDOCKED from DOCKED', () => {
    const event: SpaceMoltEvent = { type: 'mining_yield', payload: {} };
    const result = nextStateFromEvent('DOCKED', event);
    expect(result).toBe('UNDOCKED');
  });

  test('mining_yield transitions to UNDOCKED from TRAVELING', () => {
    const event: SpaceMoltEvent = { type: 'mining_yield', payload: {} };
    const result = nextStateFromEvent('TRAVELING', event);
    expect(result).toBe('UNDOCKED');
  });

  test('unknown event type returns current state unchanged', () => {
    const event: SpaceMoltEvent = { type: 'unknown_event', payload: {} };
    const result = nextStateFromEvent('DOCKED', event);
    expect(result).toBe('DOCKED');
  });

  test('unknown event type preserves COMBAT state', () => {
    const event: SpaceMoltEvent = { type: 'unknown_event', payload: {} };
    const result = nextStateFromEvent('COMBAT', event);
    expect(result).toBe('COMBAT');
  });
});

describe('nextStateFromToolResult', () => {
  test('AC3.3: travel with destination transitions to TRAVELING from UNDOCKED', () => {
    const result = nextStateFromToolResult('UNDOCKED', 'travel', {
      destination: 'Alpha Centauri',
      arrival_tick: 100,
    });
    expect(result).toBe('TRAVELING');
  });

  test('AC3.3: travel with arrival_tick transitions to TRAVELING from DOCKED', () => {
    const result = nextStateFromToolResult('DOCKED', 'travel', {
      destination: 'Beta Station',
      arrival_tick: 250,
    });
    expect(result).toBe('TRAVELING');
  });

  test('jump with destination transitions to TRAVELING from UNDOCKED', () => {
    const result = nextStateFromToolResult('UNDOCKED', 'jump', {
      destination: 'Proxima',
      arrival_tick: 500,
    });
    expect(result).toBe('TRAVELING');
  });

  test('jump with arrival_tick transitions to TRAVELING from DOCKED', () => {
    const result = nextStateFromToolResult('DOCKED', 'jump', {
      destination: 'Sirius',
      arrival_tick: 300,
    });
    expect(result).toBe('TRAVELING');
  });

  test('dock result transitions to DOCKED from UNDOCKED', () => {
    const result = nextStateFromToolResult('UNDOCKED', 'dock', {});
    expect(result).toBe('DOCKED');
  });

  test('dock result transitions to DOCKED from TRAVELING', () => {
    const result = nextStateFromToolResult('TRAVELING', 'dock', {});
    expect(result).toBe('DOCKED');
  });

  test('undock result transitions to UNDOCKED from DOCKED', () => {
    const result = nextStateFromToolResult('DOCKED', 'undock', {});
    expect(result).toBe('UNDOCKED');
  });

  test('attack result transitions to COMBAT from UNDOCKED', () => {
    const result = nextStateFromToolResult('UNDOCKED', 'attack', {});
    expect(result).toBe('COMBAT');
  });

  test('attack result transitions to COMBAT from DOCKED', () => {
    const result = nextStateFromToolResult('DOCKED', 'attack', {});
    expect(result).toBe('COMBAT');
  });

  test('unknown tool name returns current state unchanged', () => {
    const result = nextStateFromToolResult('DOCKED', 'unknown_tool', {});
    expect(result).toBe('DOCKED');
  });

  test('travel without destination does not transition', () => {
    const result = nextStateFromToolResult('UNDOCKED', 'travel', {
      some_field: 'value',
    });
    expect(result).toBe('UNDOCKED');
  });

  test('travel with only destination (no arrival_tick) still transitions', () => {
    const result = nextStateFromToolResult('UNDOCKED', 'travel', {
      destination: 'Alpha',
    });
    expect(result).toBe('TRAVELING');
  });

  test('jump with only arrival_tick (no destination) still transitions', () => {
    const result = nextStateFromToolResult('UNDOCKED', 'jump', {
      arrival_tick: 100,
    });
    expect(result).toBe('TRAVELING');
  });
});

describe('GameStateManager', () => {
  test('AC3.1: reset to DOCKED sets state to DOCKED', () => {
    const manager = createGameStateManager();
    manager.reset('DOCKED');
    expect(manager.getGameState()).toBe('DOCKED');
  });

  test('AC3.1: reset to UNDOCKED sets state to UNDOCKED', () => {
    const manager = createGameStateManager();
    manager.reset('UNDOCKED');
    expect(manager.getGameState()).toBe('UNDOCKED');
  });

  test('AC3.1: reset to COMBAT sets state to COMBAT', () => {
    const manager = createGameStateManager();
    manager.reset('COMBAT');
    expect(manager.getGameState()).toBe('COMBAT');
  });

  test('AC3.1: reset to TRAVELING sets state to TRAVELING', () => {
    const manager = createGameStateManager();
    manager.reset('TRAVELING');
    expect(manager.getGameState()).toBe('TRAVELING');
  });

  test('AC3.2: updateFromEvent with combat_update transitions to COMBAT', () => {
    const manager = createGameStateManager('DOCKED');
    manager.updateFromEvent({ type: 'combat_update', payload: {} });
    expect(manager.getGameState()).toBe('COMBAT');
  });

  test('AC3.3: updateFromToolResult with travel and destination transitions to TRAVELING', () => {
    const manager = createGameStateManager('DOCKED');
    manager.updateFromToolResult('travel', {
      destination: 'Alpha Centauri',
      arrival_tick: 100,
    });
    expect(manager.getGameState()).toBe('TRAVELING');
  });

  test('updateFromEvent changes internal state', () => {
    const manager = createGameStateManager('DOCKED');
    manager.updateFromEvent({ type: 'mining_yield', payload: {} });
    expect(manager.getGameState()).toBe('UNDOCKED');
  });

  test('updateFromToolResult changes internal state', () => {
    const manager = createGameStateManager('UNDOCKED');
    manager.updateFromToolResult('dock', {});
    expect(manager.getGameState()).toBe('DOCKED');
  });

  test('multiple updates chain correctly', () => {
    const manager = createGameStateManager('DOCKED');
    manager.updateFromToolResult('undock', {});
    expect(manager.getGameState()).toBe('UNDOCKED');
    manager.updateFromToolResult('travel', {
      destination: 'Station',
      arrival_tick: 50,
    });
    expect(manager.getGameState()).toBe('TRAVELING');
    manager.updateFromEvent({ type: 'combat_update', payload: {} });
    expect(manager.getGameState()).toBe('COMBAT');
  });

  test('default initial state is UNDOCKED', () => {
    const manager = createGameStateManager();
    expect(manager.getGameState()).toBe('UNDOCKED');
  });

  test('can set explicit initial state', () => {
    const manager = createGameStateManager('DOCKED');
    expect(manager.getGameState()).toBe('DOCKED');
  });
});
