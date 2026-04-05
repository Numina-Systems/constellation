// pattern: Imperative Shell

import { filterToolsByState } from './tool-filter.ts';
import type { GameState } from './types.ts';
import type { ToolRegistry, ToolDefinition } from '../../tool/types.ts';
import type { ToolProvider } from '../tool-provider.ts';

export type CycleToolsOptions = {
  readonly registry: ToolRegistry;
  readonly allTools: ReadonlyArray<ToolDefinition>;
  readonly gameState: GameState;
  readonly toolProvider: ToolProvider;
};

export function cycleSpaceMoltTools(options: CycleToolsOptions): void {
  const { registry, allTools, gameState, toolProvider } = options;

  // Remove all existing spacemolt tools
  for (const def of registry.getDefinitions()) {
    if (def.name.startsWith('spacemolt:')) {
      registry.unregister(def.name);
    }
  }

  // Register new subset based on game state
  const filtered = filterToolsByState(allTools, gameState);
  for (const definition of filtered) {
    registry.register({
      definition,
      handler: async (params) => toolProvider.execute(definition.name, params),
    });
  }
}
