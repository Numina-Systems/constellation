# TUI Implementation Plan — Phase 1: Event Bus and Types

**Goal:** Typed event bus with publish/subscribe, all event types defined, unit tested.

**Architecture:** A pure pub/sub event bus using factory function pattern (`createAgentEventBus()`), with a discriminated union (`AgentEvent`) for all event types. The bus is fire-and-forget with no buffering or replay. Subscribers register for specific event types via a filter function.

**Tech Stack:** TypeScript, Bun

**Scope:** Phase 1 of 6 from original design

**Codebase verified:** 2026-04-04

---

## Acceptance Criteria Coverage

This phase implements and tests:

### tui.AC1: Event bus delivers typed events
- **tui.AC1.1 Success:** Publishing an event delivers it to all subscribers
- **tui.AC1.2 Success:** Subscribers only receive events matching their filter
- **tui.AC1.3 Success:** Unsubscribed listeners stop receiving events
- **tui.AC1.4 Edge:** Publishing with zero subscribers doesn't throw

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Create AgentEvent type and TUI types

**Verifies:** None (type-only, compiler verifies)

**Files:**
- Create: `src/tui/types.ts`

**Implementation:**

Create `src/tui/types.ts` with the `// pattern: Functional Core` annotation.

Define the `AgentEvent` discriminated union type using the `type` field as discriminant. Re-export `UsageStats` and `StopReason` from `@/model/types.ts`.

The `AgentEvent` union includes these variants:
- `stream:start` — with `model: string` and `turnIndex: number`
- `stream:chunk` — with `text: string` and `turnIndex: number`
- `stream:thinking` — with `text: string` and `turnIndex: number`
- `stream:end` — with `usage: UsageStats` and `stopReason: StopReason`
- `tool:start` — with `toolName: string`, `toolId: string`, `input: unknown`
- `tool:result` — with `toolId: string`, `result: string`, `isError: boolean`
- `turn:start` — with `source: 'user' | 'event' | 'scheduled'`
- `turn:end` — with `messageCount: number`
- `compaction:start` — no additional fields
- `compaction:end` — with `removedTokens: number`
- `activity:wake` — with `reason: string`
- `activity:sleep` — no additional fields
- `event:received` — with `source: string`, `summary: string`
- `error` — with `error: Error`, `context: string`
- `mutation:request` — with `mutationId: string`, `blockId: string`, `proposedContent: string`, `reason: string | null`
- `mutation:response` — with `mutationId: string`, `approved: boolean`, `feedback?: string`

Define the `AgentEventBus` type with three methods:
- `publish(event: AgentEvent): void`
- `subscribe(listener: AgentEventListener, filter?: AgentEventFilter): () => void` — returns an unsubscribe function
- `clear(): void` — removes all listeners

Define helper types:
- `AgentEventType = AgentEvent['type']` — string literal union of all event type values
- `AgentEventListener = (event: AgentEvent) => void`
- `AgentEventFilter = (event: AgentEvent) => boolean`

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(tui): add AgentEvent discriminated union and AgentEventBus type`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create event bus factory function

**Verifies:** tui.AC1.1, tui.AC1.2, tui.AC1.3, tui.AC1.4

**Files:**
- Create: `src/tui/event-bus.ts`

**Implementation:**

Create `src/tui/event-bus.ts` with `// pattern: Functional Core` annotation.

Implement `createAgentEventBus(): AgentEventBus` factory function.

The bus maintains a `Set` of `{ listener, filter }` subscription entries. Behaviour:
- `publish(event)` iterates all entries and calls `listener(event)` for each where `filter` is undefined or returns `true` for the event. Wrap each listener call in try/catch so one failing listener doesn't prevent delivery to others.
- `subscribe(listener, filter?)` adds an entry to the set and returns an unsubscribe function that removes it. Calling the unsubscribe function multiple times is a no-op (idempotent).
- `clear()` empties the set.

Import `AgentEvent`, `AgentEventBus`, `AgentEventListener`, `AgentEventFilter` from `./types.ts`.

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(tui): implement createAgentEventBus factory`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Event bus tests

**Verifies:** tui.AC1.1, tui.AC1.2, tui.AC1.3, tui.AC1.4

**Files:**
- Create: `src/tui/event-bus.test.ts`

**Testing:**

Tests must verify each AC listed above:

- **tui.AC1.1:** Publish an event with two subscribers. Both receive the event with correct payload.
- **tui.AC1.2:** Subscribe with a filter that only accepts `stream:chunk` events. Publish `stream:chunk` and `tool:start` events. Subscriber receives only the `stream:chunk` event.
- **tui.AC1.3:** Subscribe, then call the returned unsubscribe function. Publish an event. The unsubscribed listener does not receive it.
- **tui.AC1.4:** Create a bus with no subscribers. Publish an event. No error thrown.

Additional edge cases to test:
- Calling unsubscribe twice is a no-op (idempotent)
- A failing listener (throws) does not prevent other listeners from receiving the event
- `clear()` removes all listeners — subsequent publish delivers to no one

Use `describe`/`it` from `bun:test`. Pattern annotation: `// pattern: Functional Core`.

Follow project testing patterns: co-located test file, manual test data construction (no mocking library), factory helpers if needed for creating test events.

**Verification:**
Run: `bun test src/tui/event-bus.test.ts`
Expected: All tests pass

**Commit:** `test(tui): add event bus unit tests`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_4 -->
### Task 4: Create barrel export

**Verifies:** None (infrastructure)

**Files:**
- Create: `src/tui/index.ts`

**Implementation:**

Create `src/tui/index.ts` with `// pattern: Functional Core` annotation.

Re-export the public API:
- `export type { AgentEvent, AgentEventBus, AgentEventType, AgentEventListener, AgentEventFilter }` from `./types.ts`
- `export { createAgentEventBus }` from `./event-bus.ts`

Follow the exact pattern from `src/agent/index.ts` — types via `export type`, factories via `export`.

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

Run: `bun test src/tui/`
Expected: All tests pass

**Commit:** `feat(tui): add barrel export for tui module`
<!-- END_TASK_4 -->
