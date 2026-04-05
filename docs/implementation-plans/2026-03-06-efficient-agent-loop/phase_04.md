# Efficient Agent Loop Implementation Plan — Phase 4: Consolidate to Single Agent

**Goal:** Eliminate the bluesky agent instance and route all events through the main agent via the DataSource registry.

**Architecture:** Remove the separate `blueskyAgent` creation, `blueskyConversationId`, `blueskyContextProviders`, and the per-source event queue/processing loop. Replace with registry-based wiring that routes bluesky events through a shared external event queue feeding the main agent. Move the bluesky instruction text from the now-removed `formatExternalEvent` hardcoded conditional into the `DataSourceRegistration.instructions` field. Update the shutdown handler to use `registry.shutdown()` instead of directly calling `blueskySource.disconnect()`.

**Tech Stack:** Bun (TypeScript)

**Scope:** 4 phases from original design (phase 4 of 4)

**Codebase verified:** 2026-03-06

---

## Acceptance Criteria Coverage

This phase implements and tests:

### efficient-agent-loop.AC2: Unified agent context
- **efficient-agent-loop.AC2.1 Success:** A single agent instance processes REPL input, scheduler events, and bluesky firehose events in one conversation
- **efficient-agent-loop.AC2.2 Success:** No second agent instance (`blueskyAgent`) exists at runtime

### efficient-agent-loop.AC4: No functional regression
- **efficient-agent-loop.AC4.1 Success:** Bluesky posts are received and processed by the agent (posting, replying, liking via templates)
- **efficient-agent-loop.AC4.2 Success:** Prediction journaling works — `predict`, `annotate_prediction`, `list_predictions` tools function correctly
- **efficient-agent-loop.AC4.3 Success:** Sleep tasks (compaction, prediction review, pattern analysis) fire on their circadian schedule unchanged

---

<!-- START_TASK_1 -->
### Task 1: Wire bluesky through registry, remove blueskyAgent

**Verifies:** efficient-agent-loop.AC2.1, efficient-agent-loop.AC2.2, efficient-agent-loop.AC4.1

**Files:**
- Modify: `src/index.ts` (major refactor of lines ~741-815, ~1050)

**Implementation:**

This is the core consolidation task. Replace ~70 lines of bluesky-specific agent creation and event wiring with registry-based setup feeding the main agent.

**Step 1: Create shared external event queue and processing loop (replacing bluesky-specific one)**

After the main agent creation (~line 739), add the shared external event queue:

```typescript
// Shared external event queue for all DataSource events
const externalEventQueue = createEventQueue(50);
let externalProcessing = false;

async function processExternalEvent(): Promise<void> {
  if (externalProcessing) return;
  externalProcessing = true;
  try {
    await processEventQueue(externalEventQueue, agent, 'external');
  } finally {
    externalProcessing = false;
  }
}
```

This replaces the bluesky-specific `eventQueue` (old line 770) and `processNextEvent` (old lines 773-786). The key difference: it feeds the main `agent`, not `blueskyAgent`.

**Step 2: Build bluesky DataSource registration and create registry**

```typescript
// DataSource registry: wire all external sources through shared queue
const registrations: Array<DataSourceRegistration> = [];

if (blueskyConnected && blueskySource) {
  const highPriorityDids = new Set(config.bluesky.schedule_dids);

  registrations.push({
    source: blueskySource,
    instructions: 'To respond to this post, use memory_read to find your bluesky templates (e.g. "bluesky reply" or "bluesky post"), then use execute_code with the template. Bluesky credentials (BSKY_SERVICE, BSKY_ACCESS_TOKEN, BSKY_REFRESH_TOKEN, BSKY_DID, BSKY_HANDLE) are automatically available in your sandbox. Replace placeholder text with your actual response.',
    highPriorityFilter: highPriorityDids.size > 0
      ? (message) => {
          const authorDid = message.metadata['authorDid'] as string | undefined;
          return authorDid !== undefined && highPriorityDids.has(authorDid);
        }
      : undefined,
  });
}

const registry = createDataSourceRegistry({
  registrations,
  eventSink: externalEventQueue,
  processEvents: processExternalEvent,
  activityManager: activityManager ?? undefined,
});
```

