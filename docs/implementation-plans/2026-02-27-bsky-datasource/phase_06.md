# Bluesky DataSource Implementation Plan — Phase 6: Composition Root Wiring & Error Handling

**Goal:** Wire the Bluesky DataSource into the composition root so the full pipeline works end-to-end: Jetstream event → DataSource filter → agent.processEvent() → sandbox code → Bluesky API. Add backpressure queue, graceful startup/shutdown, and error logging.

**Architecture:** The composition root (`src/index.ts`) conditionally creates and connects the BlueskyDataSource when `config.bluesky.enabled` is true. A dedicated Bluesky agent instance is created with a deterministic conversation ID (separate from the REPL agent) and a `getExecutionContext` getter function that reads fresh tokens from the DataSource at execution time. Events flow through an in-memory backpressure queue (capped at 50, drops oldest) before reaching the agent. The DataSource connects asynchronously after the REPL starts — Jetstream failure does not block the REPL. Shutdown disconnects the DataSource cleanly.

**Tech Stack:** Bun test

**Scope:** 6 phases from original design (phase 6 of 6)

**Codebase verified:** 2026-02-28

---

## Acceptance Criteria Coverage

This phase implements and tests:

### bsky-datasource.AC6: Wiring & Error Handling
- **bsky-datasource.AC6.1 Success:** Full pipeline: Jetstream event → DataSource filter → processEvent → agent response
- **bsky-datasource.AC6.2 Success:** Backpressure queue caps at 50 events, drops oldest when full
- **bsky-datasource.AC6.3 Edge:** REPL starts normally even if Jetstream is unreachable
- **bsky-datasource.AC6.4 Success:** DataSource disconnects cleanly on daemon shutdown
- **bsky-datasource.AC6.5 Failure:** processEvent errors are logged but do not crash the Jetstream listener

---

<!-- START_TASK_1 -->
### Task 1: Create backpressure event queue

**Verifies:** bsky-datasource.AC6.2

**Files:**
- Create: `src/extensions/bluesky/event-queue.ts`

**Implementation:**

Create a simple bounded queue as a stateful data structure. This is `// pattern: Imperative Shell` — it encapsulates mutable state (the internal buffer) behind a clean interface.

```typescript
// pattern: Imperative Shell

import type { IncomingMessage } from "../data-source.ts";

export type EventQueue = {
  push(event: IncomingMessage): void;
  shift(): IncomingMessage | null;
  readonly length: number;
  readonly capacity: number;
};

export function createEventQueue(capacity: number): EventQueue {
  const buffer: Array<IncomingMessage> = [];

  return {
    push(event: IncomingMessage): void {
      if (buffer.length >= capacity) {
        buffer.shift(); // drop oldest
      }
      buffer.push(event);
    },
    shift(): IncomingMessage | null {
      return buffer.shift() ?? null;
    },
    get length(): number {
      return buffer.length;
    },
    get capacity(): number {
      return capacity;
    },
  };
}
```

Export from `src/extensions/bluesky/index.ts` barrel.

**Testing:**

Tests must verify:
- bsky-datasource.AC6.2: Push 51 events into a queue with capacity 50, verify length is 50 and the first event pushed is gone (oldest dropped)
- Push/shift ordering is FIFO
- shift() returns null on empty queue

Test file: `src/extensions/bluesky/event-queue.test.ts` (new file, unit test)

**Verification:**
Run: `bun test src/extensions/bluesky/event-queue.test.ts`
Expected: All tests pass

**Commit:** `feat(bluesky): add bounded event queue with backpressure`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Wire Bluesky DataSource into composition root

**Verifies:** bsky-datasource.AC6.1, bsky-datasource.AC6.3, bsky-datasource.AC6.4, bsky-datasource.AC6.5

**Files:**
- Modify: `src/index.ts`
- Modify: `config.toml.example`

**Implementation:**

This task modifies the composition root to conditionally set up the full Bluesky pipeline, and updates the example config to include Bluesky hosts. Changes are in several locations:

**1. Add imports (top of file, after existing imports):**
```typescript
import { createBlueskySource, seedBlueskyTemplates, createEventQueue } from '@/extensions/bluesky';
import type { BlueskyDataSource } from '@/extensions/bluesky';
import type { ExecutionContext } from '@/runtime/types';
import type { IncomingMessage } from '@/extensions/data-source';
```

Note: `ExecutionContext` is imported for the `getExecutionContext` getter's return type annotation.

**2. After the `seedCoreMemory` call, add conditional Bluesky template seeding:**
```typescript
if (config.bluesky?.enabled) {
  await seedBlueskyTemplates(memoryStore, embedding);
}
```

**3. After REPL agent creation, add Bluesky agent and DataSource setup:**

Create a dedicated Bluesky agent with:
- Deterministic conversation ID: `"bluesky-" + config.bluesky.did` (persists across restarts, AC2.4)
- A `getExecutionContext` getter closure that reads fresh tokens from the DataSource at execution time

