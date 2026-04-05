# TUI Implementation Plan — Phase 4: Tool Call and Thinking Display

**Goal:** Tool calls and thinking content are visible inline during agent turns.

**Architecture:** Three new Ink components that subscribe to the event bus for tool and thinking events. `ToolCall` renders individual tool status (spinner while running, checkmark on completion). `ToolCallGroup` collects tool calls within a turn and collapses after the turn ends. `ThinkingIndicator` renders dimmed thinking content that collapses after the turn.

**Tech Stack:** TypeScript, React, Ink, ink-spinner, chalk

**Scope:** Phase 4 of 6 from original design

**Codebase verified:** 2026-04-04

---

## Acceptance Criteria Coverage

This phase implements and tests:

### tui.AC4: Tool calls display inline
- **tui.AC4.1 Success:** Running tool shows spinner with tool name
- **tui.AC4.2 Success:** Completed tool shows checkmark with result summary
- **tui.AC4.3 Success:** Failed tool shows error indicator with error message
- **tui.AC4.4 Success:** Tool call group collapses after turn ends

### tui.AC5: Thinking content displays
- **tui.AC5.1 Success:** Thinking content renders dimmed during streaming
- **tui.AC5.2 Success:** Thinking content collapses after turn ends

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Create ToolCall component

**Verifies:** tui.AC4.1, tui.AC4.2, tui.AC4.3

**Files:**
- Create: `src/tui/components/tool-call.tsx`

**Implementation:**

Create `src/tui/components/tool-call.tsx` with `// pattern: Imperative Shell` annotation.

Props:
```typescript
type ToolCallStatus = 'running' | 'complete' | 'error';

type ToolCallProps = {
  toolName: string;
  toolId: string;
  status: ToolCallStatus;
  resultSummary?: string;
  errorMessage?: string;
};
```

The component renders a single line based on status:
- `running`: `<Spinner /> toolName` — uses `ink-spinner` `Spinner` component followed by the tool name in normal text
- `complete`: `✓ toolName — resultSummary` — green checkmark via `chalk.green('✓')`, tool name, then a truncated result summary (max ~80 chars, with ellipsis)
- `error`: `✗ toolName — errorMessage` — red cross via `chalk.red('✗')`, tool name, then the error message

Use `Box` with `flexDirection="row"` and `gap={1}` for spacing. The result summary should be dimmed (`chalk.dim()`).

Import `Spinner` from `ink-spinner`.

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(tui): add ToolCall component`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: ToolCall tests

**Verifies:** tui.AC4.1, tui.AC4.2, tui.AC4.3

**Files:**
- Create: `src/tui/components/tool-call.test.tsx`

**Testing:**

- **tui.AC4.1:** Render ToolCall with `status="running"`. Verify `lastFrame()` contains the tool name. (Spinner animation is hard to assert; verify it doesn't throw.)
- **tui.AC4.2:** Render with `status="complete"` and `resultSummary="Found 3 items"`. Verify `lastFrame()` contains `✓`, the tool name, and the summary.
- **tui.AC4.3:** Render with `status="error"` and `errorMessage="Connection failed"`. Verify `lastFrame()` contains `✗`, the tool name, and the error message.
- Long result summaries are truncated with ellipsis.

**Verification:**
Run: `bun test src/tui/components/tool-call.test.tsx`
Expected: All tests pass

**Commit:** `test(tui): add ToolCall component tests`
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->

<!-- START_TASK_3 -->
### Task 3: Create ToolCallGroup component

**Verifies:** tui.AC4.4

**Files:**
- Create: `src/tui/components/tool-call-group.tsx`

**Implementation:**

Create `src/tui/components/tool-call-group.tsx` with `// pattern: Imperative Shell` annotation.

Props:
```typescript
type ToolCallGroupProps = {
  bus: AgentEventBus;
  turnIndex: number;
  collapsed: boolean;
};
```