Note: The `instructions` text is the exact string currently hardcoded at `src/agent/agent.ts:47`, just without the `[Instructions: ...]` wrapper (that's added by `formatExternalEvent`).

**Step 3: Pass source instructions map to main agent**

Build the `sourceInstructions` map from registrations and pass it to `createAgent`:

```typescript
// Build source instructions map for agent's formatExternalEvent
const sourceInstructions = new Map<string, string>();
for (const reg of registrations) {
  if (reg.instructions) {
    sourceInstructions.set(reg.source.name, reg.instructions);
  }
}
```

Add `sourceInstructions` to the main agent's `createAgent` call:

```typescript
const agent = createAgent({
  // ... existing deps ...
  sourceInstructions: sourceInstructions.size > 0 ? sourceInstructions : undefined,
}, mainConversationId);
```

**Critical ordering constraint:** The current `createAgent` call is at line ~726, before all bluesky setup (lines ~741+). This ordering must change. The registrations array and `sourceInstructions` map must be constructed *before* `createAgent` is called, because the agent needs `sourceInstructions` at creation time. The registry itself must be created *after* the agent, because its event handlers reference the agent's event queue and process function. The implementor must restructure the composition root to follow this order:

1. Build registrations array (with instructions) — move bluesky registration logic before `createAgent`
2. Build `sourceInstructions` map from registrations
3. Create agent (with `sourceInstructions`) — existing line ~726, but now with `sourceInstructions`
4. Create shared event queue and `processExternalEvent` function
5. Create registry (with event queue and process function) — wires `onMessage` handlers

This replaces the Phase 3 interim wiring (which hardcodes the bluesky instructions map before `createAgent`). In Phase 4, the map is derived from registrations instead.

**Step 4: Remove deleted code blocks**

Delete these blocks from `src/index.ts`:
- `blueskyConversationId` (line 744)
- `blueskyContextProviders` (line 746)
- `blueskyAgent = createAgent(...)` (lines 748-767)
- Bluesky-specific `eventQueue` and `processNextEvent` (lines 769-786)
- Direct `blueskySource.onMessage(...)` handler (lines 788-797)
- `createBlueskyInterceptor(...)` call (lines 801-812)

**Step 5: Update shutdown handler**

Update `createShutdownHandler` to accept the registry instead of `blueskySource`:

```typescript
// In createShutdownHandler signature, replace blueskySource with registry:
export function createShutdownHandler(
  rl: readline.Interface,
  persistence: PersistenceProvider,
  dataSourceRegistry?: DataSourceRegistry | null,
  scheduler?: { stop(): void } | null,
  activityManager?: ActivityManager | null,
): () => Promise<void> {
```

Inside the handler, replace the `blueskySource.disconnect()` block with:

```typescript
if (dataSourceRegistry) {
  await dataSourceRegistry.shutdown();
  console.log('data sources disconnected');
}
```

Update the call site (~line 1050):
```typescript
const shutdownHandler = createShutdownHandler(rl, persistence, registry, schedulerWrapper, activityManager);
```

**Step 6: Update imports**

At the top of `src/index.ts`:
- Add: `import { createDataSourceRegistry } from '@/extensions/data-source-registry';`
- Add: `import type { DataSourceRegistration, DataSourceRegistry } from '@/extensions/data-source';`
- Remove: `import { createBlueskyInterceptor } from '@/activity';` (if no longer used)

Note: `createActivityInterceptor` is NOT imported in `src/index.ts` — it's used internally by `createDataSourceRegistry`.

**Verification:**

Run: `bun run build`
Expected: Type-check passes

Run: `bun test`
Expected: All tests pass (some existing tests may need updating — see Task 2)

**Commit:** `refactor(index): consolidate to single agent via DataSource registry`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Update existing tests for consolidated architecture

**Verifies:** efficient-agent-loop.AC2.1, efficient-agent-loop.AC2.2, efficient-agent-loop.AC4.2, efficient-agent-loop.AC4.3

**Files:**
- Modify: `src/index.wiring.test.ts` (update shutdown handler tests, instruction tests)

**Testing:**

Tests must verify each AC listed above:

- **efficient-agent-loop.AC2.1:** Single agent processes all event types — verify `processEventQueue` is called with main agent for external events (already verified for scheduler events by existing tests).
- **efficient-agent-loop.AC2.2:** No second agent instance — verify `blueskyAgent` doesn't appear in the composition root (structural test: search for `blueskyAgent` in the file should return zero results).
- **efficient-agent-loop.AC4.1:** Bluesky posts are received and processed — this AC is verified by the *combination* of: (a) Phase 3 registry tests proving `onMessage` handlers route events to the event sink (AC2.3), (b) Phase 2 interceptor tests proving the activity interceptor correctly wraps handlers (AC3.1, AC3.2), and (c) existing Bluesky source tests in `src/extensions/bluesky/` proving the source emits `IncomingMessage` events. No new dedicated AC4.1 test is needed — the end-to-end flow is covered by these layered unit and composition tests. If the implementor wants additional confidence, a composition test wiring a mock DataSource → registry → mock agent can be added, but is not required.
- **efficient-agent-loop.AC4.2:** Prediction journaling works — existing tests in `src/reflexion/` cover this. No changes needed to those tests.
- **efficient-agent-loop.AC4.3:** Sleep tasks unchanged — existing tests in `src/activity/dispatch.test.ts` and `src/activity/bluesky-interceptor.test.ts` cover this. No changes needed (note: `bluesky-interceptor.test.ts` is removed in Task 3 of this phase, but its coverage is replaced by `activity-interceptor.test.ts` from Phase 2).

Specific test updates needed:

1. **Shutdown handler tests** — Update `createShutdownHandler` tests to pass a `DataSourceRegistry` mock instead of `blueskySource`:

```
describe('shutdown handler with DataSource registry', () => {
  // calls registry.shutdown() during shutdown
  // accepts null registry parameter
  // handles registry.shutdown() errors gracefully
});
```

2. **Source instructions tests** — Update or add tests verifying that `buildReviewEvent` and `buildAgentScheduledEvent` work correctly when `sourceInstructions` is provided to the agent. Since `formatExternalEvent` is internal to agent.ts, test through the public `agent.processEvent` API or verify through existing event format tests.

3. **Structural verification** — Add a test or assertion that the composition root does not create a `blueskyAgent` variable. This can be a simple grep-based verification in the test or documented as a manual check.

Follow project testing patterns: `bun:test` imports, `describe`/`it` blocks, AC references in describe block names.

**Verification:**

Run: `bun test src/index.wiring.test.ts`
Expected: All tests pass

Run: `bun test`
Expected: Full test suite passes

**Commit:** `test(index): update wiring tests for consolidated single-agent architecture (AC2.1, AC2.2, AC4.2, AC4.3)`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Remove deprecated bluesky interceptor

**Verifies:** None (cleanup)

**Files:**
- Delete: `src/activity/bluesky-interceptor.ts`
- Delete: `src/activity/bluesky-interceptor.test.ts`
- Modify: `src/activity/index.ts` (remove bluesky-interceptor exports)

**Implementation:**

Now that the composition root uses `createActivityInterceptor` (via the registry), the old `createBlueskyInterceptor` and its tests can be removed.

Remove these lines from `src/activity/index.ts`:
```typescript
export { createBlueskyInterceptor } from './bluesky-interceptor.ts';
export type { BlueskyInterceptorOptions } from './bluesky-interceptor.ts';
```

Delete the files:
- `src/activity/bluesky-interceptor.ts`
- `src/activity/bluesky-interceptor.test.ts`

**Verification:**

Run: `bun run build`
Expected: Type-check passes (no remaining references to `createBlueskyInterceptor`)

Run: `bun test`
Expected: All tests pass

**Commit:** `refactor(activity): remove deprecated bluesky-specific interceptor`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Update CLAUDE.md files for changed architecture

**Verifies:** None (documentation)

**Files:**
- Modify: `src/activity/CLAUDE.md` (remove bluesky-interceptor references, add activity-interceptor)
- Modify: `src/extensions/CLAUDE.md` (add DataSource registry documentation)
- Modify: `src/agent/CLAUDE.md` (add `sourceInstructions` to AgentDependencies documentation)

**Implementation:**

Update the CLAUDE.md contract files to reflect the new architecture:

**src/activity/CLAUDE.md:**
- Replace `createBlueskyInterceptor(options)` with `createActivityInterceptor(options)` in the Exposes section
- Update Key Files: replace `bluesky-interceptor.ts` with `activity-interceptor.ts`
- Note that `highPriorityFilter` is now a generic predicate, not a DID list

**src/extensions/CLAUDE.md:**
- Add `DataSourceRegistration`, `DataSourceRegistry` types to Exposes
- Add `createDataSourceRegistry(options)` factory
- Add `data-source-registry.ts` to Key Files
- Document the registry lifecycle pattern

**src/agent/CLAUDE.md:**
- Add `sourceInstructions` to the AgentDependencies description
- Note that per-source instructions are injected via lookup in `formatExternalEvent`

**Verification:**

Review each CLAUDE.md for accuracy against the implementation.

**Commit:** `docs: update CLAUDE.md files for DataSource registry and unified agent`

<!-- END_TASK_4 -->
