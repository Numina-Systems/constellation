# SpaceMolt Integration — Phase 7: ToolRegistry Extension & Per-Turn Cycling

**Goal:** Add `unregister()` to ToolRegistry and implement per-turn tool cycling for SpaceMolt.

**Architecture:** Extends the existing `ToolRegistry` interface and implementation with an `unregister()` method. Adds a tool cycling function that swaps SpaceMolt tool subsets based on game state each turn.

**Tech Stack:** TypeScript

**Scope:** 8 phases from original design (phase 7 of 8)

**Codebase verified:** 2026-04-04

---

## Acceptance Criteria Coverage

This phase implements and tests:

### spacemolt-integration.AC3: Game state tracking and tool filtering (continued)
- **spacemolt-integration.AC3.6 Success:** Per-turn cycling unregisters previous `spacemolt:*` tools and registers new subset
- **spacemolt-integration.AC3.7 Edge:** Native tools are unaffected by SpaceMolt tool cycling

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Add `unregister()` to ToolRegistry

**Verifies:** spacemolt-integration.AC3.6 (prerequisite)

**Files:**
- Modify: `src/tool/types.ts:37-47` (add to interface)
- Modify: `src/tool/registry.ts` (implement)
- Test: `src/tool/registry.test.ts` (add tests, create file if needed)

**Implementation:**

In `src/tool/types.ts`, add `unregister` to the `ToolRegistry` interface (line ~40):

```typescript
export interface ToolRegistry {
  register(tool: Tool): void;
  unregister(name: string): boolean;  // NEW: returns true if tool existed
  getDefinitions(): Array<ToolDefinition>;
  dispatch(name: string, params: Record<string, unknown>): Promise<ToolResult>;
  generateStubs(): string;
  toModelTools(): Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
}
```

In `src/tool/registry.ts`, implement `unregister` in the returned object (the tools Map is on line 18):

```typescript
unregister(name: string): boolean {
  return tools.delete(name);
},
```

**Testing:**

- Register a tool, then `unregister(name)` returns `true`, `getDefinitions()` no longer includes it
- `unregister(nonExistentName)` returns `false`
- `dispatch(unregisteredName, {})` returns error ToolResult (tool not found)
- Existing tests continue to pass

**Verification:**
Run: `bun test src/tool/`
Expected: All tests pass

**Commit:** `feat: add unregister() to ToolRegistry`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Per-turn tool cycling

**Verifies:** spacemolt-integration.AC3.6, spacemolt-integration.AC3.7

**Files:**
- Create: `src/extensions/spacemolt/tool-cycling.ts`
- Test: `src/extensions/spacemolt/tool-cycling.test.ts`

**Implementation:**

Create `src/extensions/spacemolt/tool-cycling.ts` with `// pattern: Imperative Shell`. Export `cycleSpaceMoltTools(options)`.

```typescript
type CycleToolsOptions = {
  readonly registry: ToolRegistry;
  readonly allTools: ReadonlyArray<ToolDefinition>;
  readonly gameState: GameState;
  readonly toolProvider: ToolProvider;
};
```

The function:
1. Get all current tool definitions from registry
2. Filter to those with `spacemolt:` prefix
3. Unregister each one
4. Call `filterToolsByState(allTools, gameState)` to get the new subset
5. Register each tool in the subset with a handler that delegates to `toolProvider.execute()`

```typescript
export function cycleSpaceMoltTools(options: CycleToolsOptions): void {
  const { registry, allTools, gameState, toolProvider } = options;

  // Remove all existing spacemolt tools
  for (const def of registry.getDefinitions()) {
    if (def.name.startsWith("spacemolt:")) {
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
```

**Testing:**

Create a real `createToolRegistry()` instance. Register a native tool (`memory_read`) and some spacemolt tools.

- AC3.6: After cycling from DOCKED to COMBAT, docked-only tools (e.g., `spacemolt:buy`) are gone, combat tools (e.g., `spacemolt:attack`) are present
- AC3.7: After cycling, native tool `memory_read` is still present and callable
- Cycling from COMBAT to DOCKED replaces combat tools with docked tools
- Always-tools are present in every state after cycling
- Consecutive cycling (DOCKED → COMBAT → DOCKED) does not throw — `getDefinitions()` returns a new array snapshot so iterating while calling `unregister()` on the underlying Map is safe
- Calling `cycleSpaceMoltTools` twice with the same state is idempotent (no duplicate registration errors since old tools are unregistered first)

**Verification:**
Run: `bun test src/extensions/spacemolt/tool-cycling.test.ts`
Expected: All tests pass

**Commit:** `feat: add per-turn spacemolt tool cycling`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Update barrel exports

**Files:**
- Modify: `src/extensions/spacemolt/index.ts`

**Implementation:**

Add to barrel exports:
```typescript
export { cycleSpaceMoltTools } from "./tool-cycling.ts";
```

**Verification:**
Run: `bun run build`
Expected: No errors

**Commit:** `feat: export tool cycling from barrel`
<!-- END_TASK_3 -->
