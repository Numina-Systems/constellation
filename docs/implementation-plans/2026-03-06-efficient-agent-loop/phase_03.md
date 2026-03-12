# Efficient Agent Loop Implementation Plan — Phase 3: DataSource Registry

**Goal:** Extract per-source wiring into a reusable registration pattern and replace hardcoded source instructions with a lookup.

**Architecture:** Introduce `DataSourceRegistration` and `DataSourceRegistry` types in `src/extensions/data-source.ts`. Create a `createDataSourceRegistry()` factory in `src/extensions/data-source-registry.ts` that accepts registrations, wires `onMessage` handlers to a shared event queue, optionally wraps them with the generic activity interceptor (from Phase 2), and provides unified shutdown. Replace the hardcoded `if (event.source === 'bluesky')` instruction block in `formatExternalEvent` with a source-keyed lookup injected via `AgentDependencies`.

**Tech Stack:** Bun (TypeScript)

**Scope:** 4 phases from original design (phase 3 of 4)

**Codebase verified:** 2026-03-06

---

## Acceptance Criteria Coverage

This phase implements and tests:

### efficient-agent-loop.AC2: Unified agent context (partial)
- **efficient-agent-loop.AC2.3 Success:** DataSource registration wires `onMessage` handlers to a shared event queue that feeds the single agent
- **efficient-agent-loop.AC2.4 Success:** Per-source instructions are injected into `formatExternalEvent` via lookup rather than hardcoded conditionals
- **efficient-agent-loop.AC2.5 Success:** Registry `shutdown()` disconnects all registered DataSources

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Add registry types to `data-source.ts`

**Verifies:** None (infrastructure — type definitions)

**Files:**
- Modify: `src/extensions/data-source.ts` (append new types)

**Implementation:**

Append these types after the existing `DataSource` interface at the end of `src/extensions/data-source.ts`:

```typescript
export type DataSourceRegistration = {
  readonly source: DataSource;
  readonly instructions?: string;
  readonly highPriorityFilter?: (message: IncomingMessage) => boolean;
};

export type DataSourceRegistry = {
  readonly sources: ReadonlyArray<DataSource>;
  shutdown(): Promise<void>;
};
```

These match the contracts specified in the design plan. `DataSourceRegistration` bundles a DataSource with its per-source instructions and optional high-priority filter. `DataSourceRegistry` provides access to registered sources and a unified shutdown.

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(extensions): add DataSourceRegistration and DataSourceRegistry types`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Update barrel export for new types

**Verifies:** None (infrastructure — export wiring)

**Files:**
- None — `src/extensions/index.ts` does not exist (verified). The extensions module has no barrel file; all imports use direct paths (e.g., `import type { DataSource } from '../extensions/data-source.ts'`).

**Implementation:**

No action needed. The new types added in Task 1 are already accessible via direct import from `src/extensions/data-source.ts`, which is the existing pattern used throughout the codebase. This task exists only to document that no barrel update is required.

**Verification:**

Run: `bun run build`
Expected: Type-check passes (no change from Task 1)

**Commit:** (no separate commit — combined with Task 1)

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->
<!-- START_TASK_3 -->
### Task 3: Create `createDataSourceRegistry` factory

**Verifies:** efficient-agent-loop.AC2.3, efficient-agent-loop.AC2.5

**Files:**
- Create: `src/extensions/data-source-registry.ts`

**Implementation:**

Create the registry factory that wires DataSource `onMessage` handlers to a shared event queue, optionally wraps them with the activity interceptor, and provides unified shutdown.

```typescript
// pattern: Imperative Shell

import type { IncomingMessage, DataSource, DataSourceRegistration, DataSourceRegistry } from './data-source.ts';
import type { ActivityManager } from '../activity/types.ts';
import { createActivityInterceptor } from '../activity/activity-interceptor.ts';

type EventSink = {
  push(event: IncomingMessage): void;
};

type ProcessFn = () => Promise<void>;

type RegistryOptions = {
  readonly registrations: ReadonlyArray<DataSourceRegistration>;
  readonly eventSink: EventSink;
  readonly processEvents: ProcessFn;
  readonly activityManager?: ActivityManager;
};