The component:
1. Maintains state: `Map<string, { toolName: string; status: ToolCallStatus; result?: string; error?: string }>`
2. Uses `useAgentEvents` to listen for `tool:start` and `tool:result` events
3. On `tool:start`: adds entry to map with `status: 'running'`
4. On `tool:result`: updates entry — `status: result.isError ? 'error' : 'complete'`, sets result or error text
5. When `collapsed` is false: renders all `ToolCall` components vertically
6. When `collapsed` is true and tools exist: renders a single summary line like `✓ 3 tool calls` (dimmed). If any tool errored, show `⚠ 3 tool calls (1 failed)` instead.
7. When no tool events have been received: renders nothing

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(tui): add ToolCallGroup component`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: ToolCallGroup tests

**Verifies:** tui.AC4.4

**Files:**
- Create: `src/tui/components/tool-call-group.test.tsx`

**Testing:**

- **tui.AC4.4:** Render ToolCallGroup with `collapsed={false}`. Publish `tool:start` then `tool:result` events. Verify individual ToolCall items appear. Then re-render with `collapsed={true}`. Verify the summary line appears instead.
- Multiple tools in a single turn: publish two `tool:start` events, then two `tool:result` events. Verify both appear when expanded.
- Mixed success/failure: one tool succeeds, one fails. Collapsed summary shows failure count.
- No tool events: renders nothing.

**Verification:**
Run: `bun test src/tui/components/tool-call-group.test.tsx`
Expected: All tests pass

**Commit:** `test(tui): add ToolCallGroup component tests`
<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 5-6) -->

<!-- START_TASK_5 -->
### Task 5: Create ThinkingIndicator component

**Verifies:** tui.AC5.1, tui.AC5.2

**Files:**
- Create: `src/tui/components/thinking-indicator.tsx`

**Implementation:**

Create `src/tui/components/thinking-indicator.tsx` with `// pattern: Imperative Shell` annotation.

Props:
```typescript
type ThinkingIndicatorProps = {
  bus: AgentEventBus;
  turnIndex: number;
  collapsed: boolean;
};
```

The component:
1. Uses `useAgentEvents` to accumulate `stream:thinking` events matching the `turnIndex`
2. Concatenates thinking text from all events
3. When `collapsed` is false and thinking text exists: renders the full thinking text with `chalk.dim()` styling, prefixed with a dimmed `💭` or `Thinking:` label
4. When `collapsed` is true and thinking text exists: renders a single dimmed line like `💭 Thinking (243 chars)` — showing only the length indicator
5. When no thinking content: renders nothing

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(tui): add ThinkingIndicator component`
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: ThinkingIndicator tests

**Verifies:** tui.AC5.1, tui.AC5.2

**Files:**
- Create: `src/tui/components/thinking-indicator.test.tsx`

**Testing:**

- **tui.AC5.1:** Render with `collapsed={false}`. Publish `stream:thinking` events with text. Verify dimmed thinking text appears in `lastFrame()`.
- **tui.AC5.2:** Render with `collapsed={true}` after thinking events. Verify collapsed summary line appears (character count indicator).
- No thinking events: renders nothing.
- Multiple thinking chunks accumulate into continuous text.

**Verification:**
Run: `bun test src/tui/components/thinking-indicator.test.tsx`
Expected: All tests pass

**Commit:** `test(tui): add ThinkingIndicator component tests`
<!-- END_TASK_6 -->

<!-- END_SUBCOMPONENT_C -->

<!-- START_TASK_7 -->
### Task 7: Integrate tool and thinking components into ConversationView

**Verifies:** tui.AC4.1, tui.AC4.2, tui.AC4.3, tui.AC4.4, tui.AC5.1, tui.AC5.2

**Files:**
- Modify: `src/tui/components/conversation-view.tsx`
- Modify: `src/tui/app.tsx`

**Implementation:**

Update `ConversationView` to include `ToolCallGroup` and `ThinkingIndicator` alongside streaming text during active turns and in completed turn history.

Update `ConversationViewProps` to include data about completed turns that had tools or thinking:
```typescript
type CompletedTurn = {
  role: 'user' | 'assistant';
  content: string;
  hadTools: boolean;
  hadThinking: boolean;
  turnIndex: number;
};
```

For the current (streaming) turn:
- Render `ThinkingIndicator` with `collapsed={false}` (live thinking)
- Render `StreamingText` for response text
- Render `ToolCallGroup` with `collapsed={false}` (live tool status)

For completed turns:
- Render `ThinkingIndicator` with `collapsed={true}` (shows summary)
- Render `Message` with completed text
- Render `ToolCallGroup` with `collapsed={true}` (shows summary)

Update `App` component to track `hadTools` and `hadThinking` per turn by listening for relevant events.

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

Run: `bun test src/tui/`
Expected: All tests pass (including previously written tests)

**Commit:** `feat(tui): integrate tool and thinking display into conversation view`
<!-- END_TASK_7 -->

<!-- START_TASK_8 -->
### Task 8: Update barrel export

**Verifies:** None (infrastructure)

**Files:**
- Modify: `src/tui/index.ts`

**Implementation:**

No new public API exports needed — the tool and thinking components are consumed internally by `ConversationView` and `App`. The barrel export remains unchanged unless components need external access.

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

Run: `bun test src/tui/`
Expected: All tests pass

**Commit:** `chore(tui): verify barrel exports after tool and thinking integration`
<!-- END_TASK_8 -->
