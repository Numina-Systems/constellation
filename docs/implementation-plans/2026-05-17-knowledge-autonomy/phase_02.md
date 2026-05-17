# Knowledge Autonomy Implementation Plan — Phase 2: Tool Registry Extension

**Goal:** Add `unregister()` to `ToolRegistry` for runtime tool removal

**Architecture:** Single method addition to the existing Map-based tool registry. Minimal surface area change — one method on the interface, one `Map.delete()` in the implementation.

**Tech Stack:** TypeScript 5.7+, Bun

**Scope:** 7 phases from original design (phase 2 of 7)

**Codebase verified:** 2026-05-17

---

## Acceptance Criteria Coverage

This phase implements and tests:

### knowledge-autonomy.AC2: Custom Tools
- **knowledge-autonomy.AC2.1 Success:** `ToolRegistry.unregister()` removes a tool by name

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Add unregister to ToolRegistry interface

**Files:**
- Modify: `src/tool/types.ts` (add `unregister` method to `ToolRegistry` interface at line ~38)

**Implementation:**

Add the `unregister` method to the `ToolRegistry` interface. Insert after `register(tool: Tool): void;` (line 38):

```typescript
unregister(name: string): boolean;
```

The method returns `boolean` — `true` if a tool was removed, `false` if no tool existed with that name. This follows the pattern of `Map.delete()` which returns boolean.

The full interface should look like:

```typescript
export interface ToolRegistry {
  register(tool: Tool): void;
  unregister(name: string): boolean;
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

**Verification:**

Run: `bun run build`
Expected: Type-check will FAIL because `createToolRegistry()` doesn't implement `unregister` yet. This is expected — Task 2 fixes it.

**Commit:** Do not commit yet — continue to Task 2.

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Implement unregister in createToolRegistry

**Files:**
- Modify: `src/tool/registry.ts` (add `unregister` method inside the returned object, after `register` at line ~70)

**Implementation:**

Add the `unregister` method to the returned object in `createToolRegistry()`. Insert after the `register` method (after line 70):

```typescript
unregister(name: string): boolean {
  return tools.delete(name);
},
```

This is a single-line implementation — `Map.delete()` returns `true` if an element was removed, `false` otherwise. Since `toModelTools()` and `generateStubs()` iterate the Map on each call, unregistered tools are immediately invisible to the model on the next turn.

**Verification:**

Run: `bun run build`
Expected: Type-check passes

Run: `bun test src/tool/registry.test.ts`
Expected: All existing tests still pass (no regressions)

**Commit:** `feat(tool): add unregister() method to ToolRegistry`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Unregister lifecycle tests

**Verifies:** knowledge-autonomy.AC2.1

**Files:**
- Modify: `src/tool/registry.test.ts` (add new describe block for unregistration tests)

**Testing:**

Add a new `describe('unregistration')` block in `src/tool/registry.test.ts`. Tests must verify:

- knowledge-autonomy.AC2.1: `unregister()` removes a registered tool — `getDefinitions()` no longer includes it
- knowledge-autonomy.AC2.1: `dispatch()` returns "unknown tool" error after unregistration
- knowledge-autonomy.AC2.1: `generateStubs()` no longer includes stubs for unregistered tool
- knowledge-autonomy.AC2.1: `toModelTools()` no longer includes unregistered tool
- `unregister()` returns `true` when tool existed
- `unregister()` returns `false` when tool did not exist
- Full lifecycle: register → use → unregister → re-register with different handler → use with new handler

The lifecycle test is important because custom tools (Phase 3) will update tools by unregistering and re-registering them.

**Verification:**

Run: `bun test src/tool/registry.test.ts`
Expected: All tests pass, including new unregistration tests

**Commit:** `test(tool): add unregister lifecycle tests`

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