export function createDataSourceRegistry(
  options: Readonly<RegistryOptions>,
): DataSourceRegistry {
  const { registrations, eventSink, processEvents, activityManager } = options;
  const sources: Array<DataSource> = [];

  for (const registration of registrations) {
    const { source, highPriorityFilter } = registration;
    sources.push(source);

    const baseHandler = (message: IncomingMessage): void => {
      eventSink.push(message);
      processEvents().catch((error) => {
        console.error(`[registry] ${source.name} event processing error:`, error);
      });
    };

    if (activityManager) {
      source.onMessage(createActivityInterceptor({
        activityManager,
        originalHandler: baseHandler,
        sourcePrefix: source.name,
        highPriorityFilter,
      }));
    } else {
      source.onMessage(baseHandler);
    }
  }

  async function shutdown(): Promise<void> {
    const disconnects = sources.map(async (source) => {
      try {
        await source.disconnect();
        console.log(`[registry] disconnected ${source.name}`);
      } catch (error) {
        console.error(`[registry] error disconnecting ${source.name}:`, error);
      }
    });
    await Promise.allSettled(disconnects);
  }

  return {
    sources,
    shutdown,
  };
}
```

Key design decisions:
- **Signature deviation from design:** The design plan specifies `createDataSourceRegistry(registrations, agent, activityManager?)` with positional args and an `Agent` parameter. This implementation uses an options object with `eventSink`/`processEvents` instead, which decouples the registry from the `Agent` type entirely. The registry only needs to push events and trigger processing — it doesn't need to know about the agent's full interface. This improves testability (tests can provide a simple array + no-op function instead of a full mock agent) and follows the project's existing options-object pattern for factory functions with 3+ parameters.
- `EventSink` and `ProcessFn` are minimal types accepting the event queue's `push` and the `processNextEvent` function from the composition root. This avoids coupling the registry to the specific queue implementation.
- Each registration's `onMessage` is wired with either the activity interceptor wrapper (if `activityManager` provided) or a plain handler.
- `shutdown()` uses `Promise.allSettled` to disconnect all sources even if some fail.
- Error handling on disconnect follows the existing pattern: log and continue.

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(extensions): create DataSource registry factory with event routing and shutdown`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Add per-source instruction lookup to `formatExternalEvent`

**Verifies:** efficient-agent-loop.AC2.4

**Files:**
- Modify: `src/agent/types.ts:48-61` (add `sourceInstructions` to `AgentDependencies`)
- Modify: `src/agent/agent.ts:22-51` (`formatExternalEvent` function)
- Modify: `src/agent/agent.ts:292-295` (`processEvent` to pass instructions map)

**Implementation:**

**Step 1: Add `sourceInstructions` to `AgentDependencies` in `src/agent/types.ts`:**

Add this field to the `AgentDependencies` type:

```typescript
sourceInstructions?: ReadonlyMap<string, string>;
```

**Step 2: Update `formatExternalEvent` in `src/agent/agent.ts` to accept a source instructions map:**

Change the function signature and replace the hardcoded conditional:

```typescript
function formatExternalEvent(
  event: ExternalEvent,
  sourceInstructions?: ReadonlyMap<string, string>,
): string {
  const header = `[External Event: ${event.source}]`;
  const from = event.metadata['handle'] ? `From: @${event.metadata['handle']} (${event.metadata['did']})` : '';
  const post = event.metadata['uri'] ? `Post: ${event.metadata['uri']}` : '';
  const cid = event.metadata['cid'] ? `CID: ${event.metadata['cid']}` : '';
  const time = `Time: ${event.timestamp.toISOString()}`;

  const parts = [header, from, post, cid, time];

  const replyTo = event.metadata['reply_to'] as
    | { parent_uri: string; parent_cid: string; root_uri: string; root_cid: string }
    | undefined;
  if (replyTo) {
    parts.push(`Parent URI: ${replyTo.parent_uri}`);
    parts.push(`Parent CID: ${replyTo.parent_cid}`);
    parts.push(`Root URI: ${replyTo.root_uri}`);
    parts.push(`Root CID: ${replyTo.root_cid}`);
  }

  parts.push('', event.content);

  const instructions = sourceInstructions?.get(event.source);
  if (instructions) {
    parts.push('');
    parts.push(`[Instructions: ${instructions}]`);
  }

  return parts.filter(Boolean).join('\n');
}
```

**Step 3: Update `processEvent` in `src/agent/agent.ts` to pass the instructions map:**

Inside `createAgent`, the `processEvent` function (around line 292) should pass `deps.sourceInstructions`:

```typescript
async function processEvent(event: ExternalEvent): Promise<string> {
  const formattedMessage = formatExternalEvent(event, deps.sourceInstructions);
  return processMessage(formattedMessage);
}
```

**Step 4: Wire `sourceInstructions` in the composition root (`src/index.ts`) to preserve bluesky instructions**

To avoid a functional gap between Phase 3 and Phase 4, immediately wire the bluesky instructions via the new map in `src/index.ts`. Before the `createAgent` call, build the map:

