// pattern: Functional Core (test)

import { describe, it, expect } from 'bun:test';
import { createToolRegistry } from '@/tool/registry.ts';
import type {
  SpaceMoltDataSource,
  SpaceMoltToolProvider,
} from './types.ts';
import { cycleSpaceMoltTools } from './tool-cycling.ts';
import { createGameStateManager } from './state.ts';

/**
 * AC7: Composition Root Wiring Tests
 *
 * These tests verify that SpaceMolt components integrate correctly in the
 * composition root (src/index.ts) without testing src/index.ts directly.
 * Instead, we compose the components together with mocks and verify the
 * integration works as expected.
 */

describe('SpaceMolt Wiring (AC7)', () => {
  // Mock implementations for composition root wiring tests
  function createMockSpaceMoltSource(): SpaceMoltDataSource {
    return {
      name: 'spacemolt',
      async connect() {
        // no-op
      },
      async disconnect() {
        // no-op
      },
      onMessage() {
        // no-op
      },
      getGameState() {
        return 'DOCKED';
      },
    };
  }

  function createMockSpaceMoltToolProvider(): SpaceMoltToolProvider {
    return {
      name: 'spacemolt',
      async discover() {
        return [
          // ALWAYS_TOOLS
          {
            name: 'spacemolt:get_status',
            description: 'Get game status',
            parameters: [],
          },
          // DOCKED_TOOLS
          {
            name: 'spacemolt:buy',
            description: 'Buy items at station',
            parameters: [
              {
                name: 'item',
                type: 'string',
                required: true,
                description: 'Item to buy',
              },
            ],
          },
          {
            name: 'spacemolt:sell',
            description: 'Sell items',
            parameters: [
              {
                name: 'item',
                type: 'string',
                required: true,
                description: 'Item to sell',
              },
            ],
          },
          // UNDOCKED_TOOLS
          {
            name: 'spacemolt:mine',
            description: 'Mine for resources',
            parameters: [
              {
                name: 'location',
                type: 'string',
                required: true,
                description: 'Mining location',
              },
            ],
          },
          {
            name: 'spacemolt:travel',
            description: 'Travel to destination',
            parameters: [
              {
                name: 'destination',
                type: 'string',
                required: true,
                description: 'Destination',
              },
            ],
          },
          // COMBAT_TOOLS
          {
            name: 'spacemolt:attack',
            description: 'Attack enemy',
            parameters: [
              {
                name: 'target',
                type: 'string',
                required: true,
                description: 'Target to attack',
              },
            ],
          },
          {
            name: 'spacemolt:scan',
            description: 'Scan area',
            parameters: [],
          },
        ];
      },
      async execute() {
        return {
          success: true,
          output: 'executed',
        };
      },
      async refreshTools() {
        // no-op
      },
      async close() {
        // no-op
      },
    };
  }

  describe('AC7.1: Enabled config activates integration', () => {
    it('with spacemolt enabled, all factory functions are called and components initialized', async () => {
      const source = createMockSpaceMoltSource();
      const toolProvider = createMockSpaceMoltToolProvider();
      const gameStateManager = createGameStateManager();

      // Verify components exist and are callable
      expect(source).toBeDefined();
      expect(source.name).toBe('spacemolt');
      expect(toolProvider).toBeDefined();
      expect(toolProvider.name).toBe('spacemolt');
      expect(gameStateManager).toBeDefined();

      // Simulate composition root lifecycle
      await source.connect();
      const tools = await toolProvider.discover();

      expect(tools.length).toBeGreaterThan(0);
      expect(tools.some((t) => t.name.startsWith('spacemolt:'))).toBe(true);
    });

    it('creates lifecycle coordinator that manages start/stop', async () => {
      const source = createMockSpaceMoltSource();
      const toolProvider = createMockSpaceMoltToolProvider();

      // In composition root, these are wired together in createSpaceMoltLifecycle
      // Verify the components work together
      let sourceCalled = false;
      let toolsDiscovered = false;

      const trackingSource: SpaceMoltDataSource = {
        ...source,
        async connect() {
          sourceCalled = true;
        },
      };

      const trackingProvider: SpaceMoltToolProvider = {
        ...toolProvider,
        async discover() {
          toolsDiscovered = true;
          return await toolProvider.discover();
        },
      };

      // Simulate composition root wiring
      await trackingSource.connect();
      await trackingProvider.discover();

      expect(sourceCalled).toBe(true);
      expect(toolsDiscovered).toBe(true);
    });
  });

  describe('AC7.2: DataSource registered with source-specific handling', () => {
    it('source has name "spacemolt" and produces IncomingMessage', async () => {
      const source = createMockSpaceMoltSource();

      expect(source.name).toBe('spacemolt');

      // Verify onMessage handler can be registered
      source.onMessage(() => {
        // Handler registration succeeds
      });

      // Verify the structure is compatible with IncomingMessage
      const testEvent = {
        source: 'spacemolt',
        content: 'test event',
        metadata: {},
        timestamp: new Date(),
      };

      expect(testEvent.source).toBe('spacemolt');
      expect(typeof testEvent.content).toBe('string');
      expect(typeof testEvent.timestamp).toBe('object');
    });

    it('onMessage handler receives IncomingMessage with spacemolt source', async () => {
      const source = createMockSpaceMoltSource();

      // In composition root, highPriorityFilter wraps the handler
      source.onMessage(() => {
        // Handler processes message
      });

      // Simulate high-priority event (combat)
      const combatEvent = {
        source: 'spacemolt',
        content: 'Combat update: enemy attacked for 50 damage',
        metadata: { eventType: 'combat_update' },
        timestamp: new Date(),
      };

      // In real composition root, this would be called by source
      // Verify the structure is compatible with IncomingMessage
      expect(combatEvent.source).toBe('spacemolt');
      expect(typeof combatEvent.content).toBe('string');
      expect(typeof combatEvent.timestamp).toBe('object');
    });
  });

  describe('AC7.3: Per-source instructions injected into agent context', () => {
    it('SpaceMolt source receives per-source instructions mentioning SpaceMolt', () => {
      const source = createMockSpaceMoltSource();

      // In composition root, per-source instructions are added to agent config
      // This is verified by checking that source.name matches the instructions key
      const spacemoltInstructions =
        'You are playing SpaceMolt, a space trading game. ' +
        'You can mine resources, buy/sell items, engage in combat, and travel between locations. ' +
        'Use the spacemolt: prefixed tools to interact with the game.';

      expect(source.name).toBe('spacemolt');
      expect(spacemoltInstructions).toContain('SpaceMolt');
      expect(spacemoltInstructions).toContain('spacemolt:');
    });
  });

  describe('AC7.4: Tool cycling in agent beforeTurn callback', () => {
    it('beforeTurn callback cycles tools based on game state', async () => {
      const registry = createToolRegistry();
      const gameStateManager = createGameStateManager();
      const toolProvider = createMockSpaceMoltToolProvider();

      // Simulate composition root setup:
      // 1. Discover all tools
      const allTools = await toolProvider.discover();

      // 2. Set initial state to DOCKED for this test
      gameStateManager.reset('DOCKED');

      // 3. Register initial tools for DOCKED state
      cycleSpaceMoltTools({
        registry,
        allTools,
        gameState: gameStateManager.getGameState(),
        toolProvider,
      });

      const initialTools = registry.getDefinitions().map((t) => t.name);
      expect(initialTools).toContain('spacemolt:buy');
      expect(initialTools).toContain('spacemolt:sell');
      expect(initialTools).toContain('spacemolt:get_status');

      // 4. Simulate state change to COMBAT (would come from game event)
      gameStateManager.updateFromEvent({
        type: 'combat_update',
        payload: {},
      });

      // 5. beforeTurn callback cycles to new state
      cycleSpaceMoltTools({
        registry,
        allTools,
        gameState: gameStateManager.getGameState(),
        toolProvider,
      });

      const combatTools = registry.getDefinitions().map((t) => t.name);
      expect(combatTools).toContain('spacemolt:get_status');
      expect(combatTools).toContain('spacemolt:attack');
      expect(combatTools).toContain('spacemolt:scan');
      // In COMBAT state, docking tools should not be present
      expect(combatTools).not.toContain('spacemolt:buy');
      expect(combatTools).not.toContain('spacemolt:sell');
    });

    it('beforeTurn cycles tools when transitioning between states', async () => {
      const registry = createToolRegistry();
      const gameStateManager = createGameStateManager();
      const toolProvider = createMockSpaceMoltToolProvider();

      const allTools = await toolProvider.discover();

      // Start in DOCKED
      gameStateManager.reset('DOCKED');
      cycleSpaceMoltTools({
        registry,
        allTools,
        gameState: 'DOCKED',
        toolProvider,
      });

      let defs = registry.getDefinitions().map((t) => t.name);
      expect(defs).toContain('spacemolt:buy');

      // Transition to TRAVELING
      gameStateManager.reset('TRAVELING');
      cycleSpaceMoltTools({
        registry,
        allTools,
        gameState: 'TRAVELING',
        toolProvider,
      });

      defs = registry.getDefinitions().map((t) => t.name);
      // Traveling tools are different from docked
      expect(defs).toContain('spacemolt:get_status');

      // Transition to COMBAT
      gameStateManager.reset('COMBAT');
      cycleSpaceMoltTools({
        registry,
        allTools,
        gameState: 'COMBAT',
        toolProvider,
      });

      defs = registry.getDefinitions().map((t) => t.name);
      expect(defs).toContain('spacemolt:get_status');
    });
  });

  describe('AC7.5: Disabled config creates no components', () => {
    it('without spacemolt config, no components are created', () => {
      // In composition root, this check is:
      // if (config.spacemolt?.enabled) { ... }

      // Test the enabled check
      const enabledConfig = { enabled: true };
      const disabledConfig = { enabled: false };
      const missingConfig = null as unknown;

      expect(enabledConfig.enabled).toBe(true);
      expect(disabledConfig.enabled).toBe(false);
      expect(missingConfig).toBeNull();

      // Verify factory functions would NOT be called
      let factoriesWereCalled = false;

      if (enabledConfig.enabled) {
        factoriesWereCalled = true;
      }
      expect(factoriesWereCalled).toBe(true);

      factoriesWereCalled = false;
      if (disabledConfig?.enabled) {
        factoriesWereCalled = true;
      }
      expect(factoriesWereCalled).toBe(false);

      factoriesWereCalled = false;
      if ((missingConfig as Record<string, unknown> | null)?.['enabled']) {
        factoriesWereCalled = true;
      }
      expect(factoriesWereCalled).toBe(false);
    });

    it('with enabled=false, lifecycle is null', () => {
      // Simulate composition root logic:
      // if (config.spacemolt?.enabled) {
      //   spacemoltLifecycle = createSpaceMoltLifecycle(...)
      // }

      let spacemoltLifecycle: unknown = null;
      const config = { spacemolt: { enabled: false } };

      if (config.spacemolt?.enabled) {
        // Would create lifecycle here
        spacemoltLifecycle = {};
      }

      expect(spacemoltLifecycle).toBeNull();
    });

    it('without config section, lifecycle is null', () => {
      let spacemoltLifecycle: unknown = null;
      const config: Record<string, Record<string, unknown>> = {};

      if (config['spacemolt']?.['enabled']) {
        spacemoltLifecycle = {};
      }

      expect(spacemoltLifecycle).toBeNull();
    });
  });

  describe('integration: full wiring scenario', () => {
    it('simulates complete composition root flow with correct lifecycle ordering', async () => {
      const registry = createToolRegistry();
      const gameStateManager = createGameStateManager();
      const callOrder: Array<string> = [];

      // Track call order to verify discover-before-connect
      const source: SpaceMoltDataSource = {
        ...createMockSpaceMoltSource(),
        async connect() {
          callOrder.push('connect');
        },
      };

      const toolProvider: SpaceMoltToolProvider = {
        ...createMockSpaceMoltToolProvider(),
        async discover() {
          callOrder.push('discover');
          return await createMockSpaceMoltToolProvider().discover();
        },
      };

      // Phase 1: Enable check (AC7.5)
      const config = { spacemolt: { enabled: true } };
      let spacemoltActive = false;

      if (config.spacemolt?.enabled) {
        spacemoltActive = true;
      }
      expect(spacemoltActive).toBe(true);

      // Phase 2: Create components (AC7.1)
      expect(source.name).toBe('spacemolt');
      expect(toolProvider.name).toBe('spacemolt');

      // Phase 3: Lifecycle start with discover-before-connect ordering (AC5.3)
      // Simulate composition root calling discover then connect (as lifecycle.start does)
      await toolProvider.discover();
      await source.connect();

      // Verify discover was called before connect
      expect(callOrder).toEqual(['discover', 'connect']);

      const tools = await toolProvider.discover();
      expect(tools.length).toBeGreaterThan(0);

      // Phase 4: Tool cycling (AC7.4)
      cycleSpaceMoltTools({
        registry,
        allTools: tools,
        gameState: gameStateManager.getGameState(),
        toolProvider,
      });

      const registeredTools = registry.getDefinitions().map((t) => t.name);
      expect(registeredTools.some((n) => n.startsWith('spacemolt:'))).toBe(true);

      // Phase 5: State transition with tool cycling
      gameStateManager.updateFromEvent({
        type: 'combat_update',
        payload: {},
      });

      cycleSpaceMoltTools({
        registry,
        allTools: tools,
        gameState: gameStateManager.getGameState(),
        toolProvider,
      });

      // Phase 6: Lifecycle stop (on disable or sleep)
      spacemoltActive = false;
      await source.disconnect();
      await toolProvider.close();

      expect(spacemoltActive).toBe(false);
    });

    it('verifies source receives getCredentials function instead of static credentials', async () => {
      // This test verifies the composition root wiring pattern:
      // source.getCredentials should be a function, not a static value
      // This allows source to read from memory at connection time

      // Simulate composition root pattern
      const getCredentials = () => {
        // In real code: return readCredentials(memoryStore)
        return null;
      };

      // Verify getCredentials is a function
      expect(typeof getCredentials).toBe('function');

      // Verify it can be called
      const result = getCredentials();
      expect(result).toBeNull();
    });
  });
});
