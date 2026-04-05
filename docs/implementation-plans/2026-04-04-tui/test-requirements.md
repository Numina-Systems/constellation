# TUI Test Requirements

Maps each acceptance criterion from the [design plan](../../design-plans/2026-04-04-tui.md) to specific automated tests or documented human verification.

---

## tui.AC1: Event bus delivers typed events

**Phase:** 1 (Event Bus and Types)

| Criterion | Type | Test File | Verification |
|-----------|------|-----------|-------------|
| tui.AC1.1 Success: Publishing an event delivers it to all subscribers | Unit | `src/tui/event-bus.test.ts` | Publish an event with two subscribers registered; assert both receive the event with correct payload |
| tui.AC1.2 Success: Subscribers only receive events matching their filter | Unit | `src/tui/event-bus.test.ts` | Subscribe with a filter accepting only `stream:chunk`; publish `stream:chunk` and `tool:start`; assert subscriber receives only `stream:chunk` |
| tui.AC1.3 Success: Unsubscribed listeners stop receiving events | Unit | `src/tui/event-bus.test.ts` | Subscribe, call returned unsubscribe function, publish event; assert unsubscribed listener receives nothing |
| tui.AC1.4 Edge: Publishing with zero subscribers doesn't throw | Unit | `src/tui/event-bus.test.ts` | Create bus with no subscribers; publish event; assert no error thrown |

**Additional edge cases (same test file):**

| Case | Type | Test File | Verification |
|------|------|-----------|-------------|
| Idempotent unsubscribe | Unit | `src/tui/event-bus.test.ts` | Call unsubscribe twice; assert no error on second call |
| Failing listener isolation | Unit | `src/tui/event-bus.test.ts` | Register a throwing listener and a normal listener; publish event; assert normal listener still receives it |
| `clear()` removes all listeners | Unit | `src/tui/event-bus.test.ts` | Subscribe two listeners, call `clear()`, publish event; assert neither receives it |

---

## tui.AC2: Agent publishes events during processing

**Phase:** 2 (Agent Integration)

| Criterion | Type | Test File | Verification |
|-----------|------|-----------|-------------|
| tui.AC2.1 Success: Agent publishes stream:start, stream:chunk(s), stream:end for a text response | Integration | `src/agent/agent-events.test.ts` | Create agent with mock streaming model provider and event bus; call `processMessage`; assert bus received events in order: `turn:start` -> `stream:start` -> `stream:chunk`(s) -> `stream:end` -> `turn:end` |
| tui.AC2.2 Success: Agent publishes tool:start and tool:result for each tool call | Integration | `src/agent/agent-events.test.ts` | Mock model returns `tool_use` stop reason on first call, `end_turn` on second; assert bus received `tool:start` and `tool:result` with correct tool name and ID between stream events |
| tui.AC2.3 Success: Agent publishes turn:start and turn:end bracketing each turn | Integration | `src/agent/agent-events.test.ts` | Call `processMessage`; assert `turn:start` is the first event published and `turn:end` is the last |
| tui.AC2.4 Success: Agent publishes stream:thinking when model returns reasoning content | Integration | `src/agent/agent-events.test.ts` | Mock model stream yields thinking content blocks; assert `stream:thinking` events are published with correct text |
| tui.AC2.5 Success: Agent without event bus behaves identically to current implementation | Integration | existing `src/integration/e2e.test.ts` | Run existing agent tests unchanged (no `eventBus` in deps); all pass without modification |
| tui.AC2.6 Success: Streaming produces the same final response as complete() for equivalent input | Unit | `src/agent/agent-events.test.ts` | Create agent with event bus and mock streaming model returning known content; compare assembled `ModelResponse` text to what `complete()` would produce with equivalent content; assert they match |

---

## tui.AC3: TUI renders streaming responses

**Phase:** 3 (Core Ink Components)

