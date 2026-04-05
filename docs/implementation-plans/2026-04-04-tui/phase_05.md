# TUI Implementation Plan — Phase 5: Mutation Approval and System Events

**Goal:** Mutation approval works in TUI mode. External events and compaction display inline.

**Architecture:** The existing `processPendingMutations()` function at `src/index.ts:90-106` already accepts an `onMutationPrompt` callback — it is not coupled to readline. For TUI mode, we provide a callback that publishes `mutation:request` to the bus and awaits a `mutation:response` back. The TUI renders an inline approval prompt component. System events (external events, compaction, activity changes) are rendered as distinct system messages in the conversation view.

**Tech Stack:** TypeScript, React, Ink, chalk

**Scope:** Phase 5 of 6 from original design

**Codebase verified:** 2026-04-04

**Codebase findings:**
- ✓ `processPendingMutations(memory, onMutationPrompt)` at `src/index.ts:90-106` — already callback-based
- ✓ `PendingMutation` type at `src/memory/types.ts:34-43` — has `id`, `block_id`, `proposed_content`, `reason`, `status`, `feedback`
- ✓ Mutations processed AFTER `processMessage()` returns, not during
- ✓ `approveMutation(id)` at `src/memory/manager.ts:206-245`
- ✓ `rejectMutation(id, feedback)` at `src/memory/manager.ts:247-265`

---

## Acceptance Criteria Coverage

This phase implements and tests:

### tui.AC6: Mutation approval works in TUI
- **tui.AC6.1 Success:** Mutation request displays inline prompt with block ID and proposed content
- **tui.AC6.2 Success:** User can approve, reject, or provide feedback
- **tui.AC6.3 Success:** Agent receives approval/rejection response

### tui.AC7: System events display
- **tui.AC7.1 Success:** External events show source label and summary
- **tui.AC7.2 Success:** Compaction shows brief indicator during and token savings after
- **tui.AC7.3 Success:** Activity wake/sleep transitions display

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Create mutation prompt callback using event bus

**Verifies:** tui.AC6.3

**Files:**
- Create: `src/tui/mutation-bridge.ts`

**Implementation:**

Create `src/tui/mutation-bridge.ts` with `// pattern: Imperative Shell` annotation.

Implement `createMutationPromptViaBus(bus: AgentEventBus): (mutation: PendingMutation) => Promise<string>`.

This factory returns a callback compatible with `processPendingMutations`'s `onMutationPrompt` parameter. The callback:

1. Generates a unique `mutationId` (using `crypto.randomUUID()`)
2. Publishes `mutation:request` event with `mutationId`, `blockId` (from `mutation.block_id`), `proposedContent` (from `mutation.proposed_content`), and `reason` (from `mutation.reason`)
3. Returns a `Promise<string>` that resolves when a `mutation:response` event with matching `mutationId` arrives on the bus
4. The promise resolution logic: subscribe to the bus for `mutation:response` events, filter by `mutationId`, then resolve:
   - If `approved` is true: resolve with `'y'`
   - If `approved` is false and no `feedback`: resolve with `'n'`
   - If `approved` is false and `feedback` is provided: resolve with the feedback string. Note: the existing handler in `processPendingMutations` treats anything other than lowercase `'y'` or `'n'` as feedback text. To avoid edge cases where feedback is exactly `'y'` or `'n'`, prefix feedback with `'feedback: '` — the handler will store this as feedback rather than interpreting it as approve/reject
5. Unsubscribes after receiving the matching response

Import `PendingMutation` from `@/memory/types.ts`. Import `AgentEventBus` from `./types.ts`.

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(tui): create mutation prompt bridge for event bus`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create MutationPrompt component

**Verifies:** tui.AC6.1, tui.AC6.2

**Files:**
- Create: `src/tui/components/mutation-prompt.tsx`

**Implementation:**

Create `src/tui/components/mutation-prompt.tsx` with `// pattern: Imperative Shell` annotation.

Props:
```typescript
type MutationPromptProps = {
  bus: AgentEventBus;
};
```

The component:
1. Uses `useLatestAgentEvent` to listen for `mutation:request` events
2. When a request arrives, renders an inline prompt showing:
   - Block ID (dimmed label)
   - Proposed content (in a bordered Box, truncated to ~10 lines with "..." if longer)
   - Reason (if present, dimmed)
   - Three options: `[y] Approve  [n] Reject  [f] Feedback`
3. Uses `useInput` hook to capture keystrokes:
   - `y`: publishes `mutation:response` with `approved: true`
   - `n`: publishes `mutation:response` with `approved: false`
   - `f`: switches to a `TextInput` mode where user can type feedback, then on Enter publishes `mutation:response` with `approved: false` and `feedback` set to the typed text
4. After publishing response, clears the current request from state (ready for next mutation)

