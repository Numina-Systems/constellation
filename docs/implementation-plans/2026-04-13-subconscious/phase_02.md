# Subconscious Implementation Plan — Phase 2: Interest Management Tools

**Goal:** Tools for both agents to manage and query the interest registry, following the scheduling tools pattern from `src/tool/builtin/scheduling.ts`.

**Architecture:** Factory function returning `Array<Tool>` with injected `InterestRegistry` dependency. Parameters defined as inline `ToolParameter` arrays. Registration in composition root via loop.

**Tech Stack:** TypeScript (Bun), bun:test

**Scope:** 7 phases from original design (phase 2 of 7)

**Codebase verified:** 2026-04-14

---

## Acceptance Criteria Coverage

This phase implements and tests:

### subconscious.AC4: Both agents can interact with interests and see each other's activity
- **subconscious.AC4.1 Success:** manage_interest tool creates, updates, and transitions interests
- **subconscious.AC4.2 Success:** manage_curiosity tool creates, explores, resolves, and parks curiosity threads
- **subconscious.AC4.3 Success:** list_interests tool returns interests filtered by status, source, or minimum engagement score
- **subconscious.AC4.4 Success:** list_curiosities tool returns curiosity threads for an interest, filtered by status

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Interest management tool definitions

**Verifies:** None directly (tested in Task 3)

**Files:**
- Create: `src/tool/builtin/subconscious.ts`

**Implementation:**

Create with pattern annotation `// pattern: Imperative Shell`.

Import types:
- `Tool`, `ToolResult` from `../types.ts`
- `InterestRegistry`, `InterestStatus`, `InterestSource`, `CuriosityStatus` from `../../subconscious/types.ts`

Define dependency type:
```typescript
type SubconsciousToolDeps = {
  readonly registry: InterestRegistry;
  readonly owner: string;
};
```

Export factory function:
```typescript
export function createSubconsciousTools(deps: SubconsciousToolDeps): Array<Tool>
```

Define 4 tools:

**`manage_interest`** — Creates, updates, or transitions interests.

Parameters:
- `action` (string, required, enum: `['create', 'update', 'transition']`)
- `id` (string, not required) — required for update/transition
- `name` (string, not required) — required for create, optional for update
- `description` (string, not required) — optional
- `source` (string, not required, enum: `['emergent', 'seeded', 'external']`) — for create
- `status` (string, not required, enum: `['active', 'dormant', 'abandoned']`) — for transition
- `engagement_score` (number, not required) — for update

Handler logic:
- `create`: Call `registry.createInterest()` with owner from deps, default engagement score 1.0. Return created interest as JSON.
- `update`: Require `id`. Call `registry.updateInterest()` with provided fields. Return updated interest or error if not found.
- `transition`: Require `id` and `status`. Call `registry.updateInterest(id, { status })`. Return updated interest or error if not found.
- Invalid action: Return `{ success: false, output: '', error: 'Unknown action: ...' }`.

**`manage_curiosity`** — Creates, updates, or transitions curiosity threads.

Parameters:
- `action` (string, required, enum: `['create', 'explore', 'resolve', 'park']`)
- `id` (string, not required) — required for explore/resolve/park
- `interest_id` (string, not required) — required for create
- `question` (string, not required) — required for create
- `resolution` (string, not required) — optional, for resolve

Handler logic:
- `create`: Require `interest_id` and `question`. First call `registry.findDuplicateCuriosityThread()` — if duplicate found, return the existing thread with a message indicating it was resumed. Otherwise call `registry.createCuriosityThread()` with owner from deps. Bump the parent interest engagement by 0.5 via `registry.bumpEngagement()`.
- `explore`: Require `id`. Call `registry.updateCuriosityThread(id, { status: 'exploring' })`. Bump parent interest engagement by 0.3.
- `resolve`: Require `id`. Call `registry.updateCuriosityThread(id, { status: 'resolved', resolution })`. Bump parent interest engagement by 1.0.
- `park`: Require `id`. Call `registry.updateCuriosityThread(id, { status: 'parked' })`.
- For explore/resolve/park: get the thread first to find the interestId for bumping.

**`list_interests`** — Lists interests with filters.

Parameters:
- `status` (string, not required, enum: `['active', 'dormant', 'abandoned']`)
- `source` (string, not required, enum: `['emergent', 'seeded', 'external']`)
- `min_score` (number, not required)

Handler: Call `registry.listInterests(owner, { status, source, minScore })`. Format as JSON array. Include count in output.

**`list_curiosities`** — Lists curiosity threads for an interest.

Parameters:
- `interest_id` (string, required)
- `status` (string, not required, enum: `['open', 'exploring', 'resolved', 'parked']`)

Handler: Call `registry.listCuriosityThreads(interestId, { status })`. Format as JSON array. Include count in output.

All handlers return `ToolResult` — never throw. Wrap each handler body in try/catch, returning `{ success: false, output: '', error: e.message }` on failure.

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors

**Commit:** `feat(subconscious): add interest management tool definitions`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Register subconscious tools in composition root

**Verifies:** None (infrastructure — verified operationally)

**Files:**
- Modify: `src/subconscious/index.ts` — export `createSubconsciousTools` re-export from `../tool/builtin/subconscious.ts` (or keep the tool import in index.ts only)
- Modify: `src/index.ts` — register subconscious tools

**Implementation:**