```typescript
const sourceInstructions = new Map<string, string>();
if (config.bluesky?.enabled) {
  sourceInstructions.set('bluesky', 'To respond to this post, use memory_read to find your bluesky templates (e.g. "bluesky reply" or "bluesky post"), then use execute_code with the template. Bluesky credentials (BSKY_SERVICE, BSKY_ACCESS_TOKEN, BSKY_REFRESH_TOKEN, BSKY_DID, BSKY_HANDLE) are automatically available in your sandbox. Replace placeholder text with your actual response.');
}
```

Pass it to `createAgent`:
```typescript
sourceInstructions: sourceInstructions.size > 0 ? sourceInstructions : undefined,
```

This ensures the bluesky instructions are never missing between phases. In Phase 4, this map construction moves to be derived from the `DataSourceRegistration.instructions` field instead of being hardcoded.

Key details:
- The `sourceInstructions` map is keyed by source name (e.g., `'bluesky'`). When `formatExternalEvent` receives an event with `source === 'bluesky'`, it looks up the instructions from the map.
- When `sourceInstructions` is undefined or doesn't contain the source, no instructions are appended — same as current behaviour for non-bluesky sources.
- The hardcoded instruction text is the exact string currently at `src/agent/agent.ts:47`, without the `[Instructions: ...]` wrapper (that's added by `formatExternalEvent`).

**Verification:**

Run: `bun run build`
Expected: Type-check passes

Run: `bun test src/index.wiring.test.ts`
Expected: All existing tests pass — bluesky instruction assertions still hold because the map is wired with the same text

**Commit:** `refactor(agent): replace hardcoded source instructions with lookup map`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Tests for registry and instruction lookup

**Verifies:** efficient-agent-loop.AC2.3, efficient-agent-loop.AC2.4, efficient-agent-loop.AC2.5

**Files:**
- Create: `src/extensions/data-source-registry.test.ts`
- Modify: `src/index.wiring.test.ts` (update `formatExternalEvent`/`buildReviewEvent` tests if instructions change)

**Testing:**

Tests must verify each AC listed above:

- **efficient-agent-loop.AC2.3:** Registry wires onMessage handlers to a shared event sink. Create mock DataSources, register them, emit messages, verify they arrive in the event sink.
- **efficient-agent-loop.AC2.4:** Per-source instructions are injected via lookup. Test `formatExternalEvent` with a source instructions map — verify instructions appear for matching sources and are absent for unregistered sources.
- **efficient-agent-loop.AC2.5:** Registry shutdown disconnects all DataSources. Register multiple sources, call shutdown, verify disconnect was called on each.

Registry tests (`src/extensions/data-source-registry.test.ts`):

```
describe('createDataSourceRegistry (efficient-agent-loop.AC2)', () => {
  describe('efficient-agent-loop.AC2.3: event routing', () => {
    // messages from registered DataSource arrive in event sink
    // multiple DataSources all route to same sink
    // processEvents is called after push
  });

  describe('efficient-agent-loop.AC2.5: unified shutdown', () => {
    // shutdown disconnects all registered sources
    // shutdown continues even if one source fails to disconnect
    // shutdown logs errors for failed disconnects
  });

  describe('activity interceptor wrapping', () => {
    // with activityManager: handler wrapped with createActivityInterceptor
    // without activityManager: handler called directly
  });
});
```

Use mock DataSources: plain objects implementing `DataSource` interface with `onMessage` that stores the handler, `connect/disconnect` as mock functions, and `name` string.

For the `formatExternalEvent` instruction lookup tests — these should be added to the existing `src/index.wiring.test.ts` or a new test alongside agent tests. Since `formatExternalEvent` is a module-level function in agent.ts (not exported), test it through `agent.processEvent` or through `buildReviewEvent` which also exercises event formatting. Alternatively, if `formatExternalEvent` gets exported for testability, test it directly.

Note: The existing tests in `src/index.wiring.test.ts` do not reference bluesky instruction text — they test `buildReviewEvent`, `buildAgentScheduledEvent`, `processEventQueue`, and the shutdown handler, none of which involve `formatExternalEvent` or source instructions. Removing the hardcoded `if (event.source === 'bluesky')` conditional from `formatExternalEvent` will not break any existing tests. The `formatExternalEvent` instruction lookup is tested indirectly through the AC2.4 tests in this task (registry test file) and can also be tested through `agent.processEvent` if `formatExternalEvent` is not exported.

**Verification:**

Run: `bun test src/extensions/data-source-registry.test.ts`
Run: `bun test src/index.wiring.test.ts`
Expected: All tests pass

**Commit:** `test(extensions): add registry and instruction lookup tests (AC2.3, AC2.4, AC2.5)`

<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_B -->