The component should be placed in the App layout between ConversationView and InputArea, and only renders when a mutation request is pending.

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(tui): add MutationPrompt component`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Mutation approval tests

**Verifies:** tui.AC6.1, tui.AC6.2, tui.AC6.3

**Files:**
- Create: `src/tui/components/mutation-prompt.test.tsx`
- Create: `src/tui/mutation-bridge.test.ts`

**Testing:**

**mutation-bridge.test.ts:**
- **tui.AC6.3:** Create a bus and the mutation prompt callback. Call the callback with a mock PendingMutation. Verify `mutation:request` event was published. Then publish a `mutation:response` with `approved: true`. Verify the callback's promise resolves with `'y'`.
- Rejection: publish `mutation:response` with `approved: false`. Promise resolves with `'n'`.
- Feedback: publish `mutation:response` with `approved: false, feedback: 'needs work'`. Promise resolves with `'feedback: needs work'` (prefixed per the implementation spec to avoid collision with literal 'y'/'n').

**mutation-prompt.test.tsx:**
- **tui.AC6.1:** Render MutationPrompt. Publish `mutation:request` event. Verify `lastFrame()` shows the block ID and proposed content.
- **tui.AC6.2:** Publish request, then simulate `y` key via `stdin.write('y')`. Verify `mutation:response` event was published on the bus with `approved: true`.
- Simulate `n` key. Verify rejection response.
- Simulate `f` key, then type feedback text and press Enter. Verify response with feedback.

**Verification:**
Run: `bun test src/tui/mutation-bridge.test.ts src/tui/components/mutation-prompt.test.tsx`
Expected: All tests pass

**Commit:** `test(tui): add mutation approval tests`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-5) -->

<!-- START_TASK_4 -->
### Task 4: Create SystemEvent component

**Verifies:** tui.AC7.1, tui.AC7.2, tui.AC7.3

**Files:**
- Create: `src/tui/components/system-event.tsx`

**Implementation:**

Create `src/tui/components/system-event.tsx` with `// pattern: Imperative Shell` annotation.

Props:
```typescript
type SystemEventDisplayProps = {
  bus: AgentEventBus;
};
```

The component:
1. Uses `useAgentEvents` to listen for system-level events: `event:received`, `compaction:start`, `compaction:end`, `activity:wake`, `activity:sleep`
2. Maintains a list of system event entries to display
3. Renders each entry as a dimmed single-line message:
   - `event:received`: `[source] summary` — e.g. `[bluesky] New post from @user`
   - `compaction:start`: `⟳ Compacting context...`
   - `compaction:end`: `⟳ Compacted — saved {removedTokens} tokens`
   - `activity:wake`: `▶ Woke: {reason}`
   - `activity:sleep`: `⏸ Sleeping`
4. All entries use `chalk.dim()` and `chalk.gray()` styling
5. System events are appended to the list (not replacing)

The component should be placed inside ConversationView, rendered inline between conversation messages at the position where they occurred.

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(tui): add SystemEvent component`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: SystemEvent tests

**Verifies:** tui.AC7.1, tui.AC7.2, tui.AC7.3

**Files:**
- Create: `src/tui/components/system-event.test.tsx`

**Testing:**

- **tui.AC7.1:** Render SystemEvent. Publish `event:received` with `source: 'bluesky'` and `summary: 'New post'`. Verify `lastFrame()` contains `[bluesky]` and `New post`.
- **tui.AC7.2:** Publish `compaction:start`. Verify "Compacting" indicator appears. Then publish `compaction:end` with `removedTokens: 1500`. Verify token savings message appears.
- **tui.AC7.3:** Publish `activity:wake` with `reason: 'scheduled task'`. Verify wake message appears. Publish `activity:sleep`. Verify sleep message appears.
- Multiple system events render in order.

**Verification:**
Run: `bun test src/tui/components/system-event.test.tsx`
Expected: All tests pass

**Commit:** `test(tui): add SystemEvent component tests`
<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_6 -->
### Task 6: Integrate mutation and system events into App

**Verifies:** tui.AC6.1, tui.AC6.2, tui.AC6.3, tui.AC7.1, tui.AC7.2, tui.AC7.3

**Files:**
- Modify: `src/tui/app.tsx`
- Modify: `src/tui/components/conversation-view.tsx`

**Implementation:**

Update the `App` component:
1. Add `MutationPrompt` component between `ConversationView` and `InputArea`
2. When a mutation request is active, disable `InputArea` (user can't type while approving mutations)
3. Add `SystemEventDisplay` component inside `ConversationView`
4. Update `AppProps` to include `memory: MemoryManager` (needed for `processPendingMutations`)
5. After `agent.processMessage()` resolves, call `processPendingMutations(memory, mutationCallback)` where `mutationCallback` comes from `createMutationPromptViaBus(bus)`

Update `ConversationView` to interleave system events between messages. System events can be rendered at the end of the conversation (after all messages), or tracked by timestamp and interleaved — the simpler approach (appending at end) is fine for v1.

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

Run: `bun test src/tui/`
Expected: All tests pass

**Commit:** `feat(tui): integrate mutation prompt and system events into app`
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Update barrel export

**Verifies:** None (infrastructure)

**Files:**
- Modify: `src/tui/index.ts`

**Implementation:**

Export `createMutationPromptViaBus` from `./mutation-bridge.ts` — this is used by the composition root to wire mutations.

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

Run: `bun test src/tui/`
Expected: All tests pass

**Commit:** `feat(tui): export mutation bridge from tui module`
<!-- END_TASK_7 -->
