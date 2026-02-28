# Bluesky DataSource Implementation Plan — Phase 3: Agent Extension — processEvent()

**Goal:** Add external event processing to the Agent so it can receive Bluesky posts in a dedicated, persistent conversation isolated from the REPL.

**Architecture:** `ExternalEvent` is a typed envelope for events from outside the REPL. `processEvent()` formats the event as a structured user message with metadata header and delegates to the existing `processMessage()` pipeline. A dedicated Bluesky agent instance is created with a deterministic `conversationId` (a plain string like `"bluesky-" + did`) so the conversation persists across daemon restarts. The REPL agent and Bluesky agent are separate instances sharing the same `AgentDependencies`.

**Tech Stack:** Bun test

**Scope:** 6 phases from original design (phase 3 of 6)

**Codebase verified:** 2026-02-28

---

## Acceptance Criteria Coverage

This phase implements and tests:

### bsky-datasource.AC2: Agent processEvent()
- **bsky-datasource.AC2.1 Success:** `processEvent()` creates/reuses a dedicated Bluesky conversation distinct from REPL
- **bsky-datasource.AC2.2 Success:** Event is formatted as a structured message with author DID/handle, post URI/CID, reply context, and post text
- **bsky-datasource.AC2.3 Success:** Agent can use tools (memory, code execution) during event processing
- **bsky-datasource.AC2.4 Edge:** Bluesky conversation persists across daemon restarts (deterministic conversation_id)

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Add ExternalEvent type and implement processEvent()

**Verifies:** bsky-datasource.AC2.1, bsky-datasource.AC2.2, bsky-datasource.AC2.3, bsky-datasource.AC2.4

**Files:**
- Modify: `src/agent/types.ts` (AgentDependencies, Agent type)
- Modify: `src/agent/agent.ts`
- Modify: `src/agent/index.ts` (barrel export)

**Implementation:**

This task adds the `ExternalEvent` type, updates the `Agent` type, and implements `processEvent()` in a single commit to avoid a broken intermediate type-check state.

**1. Add `ExternalEvent` type to `src/agent/types.ts`:**

Add before the `Agent` type definition:

```typescript
export type ExternalEvent = {
  readonly source: string;
  readonly content: string;
  readonly metadata: Record<string, unknown>;
  readonly timestamp: Date;
};
```

This mirrors the `IncomingMessage` type from `src/extensions/data-source.ts` intentionally — the DataSource produces `IncomingMessage`, the agent consumes `ExternalEvent`. They share the same shape but are semantically distinct (one is a transport message, the other is an agent input).

**2. Update the `Agent` type to include `processEvent`:**

```typescript
export type Agent = {
  processMessage(userMessage: string): Promise<string>;
  processEvent(event: ExternalEvent): Promise<string>;
  getConversationHistory(): Promise<Array<ConversationMessage>>;
  conversationId: string;
};
```

**3. Implement `processEvent()` in `src/agent/agent.ts`:**

Add a `processEvent()` function inside the `createAgent()` closure (after `processMessage`, before `getConversationHistory`). The function:

1. **Formats the event** as a structured user message with metadata header:
   ```
   [External Event: bluesky]
   From: @handle (did:plc:xxx)
   Post: at://did:plc:xxx/app.bsky.feed.post/rkey
   Reply to: at://did:plc:yyy/app.bsky.feed.post/rkey (if applicable)
   Time: 2026-02-28T12:00:00.000Z

   <post text content>
   ```

2. **Delegates to `processMessage()`** with the formatted string. This means the agent automatically gets tool use, memory access, compression — everything `processMessage` already provides (AC2.3).

The formatting function `formatExternalEvent(event: ExternalEvent): string` should be extracted as a pure function for testability.

Add `processEvent` to the returned object literal:

```typescript
return {
  processMessage,
  processEvent,
  getConversationHistory,
  conversationId: id,
};
```

**For deterministic conversation_id (AC2.4):** This is handled at the composition root level (Phase 6), not here. The agent takes an optional `conversationId` parameter already. Phase 6 will pass a deterministic ID like `"bluesky-" + config.bluesky.did` when creating the Bluesky agent instance.

**4. Update the barrel export in `src/agent/index.ts`:**
```typescript
export type { Agent, AgentConfig, AgentDependencies, ConversationMessage, ExternalEvent } from './types.ts';
```

**Testing:**

Tests must verify each AC listed above:
- bsky-datasource.AC2.1: Create two agents with different conversationIds, verify they maintain separate conversations (this is already the existing behavior of createAgent — test confirms it)
- bsky-datasource.AC2.2: Call `formatExternalEvent()` with a Bluesky event including metadata (did, handle, uri, cid, reply_to) and verify the formatted string contains all metadata fields in the expected format
- bsky-datasource.AC2.3: Call `processEvent()` with a mock model provider that returns tool_use blocks, verify the agent dispatches tools and returns a response (leverages existing processMessage pipeline)
- bsky-datasource.AC2.4: Verify that creating two agent instances with the same deterministic conversationId results in the same `agent.conversationId` value

Test file: `src/agent/agent.test.ts` (existing file — add new describe block)

The existing agent.test.ts already has mock providers set up. Add a new `describe("processEvent")` block following the same patterns.

**Verification:**
Run: `bun test src/agent/agent.test.ts`
Expected: All tests pass (existing + new)

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(agent): add ExternalEvent type and implement processEvent()`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Run full test suite

**Verifies:** None (verification gate)

**Files:** None (read-only)

**Verification:**
Run: `bun test`
Expected: All previously-passing tests still pass plus new Phase 3 tests. Pre-existing PostgreSQL failures expected.

Run: `bun run build`
Expected: Type-check passes with zero errors.

**Commit:** No commit (verification only)
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->