| Criterion | Type | Test File | Verification |
|-----------|------|-----------|-------------|
| tui.AC3.1 Success: Text appears incrementally as stream:chunk events arrive | Integration | `src/tui/components/streaming-text.test.tsx` | Render `StreamingText` with bus; publish `stream:chunk` events with `"Hello"` then `" world"`; assert `lastFrame()` contains `"Hello world"` |
| tui.AC3.1 (app-level) | Integration | `src/tui/app.test.tsx` | Render `App`; submit message; mock agent publishes `stream:chunk` events; assert streaming text appears in `lastFrame()` |
| tui.AC3.2 Success: Status bar updates token counts after stream:end | Integration | `src/tui/components/status-bar.test.tsx` | Render `StatusBar` with bus; publish `stream:end` with known usage stats; assert `lastFrame()` contains correct token counts |
| tui.AC3.2 (cumulative) | Integration | `src/tui/components/status-bar.test.tsx` | Publish multiple `stream:end` events; assert cumulative totals are displayed |
| tui.AC3.2 (app-level) | Integration | `src/tui/app.test.tsx` | After mock agent publishes `stream:end` with usage stats, assert `StatusBar` region of `lastFrame()` shows updated counts |
| tui.AC3.3 Success: Input is disabled during agent processing and re-enables after turn:end | Integration | `src/tui/components/input-area.test.tsx` | Render `InputArea` with `disabled={true}`; assert `lastFrame()` shows "Processing..." instead of input prompt |
| tui.AC3.3 (re-enable) | Integration | `src/tui/components/input-area.test.tsx` | Render with `disabled={false}`; assert `> ` prompt is visible |
| tui.AC3.3 (app-level) | Integration | `src/tui/app.test.tsx` | After submit, assert input shows "Processing..."; after `turn:end` event, assert input is re-enabled |
| tui.AC3.4 Success: Multiple sequential turns render as distinct messages | Integration | `src/tui/components/conversation-view.test.tsx` | Render `ConversationView` with two completed messages (user + assistant); assert both appear in `lastFrame()` with distinct role labels |
| tui.AC3.4 (app-level) | Integration | `src/tui/app.test.tsx` | Submit two messages sequentially; after both complete, assert `lastFrame()` shows both user messages and both assistant responses as distinct entries |

**Additional tests:**

| Case | Type | Test File | Verification |
|------|------|-----------|-------------|
| StreamingText ignores chunks for other turns | Unit | `src/tui/components/streaming-text.test.tsx` | Publish chunks with different `turnIndex`; assert they are not rendered |
| Hook subscribes/unsubscribes correctly | Unit | `src/tui/hooks/use-agent-events.test.tsx` | Render component using hook, publish matching event, assert received; unmount, publish again, assert no state update error |
| Hook filters correctly | Unit | `src/tui/hooks/use-agent-events.test.tsx` | Subscribe with filter; publish matching and non-matching events; assert only matching events returned |
| `useLatestAgentEvent` returns most recent only | Unit | `src/tui/hooks/use-agent-events.test.tsx` | Publish multiple events; assert hook returns only the last one |
| InputArea submit clears input | Integration | `src/tui/components/input-area.test.tsx` | Type and submit; assert `onSubmit` called with text and input value resets |
| ConversationView with empty messages | Unit | `src/tui/components/conversation-view.test.tsx` | Render with empty messages array; assert no error |
| StatusBar initial state | Unit | `src/tui/components/status-bar.test.tsx` | Render before any events; assert model name shown and zero token counts |
| StatusBar activity state | Unit | `src/tui/components/status-bar.test.tsx` | Publish `activity:sleep`; assert activity indicator changes |

---

## tui.AC4: Tool calls display inline

**Phase:** 4 (Tool Call and Thinking Display)

| Criterion | Type | Test File | Verification |
|-----------|------|-----------|-------------|
| tui.AC4.1 Success: Running tool shows spinner with tool name | Integration | `src/tui/components/tool-call.test.tsx` | Render `ToolCall` with `status="running"`; assert `lastFrame()` contains the tool name (spinner animation is non-deterministic; verify no throw) |
| tui.AC4.2 Success: Completed tool shows checkmark with result summary | Integration | `src/tui/components/tool-call.test.tsx` | Render with `status="complete"` and `resultSummary="Found 3 items"`; assert `lastFrame()` contains checkmark, tool name, and summary |
| tui.AC4.3 Success: Failed tool shows error indicator with error message | Integration | `src/tui/components/tool-call.test.tsx` | Render with `status="error"` and `errorMessage="Connection failed"`; assert `lastFrame()` contains error indicator, tool name, and error message |
| tui.AC4.4 Success: Tool call group collapses after turn ends | Integration | `src/tui/components/tool-call-group.test.tsx` | Render `ToolCallGroup` with `collapsed={false}`; publish `tool:start` and `tool:result`; assert individual items visible. Re-render with `collapsed={true}`; assert summary line replaces individual items |

**Additional tests:**

| Case | Type | Test File | Verification |
|------|------|-----------|-------------|
| Long result summaries truncated | Unit | `src/tui/components/tool-call.test.tsx` | Render with result summary > 80 chars; assert truncation with ellipsis |
| Multiple tools in single turn | Integration | `src/tui/components/tool-call-group.test.tsx` | Publish two `tool:start` then two `tool:result` events; assert both appear when expanded |
| Mixed success/failure in collapsed view | Integration | `src/tui/components/tool-call-group.test.tsx` | One tool succeeds, one fails; collapsed summary shows failure count |
| No tool events renders nothing | Unit | `src/tui/components/tool-call-group.test.tsx` | Render with no events published; assert empty output |

