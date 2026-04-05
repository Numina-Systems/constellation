// pattern: Imperative Shell

import { describe, it, expect, beforeEach } from 'bun:test';
import { createToolRegistry } from '../../tool/registry.ts';
import { cycleSpaceMoltTools } from './tool-cycling.ts';
import { filterToolsByState } from './tool-filter.ts';
import type { ToolRegistry, ToolDefinition } from '../../tool/types.ts';
import type { GameState } from './types.ts';
import type { ToolProvider } from '../tool-provider.ts';

describe('cycleSpaceMoltTools', () => {
  let registry: ToolRegistry;

  // Create realistic SpaceMolt tool definitions
  const createSpaceMoltTool = (name: string): ToolDefinition => ({
    name: `spacemolt:${name}`,
    description: `SpaceMolt ${name} tool`,
    parameters: [],
  });

  const createNativeTool = (name: string): ToolDefinition => ({
    name,
    description: `Native ${name} tool`,
    parameters: [],
  });

  // Create a minimal ToolProvider for testing
  const createMockToolProvider = (): ToolProvider => ({
    name: 'spacemolt',
    discover: async () => [],
    execute: async () => ({
      success: true,
      output: 'mocked',
    }),
  });

  beforeEach(() => {
    registry = createToolRegistry();
  });

  it('AC3.6: should cycle from DOCKED to COMBAT, removing docked-only tools and adding combat tools', () => {
    const nativeTools: ToolDefinition[] = [createNativeTool('memory_read')];
    const spacemoltTools: ToolDefinition[] = [
      createSpaceMoltTool('buy'), // docked only
      createSpaceMoltTool('sell'), // docked only
      createSpaceMoltTool('attack'), // combat only
      createSpaceMoltTool('scan'), // combat only
      createSpaceMoltTool('get_status'), // always
    ];

    const allTools = [...spacemoltTools, ...nativeTools];

    // Register native tools that don't get cycled
    for (const tool of nativeTools) {
      registry.register({
        definition: tool,
        handler: async () => ({ success: true, output: 'native' }),
      });
    }

    const toolProvider = createMockToolProvider();

    // Register initial DOCKED tools
    cycleSpaceMoltTools({
      registry,
      allTools: spacemoltTools,
      gameState: 'DOCKED',
      toolProvider,
    });

    const dockedDefs = registry.getDefinitions();
    const dockedNames = dockedDefs.map((d) => d.name);
    expect(dockedNames).toContain('spacemolt:buy');
    expect(dockedNames).toContain('spacemolt:sell');
    expect(dockedNames).not.toContain('spacemolt:attack');
    expect(dockedNames).not.toContain('spacemolt:scan');
    expect(dockedNames).toContain('spacemolt:get_status');
    expect(dockedNames).toContain('memory_read');

    // Cycle to COMBAT
    cycleSpaceMoltTools({
      registry,
      allTools: spacemoltTools,
      gameState: 'COMBAT',
      toolProvider,
    });

    const combatDefs = registry.getDefinitions();
    const combatNames = combatDefs.map((d) => d.name);
    expect(combatNames).not.toContain('spacemolt:buy');
    expect(combatNames).not.toContain('spacemolt:sell');
    expect(combatNames).toContain('spacemolt:attack');
    expect(combatNames).toContain('spacemolt:scan');
    expect(combatNames).toContain('spacemolt:get_status');
    expect(combatNames).toContain('memory_read');
  });

  it('AC3.7: native tools are unaffected by SpaceMolt tool cycling', () => {
    const nativeTools: ToolDefinition[] = [
      createNativeTool('memory_read'),
      createNativeTool('execute_code'),
    ];

    const spacemoltTools: ToolDefinition[] = [
      createSpaceMoltTool('buy'),
      createSpaceMoltTool('attack'),
      createSpaceMoltTool('get_status'),
    ];

    // Register native tools that don't get cycled
    for (const tool of nativeTools) {
      registry.register({
        definition: tool,
        handler: async () => ({ success: true, output: 'native' }),
      });
    }

    const toolProvider = createMockToolProvider();

    // Register with DOCKED
    cycleSpaceMoltTools({
      registry,
      allTools: spacemoltTools,
      gameState: 'DOCKED',
      toolProvider,
    });

    let defs = registry.getDefinitions();
    const nativeToolsAfterDocked = defs
      .filter((d) => !d.name.startsWith('spacemolt:'))
      .map((d) => d.name);
    expect(nativeToolsAfterDocked).toContain('memory_read');
    expect(nativeToolsAfterDocked).toContain('execute_code');

    // Cycle to COMBAT
    cycleSpaceMoltTools({
      registry,
      allTools: spacemoltTools,
      gameState: 'COMBAT',
      toolProvider,
    });

    defs = registry.getDefinitions();
    const nativeToolsAfterCombat = defs
      .filter((d) => !d.name.startsWith('spacemolt:'))
      .map((d) => d.name);
    expect(nativeToolsAfterCombat).toContain('memory_read');
    expect(nativeToolsAfterCombat).toContain('execute_code');
  });

  it('should replace combat tools with docked tools when cycling COMBAT -> DOCKED', () => {
    const allTools: ToolDefinition[] = [
      createSpaceMoltTool('buy'),
      createSpaceMoltTool('attack'),
      createSpaceMoltTool('get_status'),
    ];

    const toolProvider = createMockToolProvider();

    // Start in COMBAT
    cycleSpaceMoltTools({
      registry,
      allTools,
      gameState: 'COMBAT',
      toolProvider,
    });

    let names = registry.getDefinitions().map((d) => d.name);
    expect(names).toContain('spacemolt:attack');
    expect(names).not.toContain('spacemolt:buy');

    // Cycle to DOCKED
    cycleSpaceMoltTools({
      registry,
      allTools,
      gameState: 'DOCKED',
      toolProvider,
    });

    names = registry.getDefinitions().map((d) => d.name);
    expect(names).toContain('spacemolt:buy');
    expect(names).not.toContain('spacemolt:attack');
  });

  it('should include always-tools in every state', () => {
    const allTools: ToolDefinition[] = [
      createSpaceMoltTool('buy'),
      createSpaceMoltTool('attack'),
      createSpaceMoltTool('get_status'), // always
      createSpaceMoltTool('chat'), // always
    ];

    const toolProvider = createMockToolProvider();

    const states: GameState[] = ['DOCKED', 'UNDOCKED', 'COMBAT', 'TRAVELING'];

    for (const state of states) {
      cycleSpaceMoltTools({
        registry,
        allTools,
        gameState: state,
        toolProvider,
      });

      const names = registry.getDefinitions().map((d) => d.name);
      expect(names).toContain('spacemolt:get_status');
      expect(names).toContain('spacemolt:chat');
    }
  });

  it('should handle consecutive cycling without errors', () => {
    const allTools: ToolDefinition[] = [
      createSpaceMoltTool('buy'),
      createSpaceMoltTool('attack'),
      createSpaceMoltTool('get_status'),
    ];

    const toolProvider = createMockToolProvider();

    // Multiple cycles
    expect(() => {
      cycleSpaceMoltTools({
        registry,
        allTools,
        gameState: 'DOCKED',
        toolProvider,
      });

      cycleSpaceMoltTools({
        registry,
        allTools,
        gameState: 'COMBAT',
        toolProvider,
      });

      cycleSpaceMoltTools({
        registry,
        allTools,
        gameState: 'DOCKED',
        toolProvider,
      });
    }).not.toThrow();

    const defs = registry.getDefinitions();
    // Should have: get_status + buy (which are in DOCKED_TOOLS and ALWAYS_TOOLS)
    expect(defs).toHaveLength(2);
  });

  it('should be idempotent when cycling to same state twice', () => {
    const allTools: ToolDefinition[] = [
      createSpaceMoltTool('buy'),
      createSpaceMoltTool('attack'),
      createSpaceMoltTool('get_status'),
    ];

    const toolProvider = createMockToolProvider();

    cycleSpaceMoltTools({
      registry,
      allTools,
      gameState: 'DOCKED',
      toolProvider,
    });

    const firstCycleDefs = registry.getDefinitions();
    const firstNames = firstCycleDefs.map((d) => d.name).sort();

    cycleSpaceMoltTools({
      registry,
      allTools,
      gameState: 'DOCKED',
      toolProvider,
    });

    const secondCycleDefs = registry.getDefinitions();
    const secondNames = secondCycleDefs.map((d) => d.name).sort();

    expect(firstNames).toEqual(secondNames);
  });

  it('handlers should delegate to toolProvider.execute()', async () => {
    let executeCalled = false;
    let executedToolName = '';

    const toolProvider: ToolProvider = {
      name: 'spacemolt',
      discover: async () => [],
      execute: async (tool: string) => {
        executeCalled = true;
        executedToolName = tool;
        return {
          success: true,
          output: 'executed',
        };
      },
    };

    const allTools: ToolDefinition[] = [
      createSpaceMoltTool('buy'),
      createSpaceMoltTool('get_status'),
    ];

    cycleSpaceMoltTools({
      registry,
      allTools,
      gameState: 'DOCKED',
      toolProvider,
    });

    const result = await registry.dispatch('spacemolt:buy', {});

    expect(executeCalled).toBe(true);
    expect(executedToolName).toBe('spacemolt:buy');
    expect(result.success).toBe(true);
  });
});
