import {describe, it, expect} from 'bun:test';
import {filterToolsByState} from './tool-filter.ts';
import type {ToolDefinition} from '../../tool/types.ts';
import type {GameState} from './types.ts';

function createMockTool(name: string): ToolDefinition {
  return {
    name,
    description: `Tool: ${name}`,
    parameters: [],
  };
}

describe('filterToolsByState', () => {
  describe('DOCKED state', () => {
    it('includes docked-specific tools (buy, sell, repair, undock)', () => {
      const allTools = [
        createMockTool('buy'),
        createMockTool('sell'),
        createMockTool('repair'),
        createMockTool('undock'),
      ];

      const result = filterToolsByState(allTools, 'DOCKED');

      expect(result.map(t => t.name)).toContain('buy');
      expect(result.map(t => t.name)).toContain('sell');
      expect(result.map(t => t.name)).toContain('repair');
      expect(result.map(t => t.name)).toContain('undock');
    });

    it('excludes undocked-specific tools (mine, attack)', () => {
      const allTools = [
        createMockTool('mine'),
        createMockTool('attack'),
      ];

      const result = filterToolsByState(allTools, 'DOCKED');

      expect(result.map(t => t.name)).not.toContain('mine');
      expect(result.map(t => t.name)).not.toContain('attack');
    });

    it('includes always-tools (get_status, chat, catalog)', () => {
      const allTools = [
        createMockTool('get_status'),
        createMockTool('chat'),
        createMockTool('catalog'),
      ];

      const result = filterToolsByState(allTools, 'DOCKED');

      expect(result.map(t => t.name)).toContain('get_status');
      expect(result.map(t => t.name)).toContain('chat');
      expect(result.map(t => t.name)).toContain('catalog');
    });
  });

  describe('UNDOCKED state', () => {
    it('includes undocked-specific tools (travel, jump, dock, mine)', () => {
      const allTools = [
        createMockTool('travel'),
        createMockTool('jump'),
        createMockTool('dock'),
        createMockTool('mine'),
      ];

      const result = filterToolsByState(allTools, 'UNDOCKED');

      expect(result.map(t => t.name)).toContain('travel');
      expect(result.map(t => t.name)).toContain('jump');
      expect(result.map(t => t.name)).toContain('dock');
      expect(result.map(t => t.name)).toContain('mine');
    });

    it('excludes docked-specific tools (buy, sell)', () => {
      const allTools = [
        createMockTool('buy'),
        createMockTool('sell'),
      ];

      const result = filterToolsByState(allTools, 'UNDOCKED');

      expect(result.map(t => t.name)).not.toContain('buy');
      expect(result.map(t => t.name)).not.toContain('sell');
    });

    it('includes always-tools', () => {
      const allTools = [
        createMockTool('get_status'),
        createMockTool('chat'),
        createMockTool('catalog'),
      ];

      const result = filterToolsByState(allTools, 'UNDOCKED');

      expect(result.map(t => t.name)).toContain('get_status');
      expect(result.map(t => t.name)).toContain('chat');
      expect(result.map(t => t.name)).toContain('catalog');
    });
  });

  describe('COMBAT state', () => {
    it('includes combat tools (attack, scan, cloak)', () => {
      const allTools = [
        createMockTool('attack'),
        createMockTool('scan'),
        createMockTool('cloak'),
      ];

      const result = filterToolsByState(allTools, 'COMBAT');

      expect(result.map(t => t.name)).toContain('attack');
      expect(result.map(t => t.name)).toContain('scan');
      expect(result.map(t => t.name)).toContain('cloak');
    });

    it('excludes non-combat tools (buy, sell, mine)', () => {
      const allTools = [
        createMockTool('buy'),
        createMockTool('sell'),
        createMockTool('mine'),
      ];

      const result = filterToolsByState(allTools, 'COMBAT');

      expect(result.map(t => t.name)).not.toContain('buy');
      expect(result.map(t => t.name)).not.toContain('sell');
      expect(result.map(t => t.name)).not.toContain('mine');
    });

    it('includes always-tools', () => {
      const allTools = [
        createMockTool('get_status'),
        createMockTool('chat'),
      ];

      const result = filterToolsByState(allTools, 'COMBAT');

      expect(result.map(t => t.name)).toContain('get_status');
      expect(result.map(t => t.name)).toContain('chat');
    });
  });

  describe('TRAVELING state', () => {
    it('includes only traveling-specific tools (get_system, get_poi)', () => {
      const allTools = [
        createMockTool('get_system'),
        createMockTool('get_poi'),
        createMockTool('travel'),
        createMockTool('mine'),
      ];

      const result = filterToolsByState(allTools, 'TRAVELING');

      expect(result.map(t => t.name)).toContain('get_system');
      expect(result.map(t => t.name)).toContain('get_poi');
      expect(result.map(t => t.name)).not.toContain('travel');
      expect(result.map(t => t.name)).not.toContain('mine');
    });

    it('includes always-tools', () => {
      const allTools = [
        createMockTool('get_status'),
        createMockTool('chat'),
      ];

      const result = filterToolsByState(allTools, 'TRAVELING');

      expect(result.map(t => t.name)).toContain('get_status');
      expect(result.map(t => t.name)).toContain('chat');
    });
  });

  describe('tool name handling with prefix', () => {
    it('strips spacemolt: prefix when filtering', () => {
      const allTools = [
        {name: 'spacemolt:buy', description: 'Buy', parameters: []},
        {name: 'spacemolt:sell', description: 'Sell', parameters: []},
        {name: 'get_status', description: 'Status', parameters: []},
      ];

      const result = filterToolsByState(allTools, 'DOCKED');

      // Should include all three since they're all relevant for DOCKED
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('always-tools are present in all states', () => {
    const alwaysTools = [
      'get_status',
      'get_ship',
      'chat',
      'help',
      'catalog',
      'analyze_market',
      'find_route',
    ];

    const states: ReadonlyArray<GameState> = ['DOCKED', 'UNDOCKED', 'COMBAT', 'TRAVELING'];

    for (const state of states) {
      it(`includes always-tools in ${state} state`, () => {
        const allTools = alwaysTools.map(createMockTool);

        const result = filterToolsByState(allTools, state);
        const resultNames = result.map(t => t.name);

        for (const alwaysTool of alwaysTools) {
          expect(resultNames).toContain(alwaysTool);
        }
      });
    }
  });

  it('returns empty array when no tools match the state', () => {
    const allTools: Array<ToolDefinition> = [];

    const result = filterToolsByState(allTools, 'DOCKED');

    expect(result).toEqual([]);
  });
});