---

## tui.AC5: Thinking content displays

**Phase:** 4 (Tool Call and Thinking Display)

| Criterion | Type | Test File | Verification |
|-----------|------|-----------|-------------|
| tui.AC5.1 Success: Thinking content renders dimmed during streaming | Integration | `src/tui/components/thinking-indicator.test.tsx` | Render `ThinkingIndicator` with `collapsed={false}`; publish `stream:thinking` events; assert dimmed thinking text appears in `lastFrame()` |
| tui.AC5.2 Success: Thinking content collapses after turn ends | Integration | `src/tui/components/thinking-indicator.test.tsx` | Render with `collapsed={true}` after thinking events; assert collapsed summary line with character count appears instead of full text |

**Additional tests:**

| Case | Type | Test File | Verification |
|------|------|-----------|-------------|
| No thinking events renders nothing | Unit | `src/tui/components/thinking-indicator.test.tsx` | Render with no events; assert empty output |
| Multiple thinking chunks accumulate | Unit | `src/tui/components/thinking-indicator.test.tsx` | Publish multiple `stream:thinking` events; assert concatenated text |

---

## tui.AC6: Mutation approval works in TUI

**Phase:** 5 (Mutation Approval and System Events)

| Criterion | Type | Test File | Verification |
|-----------|------|-----------|-------------|
| tui.AC6.1 Success: Mutation request displays inline prompt with block ID and proposed content | Integration | `src/tui/components/mutation-prompt.test.tsx` | Render `MutationPrompt`; publish `mutation:request` event; assert `lastFrame()` shows block ID and proposed content |
| tui.AC6.2 Success: User can approve, reject, or provide feedback | Integration | `src/tui/components/mutation-prompt.test.tsx` | Publish request, simulate `y` key via `stdin.write('y')`; assert `mutation:response` published with `approved: true`. Repeat for `n` (rejection) and `f` + text + Enter (feedback) |
| tui.AC6.3 Success: Agent receives approval/rejection response | Unit | `src/tui/mutation-bridge.test.ts` | Create bus and mutation prompt callback via `createMutationPromptViaBus`; call callback with mock `PendingMutation`; assert `mutation:request` published; publish `mutation:response` with `approved: true`; assert promise resolves with `'y'` |

**Additional tests:**

| Case | Type | Test File | Verification |
|------|------|-----------|-------------|
| Rejection resolves with 'n' | Unit | `src/tui/mutation-bridge.test.ts` | Publish `mutation:response` with `approved: false`; assert promise resolves with `'n'` |
| Feedback resolves with prefixed string | Unit | `src/tui/mutation-bridge.test.ts` | Publish `mutation:response` with `approved: false, feedback: 'needs work'`; assert promise resolves with `'feedback: needs work'` |
| Feedback input mode via 'f' key | Integration | `src/tui/components/mutation-prompt.test.tsx` | Simulate `f`, type feedback text, press Enter; assert response event contains feedback |

---

## tui.AC7: System events display

**Phase:** 5 (Mutation Approval and System Events)

| Criterion | Type | Test File | Verification |
|-----------|------|-----------|-------------|
| tui.AC7.1 Success: External events show source label and summary | Integration | `src/tui/components/system-event.test.tsx` | Render `SystemEvent`; publish `event:received` with `source: 'bluesky'` and `summary: 'New post'`; assert `lastFrame()` contains `[bluesky]` and `New post` |
| tui.AC7.2 Success: Compaction shows brief indicator during and token savings after | Integration | `src/tui/components/system-event.test.tsx` | Publish `compaction:start`; assert "Compacting" indicator appears. Publish `compaction:end` with `removedTokens: 1500`; assert token savings message appears |
| tui.AC7.3 Success: Activity wake/sleep transitions display | Integration | `src/tui/components/system-event.test.tsx` | Publish `activity:wake` with reason; assert wake message. Publish `activity:sleep`; assert sleep message |

**Additional tests:**

| Case | Type | Test File | Verification |
|------|------|-----------|-------------|
| Multiple system events render in order | Integration | `src/tui/components/system-event.test.tsx` | Publish multiple events; assert all appear in published order |

---

## tui.AC8: Entry point flag

**Phase:** 6 (Entry Point and Flag Wiring)