In `src/index.ts`, follow the same pattern as scheduling tools registration:

1. Import `createSubconsciousTools` from `./tool/builtin/subconscious.ts`
2. Import `createInterestRegistry` from `./subconscious/index.ts`
3. After persistence is connected and migrations are run, create the interest registry:
   ```typescript
   const interestRegistry = createInterestRegistry(persistence);
   ```
4. Create and register tools (near the scheduling tools registration):
   ```typescript
   const subconsciousTools = createSubconsciousTools({
     registry: interestRegistry,
     owner: config.agent.name,
   });
   for (const tool of subconsciousTools) {
     registry.register(tool);
   }
   ```

**Verification:**
Run: `bun run build`
Expected: Type-checks without errors

Run: `bun run start` (briefly — verify tools appear in tool list, then exit)
Expected: No startup errors, tools registered

**Commit:** `feat(subconscious): register interest tools in composition root`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->
<!-- START_TASK_3 -->
### Task 3: Interest management tool tests — manage_interest and list_interests

**Verifies:** subconscious.AC4.1, subconscious.AC4.3

**Files:**
- Create: `src/tool/builtin/subconscious.test.ts`

**Implementation:**

Follow the testing pattern from `src/tool/builtin/memory.test.ts`:
- Create a mock `InterestRegistry` that tracks calls and returns canned data
- Extract tools from the array returned by `createSubconsciousTools()`
- Call handlers directly

Create mock registry:
```typescript
function createMockInterestRegistry(): InterestRegistry & { calls: Array<{ method: string; args: Array<unknown> }> }
```
The mock should track method calls and return reasonable canned responses. For example, `createInterest` returns a full Interest object with the input fields plus generated id/dates.

**Testing:**

**subconscious.AC4.1:** manage_interest tool creates, updates, and transitions interests
- `describe('subconscious.AC4.1: manage_interest tool')`:
  - `it('creates an interest with name, description, and source')` — call handler with `{ action: 'create', name: 'test', description: 'desc', source: 'emergent' }`, verify success, verify mock `createInterest` was called with correct args
  - `it('updates an interest name and description')` — call with `{ action: 'update', id: 'int-1', name: 'new name' }`, verify mock `updateInterest` called
  - `it('transitions an interest to dormant')` — call with `{ action: 'transition', id: 'int-1', status: 'dormant' }`, verify mock `updateInterest` called with `{ status: 'dormant' }`
  - `it('returns error for update without id')` — call with `{ action: 'update', name: 'x' }`, verify `success: false`
  - `it('returns error for unknown action')` — call with `{ action: 'invalid' }`, verify `success: false`

**subconscious.AC4.3:** list_interests tool returns interests filtered by status, source, or minimum engagement score
- `describe('subconscious.AC4.3: list_interests tool')`:
  - `it('lists all interests for owner')` — call handler with no filters, verify mock `listInterests` called with owner
  - `it('filters by status')` — call with `{ status: 'active' }`, verify filter passed to mock
  - `it('filters by source')` — call with `{ source: 'seeded' }`, verify filter passed
  - `it('filters by minimum score')` — call with `{ min_score: 2.0 }`, verify filter passed

**Verification:**
Run: `bun test src/tool/builtin/subconscious.test.ts`
Expected: All tests pass

**Commit:** `test(subconscious): add manage_interest and list_interests tool tests`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Interest management tool tests — manage_curiosity and list_curiosities

**Verifies:** subconscious.AC4.2, subconscious.AC4.4

**Files:**
- Modify: `src/tool/builtin/subconscious.test.ts` (add new describe blocks)

**Testing:**

**subconscious.AC4.2:** manage_curiosity tool creates, explores, resolves, and parks curiosity threads
- `describe('subconscious.AC4.2: manage_curiosity tool')`:
  - `it('creates a new curiosity thread')` — call with `{ action: 'create', interest_id: 'int-1', question: 'Why?' }`, verify `findDuplicateCuriosityThread` called first, then `createCuriosityThread`, then `bumpEngagement`
  - `it('resumes existing duplicate thread instead of creating new')` — configure mock `findDuplicateCuriosityThread` to return an existing thread. Call create. Verify `createCuriosityThread` was NOT called. Verify output indicates thread was resumed.
  - `it('transitions thread to exploring')` — call with `{ action: 'explore', id: 'ct-1' }`, verify `updateCuriosityThread` called with `{ status: 'exploring' }`
  - `it('resolves thread with resolution text')` — call with `{ action: 'resolve', id: 'ct-1', resolution: 'Found the answer' }`, verify update called with status and resolution
  - `it('parks thread')` — call with `{ action: 'park', id: 'ct-1' }`, verify status update
  - `it('returns error for create without interest_id')` — verify `success: false`
  - `it('returns error for create without question')` — verify `success: false`

**subconscious.AC4.4:** list_curiosities tool returns curiosity threads for an interest, filtered by status
- `describe('subconscious.AC4.4: list_curiosities tool')`:
  - `it('lists all curiosity threads for an interest')` — call with `{ interest_id: 'int-1' }`, verify mock called
  - `it('filters by status')` — call with `{ interest_id: 'int-1', status: 'open' }`, verify filter passed

**Verification:**
Run: `bun test src/tool/builtin/subconscious.test.ts`
Expected: All tests pass

**Commit:** `test(subconscious): add manage_curiosity and list_curiosities tool tests`

<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->