The Bluesky agent shares the same `AgentDependencies` (model, memory, registry, persistence) as the REPL agent but has its own conversation and a `getExecutionContext` getter for credential injection.

```typescript
let blueskySource: BlueskyDataSource | null = null;

if (config.bluesky?.enabled) {
  try {
    blueskySource = createBlueskySource(config.bluesky);
    await blueskySource.connect();

    // Create dedicated Bluesky agent with deterministic conversation ID
    const blueskyConversationId = `bluesky-${config.bluesky.did}`;

    // Getter reads fresh tokens from the DataSource at execution time,
    // so auto-refreshed credentials are always current
    const src = blueskySource; // capture for closure (blueskySource may be nulled on error)
    const getExecutionContext = (): ExecutionContext => ({
      bluesky: {
        service: "https://bsky.social",
        accessToken: src.getAccessToken(),
        refreshToken: src.getRefreshToken(),
        did: config.bluesky.did,
        handle: config.bluesky.handle,
      },
    });

    const blueskyAgent = createAgent({
      model,
      memory,
      registry,
      runtime,
      persistence,
      config: {
        max_tool_rounds: config.agent.max_tool_rounds,
        context_budget: config.agent.context_budget,
        model_max_tokens: DEFAULT_MODEL_MAX_TOKENS,
        model_name: config.model.name,
      },
      getExecutionContext,
    }, blueskyConversationId);

    // Set up event queue and processing loop
    const eventQueue = createEventQueue(50);
    let processing = false;

    async function processNextEvent(): Promise<void> {
      if (processing) return;
      processing = true;

      try {
        let event = eventQueue.shift();
        while (event) {
          try {
            await blueskyAgent.processEvent(event);
          } catch (error) {
            // AC6.5: Log error but don't crash
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`bluesky processEvent error: ${errorMsg}`);
          }
          event = eventQueue.shift();
        }
      } finally {
        processing = false;
      }
    }

    blueskySource.onMessage((message: IncomingMessage) => {
      eventQueue.push(message);
      processNextEvent().catch((error) => {
        console.error('bluesky event processing error:', error);
      });
    });

    console.log(`bluesky datasource connected (watching ${config.bluesky.watched_dids.length} DIDs)`);
  } catch (error) {
    // AC6.3: Jetstream failure doesn't block REPL
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`bluesky datasource failed to connect: ${errorMsg}`);
    console.error('continuing without bluesky integration');
    blueskySource = null;
  }
}
```

**4. Update shutdown handler to disconnect DataSource (AC6.4):**

Modify `performShutdown` or create a wrapper that also disconnects the Bluesky DataSource. The simplest approach: update the `shutdownHandler` creation to include the DataSource:

```typescript
const shutdownHandler = async (): Promise<void> => {
  console.log('\nShutting down...');
  if (blueskySource) {
    try {
      await blueskySource.disconnect();
      console.log('bluesky datasource disconnected');
    } catch (error) {
      console.error('error disconnecting bluesky:', error);
    }
  }
  rl.close();
  await persistence.disconnect();
  process.exit(0);
};
```

**5. Update config.toml.example** to add Bluesky hosts to `allowed_hosts`:

The Deno sandbox needs network access to `bsky.social` for the agent to make Bluesky API calls. Add to the `[runtime]` section:

```toml
allowed_hosts = ["api.anthropic.com", "api.moonshot.ai", "bsky.social"]
```

Note: The Jetstream connection is made by the host process (not the sandbox), so Jetstream hosts don't need to be in `allowed_hosts`.

**Testing:**

The composition root wiring is integration-level code. Key behaviours are tested through the individual components (DataSource, event queue, agent processEvent). However, a focused test for the event processing loop would be valuable.

Tests must verify:
- bsky-datasource.AC6.2: Already tested in Task 1 (event-queue.test.ts)
- bsky-datasource.AC6.5: Create a mock agent whose processEvent throws, push events through the queue processor, verify errors are caught and subsequent events still process

Test file: `src/index.test.ts` (existing file — add new describe block if feasible, or verify through existing patterns)

The existing `src/index.test.ts` already tests `performShutdown`, `createShutdownHandler`, `processPendingMutations`, and `createInteractionLoop`. Add a test for the event processing error handling pattern if it's extracted as a testable function.

**Verification:**
Run: `bun test`
Expected: All tests pass

**Commit:** `feat(bluesky): wire DataSource into composition root with backpressure and error handling`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Run full test suite and type-check

**Verifies:** None (final verification gate)

**Files:** None (read-only)

**Verification:**
Run: `bun test`
Expected: All tests pass (116 original + all new tests from phases 1-6). Pre-existing PostgreSQL integration failures expected.

Run: `bun run build`
Expected: Type-check passes with zero errors.

**Commit:** No commit (verification only)
<!-- END_TASK_3 -->