| Criterion | Type | Test File | Verification |
|-----------|------|-----------|-------------|
| tui.AC8.1 Success: `--tui` flag launches Ink interface | Unit | `src/tui/detect.test.ts` | Call `detectTuiMode(['node', 'start', '--tui'], true)`; assert `useTui` is `true` and `warning` is `null` |
| tui.AC8.1 (end-to-end) | Human | N/A | Run `bun run start --tui`; verify Ink interface launches with status bar, conversation view, and input area. **Justification:** Full process launch with Ink rendering and terminal I/O cannot be captured in a headless unit test; requires interactive TTY. **Approach:** Manual smoke test confirming visual layout renders correctly and input accepts keystrokes. |
| tui.AC8.2 Success: No flag launches existing readline REPL unchanged | Unit | `src/tui/detect.test.ts` | Call `detectTuiMode(['node', 'start'], true)`; assert `useTui` is `false` and `warning` is `null` |
| tui.AC8.2 (end-to-end) | Human | N/A | Run `bun run start` (no flag); verify readline REPL launches as before. **Justification:** Verifying the existing REPL is truly "unchanged" requires interactive terminal observation; the unit test covers the detection logic but not the full launch path. **Approach:** Manual smoke test confirming `> ` prompt appears and accepts input identically to pre-TUI behaviour. |
| tui.AC8.3 Edge: `--tui` in non-TTY environment falls back gracefully | Unit | `src/tui/detect.test.ts` | Call `detectTuiMode(['node', 'start', '--tui'], false)`; assert `useTui` is `false` and `warning` contains non-TTY fallback message |
| tui.AC8.3 (end-to-end) | Human | N/A | Run `echo "hello" \| bun run start --tui`; verify warning is printed and REPL mode activates without crash. **Justification:** Piped stdin removes TTY, which cannot be simulated in bun test's process; requires actual non-TTY invocation. **Approach:** Run in piped context, confirm warning message on stderr and graceful fallback. |

---

## Test File Summary

| Test File | Phase | AC Coverage | Test Type |
|-----------|-------|-------------|-----------|
| `src/tui/event-bus.test.ts` | 1 | AC1.1, AC1.2, AC1.3, AC1.4 | Unit |
| `src/agent/agent-events.test.ts` | 2 | AC2.1, AC2.2, AC2.3, AC2.4, AC2.6 | Integration |
| existing `src/integration/e2e.test.ts` | 2 | AC2.5 | Integration |
| `src/tui/hooks/use-agent-events.test.tsx` | 3 | (hook contract) | Unit |
| `src/tui/components/status-bar.test.tsx` | 3 | AC3.2 | Integration |
| `src/tui/components/streaming-text.test.tsx` | 3 | AC3.1 | Integration |
| `src/tui/components/conversation-view.test.tsx` | 3 | AC3.4 | Integration |
| `src/tui/components/input-area.test.tsx` | 3 | AC3.3 | Integration |
| `src/tui/app.test.tsx` | 3 | AC3.1, AC3.2, AC3.3, AC3.4 | Integration |
| `src/tui/components/tool-call.test.tsx` | 4 | AC4.1, AC4.2, AC4.3 | Integration |
| `src/tui/components/tool-call-group.test.tsx` | 4 | AC4.4 | Integration |
| `src/tui/components/thinking-indicator.test.tsx` | 4 | AC5.1, AC5.2 | Integration |
| `src/tui/mutation-bridge.test.ts` | 5 | AC6.3 | Unit |
| `src/tui/components/mutation-prompt.test.tsx` | 5 | AC6.1, AC6.2 | Integration |
| `src/tui/components/system-event.test.tsx` | 5 | AC7.1, AC7.2, AC7.3 | Integration |
| `src/tui/detect.test.ts` | 6 | AC8.1, AC8.2, AC8.3 | Unit |

## Human Verification Summary

Three acceptance criteria require human verification in addition to their automated unit tests:

| Criterion | Justification | Verification Approach |
|-----------|---------------|----------------------|
| tui.AC8.1 (end-to-end) | Full Ink render with terminal I/O requires interactive TTY | Run `bun run start --tui`; confirm visual layout and input |
| tui.AC8.2 (end-to-end) | Verifying REPL is "unchanged" requires interactive observation | Run `bun run start`; confirm `> ` prompt and existing behaviour |
| tui.AC8.3 (end-to-end) | Piped stdin removes TTY; cannot simulate in test process | Run `echo "hello" \| bun run start --tui`; confirm warning and fallback |

All three have corresponding automated unit tests for the detection logic (`src/tui/detect.test.ts`). The human verification covers the full launch path that unit tests cannot reach.
