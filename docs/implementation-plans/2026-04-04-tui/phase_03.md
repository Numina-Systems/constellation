# TUI Implementation Plan — Phase 3: Core Ink Components

**Goal:** Ink application renders a functional chat interface that consumes the event bus.

**Architecture:** A React component tree rendered via Ink (React for terminals). The root `App` component wires the event bus to child components. Each component subscribes to relevant events via a shared `useAgentEvents` hook. The layout is a single column: status bar at top, scrollable conversation view in the middle, input area at bottom.

**Tech Stack:** TypeScript, Bun, React 18, Ink 6, ink-text-input, chalk 5

**Scope:** Phase 3 of 6 from original design

**Codebase verified:** 2026-04-04

**External dependency research:** Ink v6.8.0 (Feb 2025), fully Bun-compatible. `render()` returns `{ unmount, waitUntilExit }`. Built-in components: `Box` (flexbox), `Text` (styled). Hooks: `useInput`, `useApp`. `ink-text-input` provides `TextInput` with `onSubmit`, `focus`, `placeholder` props. `ink-testing-library` provides `render()` → `lastFrame()`, `stdin.write()`, `unmount()`. Chalk v5 ESM-only, works with Bun.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### tui.AC3: TUI renders streaming responses
- **tui.AC3.1 Success:** Text appears incrementally as stream:chunk events arrive
- **tui.AC3.2 Success:** Status bar updates token counts after stream:end
- **tui.AC3.3 Success:** Input is disabled during agent processing and re-enables after turn:end
- **tui.AC3.4 Success:** Multiple sequential turns render as distinct messages

### tui.AC8: Entry point flag (partial — component rendering only, flag wiring in Phase 6)
- **tui.AC8.3 Edge:** `--tui` in non-TTY environment falls back gracefully

---

**Styling note:** Ink's `<Text>` component has built-in colour props (`dimColor`, `color="green"`, `bold`, etc.) that are idiomatic for inline JSX styling. Use `<Text>` props for styling within JSX. Reserve `chalk` for string construction outside of JSX (e.g., building strings that will be passed as props or logged). Both approaches work, but prefer `<Text>` props for consistency with the Ink ecosystem.

---

<!-- START_TASK_1 -->
### Task 1: Install dependencies and configure TSX support

**Verifies:** None (infrastructure)

**Files:**
- Modify: `package.json` (add dependencies)
- Modify: `tsconfig.json` (add JSX support, include TSX files)

**Step 1: Install Ink and React dependencies**

Run:
```bash
bun add react ink ink-text-input ink-spinner chalk
bun add -d @types/react ink-testing-library
```

**Step 2: Update tsconfig.json**

Add to `compilerOptions`:
```json
"jsx": "react-jsx",
"jsxImportSource": "react"
```

Update the `include` array from `["src/**/*.ts"]` to `["src/**/*.ts", "src/**/*.tsx"]`.

Preserve the existing `exclude` array unchanged (it excludes `src/runtime/deno/**` which is Deno code).

**Step 3: Verify**

Run: `bunx tsc --noEmit`
Expected: No type errors

Run: `bun test`
Expected: All existing tests pass

**Commit:** `chore(tui): add ink, react, chalk dependencies and TSX support`
<!-- END_TASK_1 -->

<!-- START_SUBCOMPONENT_A (tasks 2-3) -->

<!-- START_TASK_2 -->
### Task 2: Create useAgentEvents hook

**Verifies:** None (utility hook, tested via component tests)

**Files:**
- Create: `src/tui/hooks/use-agent-events.ts`

**Implementation:**

Create `src/tui/hooks/use-agent-events.ts` with `// pattern: Imperative Shell` annotation (React hook with side effects).

Implement a custom hook `useAgentEvents` that subscribes to the event bus and returns accumulated events.

Signature:
```typescript
function useAgentEvents<T extends AgentEvent>(
  bus: AgentEventBus,
  filter: (event: AgentEvent) => event is T,
): ReadonlyArray<T>
```

The hook:
1. Maintains a `useState<Array<T>>` for collected events
2. Subscribes to the bus in a `useEffect`, passing the filter to `bus.subscribe()`
3. On each matching event, appends to state via `setState(prev => [...prev, event])`
4. Returns the cleanup (unsubscribe) function from `useEffect`
5. Batches high-frequency events using `useRef` + `setTimeout(0)` to avoid excessive re-renders: accumulate events in a ref buffer and flush to state on the next microtask

Also export a simpler overload for when you just want the latest event of a type:
```typescript
function useLatestAgentEvent<T extends AgentEvent>(
  bus: AgentEventBus,
  filter: (event: AgentEvent) => event is T,
): T | null
```

This returns only the most recent matching event (replaces state rather than accumulating).

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(tui): add useAgentEvents and useLatestAgentEvent hooks`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Hook tests

**Verifies:** None (utility tests, but validates hook contract)

**Files:**
- Create: `src/tui/hooks/use-agent-events.test.tsx`

**Testing:**

Test the hooks by creating a minimal Ink component that uses them and rendering with `ink-testing-library`.

- Hook subscribes on mount and receives matching events
- Hook ignores events that don't match the filter
- Hook unsubscribes on unmount (publish after unmount doesn't cause state update)
- `useLatestAgentEvent` returns only the most recent event, not all events
- Batching: multiple rapid events result in a single state update (verify render count via `frames` array from ink-testing-library)

Use `createAgentEventBus()` from Phase 1 to create a real bus for testing.

**Verification:**
Run: `bun test src/tui/hooks/use-agent-events.test.tsx`
Expected: All tests pass

**Commit:** `test(tui): add useAgentEvents hook tests`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-5) -->

<!-- START_TASK_4 -->
### Task 4: Create StatusBar component

**Verifies:** tui.AC3.2

**Files:**
- Create: `src/tui/components/status-bar.tsx`

**Implementation:**

Create `src/tui/components/status-bar.tsx` with `// pattern: Imperative Shell` annotation.

Props:
```typescript
type StatusBarProps = {
  bus: AgentEventBus;
  modelName: string;
};
```

The component:
1. Uses `useLatestAgentEvent` to subscribe to `stream:end` events (for usage stats) and `activity:wake`/`activity:sleep` events (for activity state)
2. Maintains cumulative token usage in state (adds each `stream:end` usage to running total)
3. Renders a single-line `Box` with:
   - Model name (left-aligned, dimmed)
   - Token usage: `{inputTokens}↓ {outputTokens}↑` (centre or right-aligned)
   - Activity state indicator: `●` green when active, dim when sleeping
4. Uses `chalk.dim()` for secondary text, `chalk.green()`/`chalk.gray()` for the activity dot

Use `Box` with `flexDirection="row"` and `justifyContent="space-between"` for layout.

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(tui): add StatusBar component`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: StatusBar tests

**Verifies:** tui.AC3.2

**Files:**
- Create: `src/tui/components/status-bar.test.tsx`

**Testing:**

- **tui.AC3.2:** Render StatusBar with a bus. Publish a `stream:end` event with known usage stats. Verify `lastFrame()` contains the token counts.
- Publish multiple `stream:end` events. Verify cumulative totals are shown.
- Publish `activity:sleep` event. Verify the activity indicator changes.
- Initial render shows model name and zero token counts.

Use `ink-testing-library` `render()` and `lastFrame()` for assertions.

**Verification:**
Run: `bun test src/tui/components/status-bar.test.tsx`
Expected: All tests pass

**Commit:** `test(tui): add StatusBar component tests`
<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 6-7) -->

<!-- START_TASK_6 -->
### Task 6: Create StreamingText component

**Verifies:** tui.AC3.1

**Files:**
- Create: `src/tui/components/streaming-text.tsx`

**Implementation:**

Create `src/tui/components/streaming-text.tsx` with `// pattern: Imperative Shell` annotation.

Props:
```typescript
type StreamingTextProps = {
  bus: AgentEventBus;
  turnIndex: number;
};
```

The component:
1. Uses `useAgentEvents` filtered to `stream:chunk` events matching the given `turnIndex`
2. Accumulates text from all chunk events into a single string
3. Renders the accumulated text in a `Text` component
4. When no chunks have arrived yet, renders nothing (empty fragment)

The accumulated text grows as chunks arrive, giving the character-by-character streaming appearance.

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(tui): add StreamingText component`
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: StreamingText tests

**Verifies:** tui.AC3.1

**Files:**
- Create: `src/tui/components/streaming-text.test.tsx`

**Testing:**

- **tui.AC3.1:** Render StreamingText with a bus and turnIndex=1. Publish `stream:chunk` events with `text: "Hello"`, then `text: " world"`. Verify `lastFrame()` contains `"Hello world"`.
- Chunks with different turnIndex are ignored.
- Initial render before any chunks shows empty output.

**Verification:**
Run: `bun test src/tui/components/streaming-text.test.tsx`
Expected: All tests pass

**Commit:** `test(tui): add StreamingText component tests`
<!-- END_TASK_7 -->

<!-- END_SUBCOMPONENT_C -->

<!-- START_SUBCOMPONENT_D (tasks 8-9) -->

<!-- START_TASK_8 -->
### Task 8: Create Message and ConversationView components

**Verifies:** tui.AC3.4

**Files:**
- Create: `src/tui/components/message.tsx`
- Create: `src/tui/components/conversation-view.tsx`

**Implementation:**

**message.tsx** (`// pattern: Imperative Shell`):

Props:
```typescript
type MessageProps = {
  role: 'user' | 'assistant';
  content: string;
};
```

Renders a `Box` with:
- Role label (dimmed): `You:` or `Assistant:`
- Content as `Text` below the label
- Bottom margin of 1 for visual separation between messages

**conversation-view.tsx** (`// pattern: Imperative Shell`):

Props:
```typescript
type ConversationViewProps = {
  bus: AgentEventBus;
  messages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
  isStreaming: boolean;
  currentTurnIndex: number;
};
```

The component:
1. Renders completed messages from the `messages` array using `Message` components
2. When `isStreaming` is true, renders a `StreamingText` component for the current turn (using `currentTurnIndex` and the bus)
3. Uses `Box` with `flexDirection="column"` for vertical stacking

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(tui): add Message and ConversationView components`
<!-- END_TASK_8 -->

<!-- START_TASK_9 -->
### Task 9: Message and ConversationView tests

**Verifies:** tui.AC3.4

**Files:**
- Create: `src/tui/components/conversation-view.test.tsx`

**Testing:**

- **tui.AC3.4:** Render ConversationView with two completed messages (user + assistant). Verify both appear in `lastFrame()` with distinct role labels.
- Render with `isStreaming=true`. Publish `stream:chunk` events. Verify streaming text appears after completed messages.
- Render with empty messages array. Verify no errors.

**Verification:**
Run: `bun test src/tui/components/conversation-view.test.tsx`
Expected: All tests pass

**Commit:** `test(tui): add ConversationView component tests`
<!-- END_TASK_9 -->

<!-- END_SUBCOMPONENT_D -->

<!-- START_SUBCOMPONENT_E (tasks 10-11) -->

<!-- START_TASK_10 -->
### Task 10: Create InputArea component

**Verifies:** tui.AC3.3

**Files:**
- Create: `src/tui/components/input-area.tsx`

**Implementation:**

Create `src/tui/components/input-area.tsx` with `// pattern: Imperative Shell` annotation.

Props:
```typescript
type InputAreaProps = {
  onSubmit: (text: string) => void;
  disabled: boolean;
};
```

The component:
1. Uses controlled `TextInput` from `ink-text-input` with `value`/`onChange` state
2. On submit: calls `onSubmit` prop with the current value, then clears the input
3. When `disabled` is true: sets `focus={false}` on TextInput and shows a dimmed "Processing..." indicator instead of the prompt
4. When `disabled` is false: shows `> ` prompt prefix and the text input
5. Uses `Box` with a top border or divider to visually separate from conversation

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(tui): add InputArea component`
<!-- END_TASK_10 -->

<!-- START_TASK_11 -->
### Task 11: InputArea tests

**Verifies:** tui.AC3.3

**Files:**
- Create: `src/tui/components/input-area.test.tsx`

**Testing:**

- **tui.AC3.3:** Render InputArea with `disabled={true}`. Verify `lastFrame()` shows "Processing..." indicator, not the text input prompt.
- Render with `disabled={false}`. Verify the `> ` prompt is visible.
- Render with `disabled={false}`. Use `stdin.write('hello\r')` to simulate typing and pressing Enter. Verify `onSubmit` callback was called with `"hello"`.
- After submit, input value is cleared.

**Verification:**
Run: `bun test src/tui/components/input-area.test.tsx`
Expected: All tests pass

**Commit:** `test(tui): add InputArea component tests`
<!-- END_TASK_11 -->

<!-- END_SUBCOMPONENT_E -->

<!-- START_SUBCOMPONENT_F (tasks 12-13) -->

<!-- START_TASK_12 -->
### Task 12: Create root App component

**Verifies:** tui.AC3.1, tui.AC3.2, tui.AC3.3, tui.AC3.4

**Files:**
- Create: `src/tui/app.tsx`

**Implementation:**

Create `src/tui/app.tsx` with `// pattern: Imperative Shell` annotation.

Props:
```typescript
type AppProps = {
  agent: Agent;
  bus: AgentEventBus;
  modelName: string;
};
```

The component:
1. Maintains state:
   - `messages: Array<{ role: 'user' | 'assistant'; content: string }>` — completed conversation messages
   - `isProcessing: boolean` — whether agent is currently processing
   - `turnIndex: number` — current turn counter
   - `currentTurnText: string` — accumulated text from `stream:chunk` events for the current turn (App subscribes to chunks in parallel with `StreamingText` to have the final text when the turn ends)
2. Uses `useAgentEvents` to listen for lifecycle and stream events:
   - On `turn:start`: set `isProcessing = true`, increment `turnIndex`, reset `currentTurnText` to `''`
   - On `stream:chunk`: append chunk text to `currentTurnText` (this runs in parallel with `StreamingText`'s own accumulation — both subscribe independently to the bus)
   - On `turn:end`: set `isProcessing = false`, add `{ role: 'assistant', content: currentTurnText }` to `messages`, reset `currentTurnText` to `''`
3. `handleSubmit` callback:
   - Adds user message to `messages` state
   - Calls `agent.processMessage(text)` (fire-and-forget — the event bus handles UI updates)
4. Uses `useApp()` hook for exit on Ctrl+C
5. Renders layout:
   ```
   <Box flexDirection="column" height="100%">
     <StatusBar bus={bus} modelName={modelName} />
     <Box flexGrow={1} flexDirection="column">
       <ConversationView
         bus={bus}
         messages={messages}
         isStreaming={isProcessing}
         currentTurnIndex={turnIndex}
       />
     </Box>
     <InputArea
       onSubmit={handleSubmit}
       disabled={isProcessing}
     />
   </Box>
   ```

Also export a `renderApp` function that calls Ink's `render()` and returns the instance:
```typescript
function renderApp(props: AppProps): { waitUntilExit: () => Promise<void>; unmount: () => void }
```

This will be called from the entry point in Phase 6.

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(tui): add root App component with renderApp`
<!-- END_TASK_12 -->

<!-- START_TASK_13 -->
### Task 13: App integration tests

**Verifies:** tui.AC3.1, tui.AC3.2, tui.AC3.3, tui.AC3.4

**Files:**
- Create: `src/tui/app.test.tsx`

**Testing:**

These are integration tests that verify the full component tree works together via the event bus.

Create a mock `Agent` object that, when `processMessage` is called, publishes a sequence of events to the bus (simulating what the real agent does after Phase 2).

- **tui.AC3.1:** Render App. Submit a message via InputArea. Mock agent publishes `stream:chunk` events. Verify streaming text appears in `lastFrame()`.
- **tui.AC3.2:** After mock agent publishes `stream:end` with usage stats, verify StatusBar shows updated token counts.
- **tui.AC3.3:** After submitting, verify input shows "Processing...". After `turn:end` event, verify input is re-enabled.
- **tui.AC3.4:** Submit two messages sequentially. After both complete, verify `lastFrame()` shows both user messages and both assistant responses as distinct entries.

Use `ink-testing-library` `render()` and `stdin.write()` for input simulation.

**Verification:**
Run: `bun test src/tui/app.test.tsx`
Expected: All tests pass

**Commit:** `test(tui): add App integration tests`
<!-- END_TASK_13 -->

<!-- END_SUBCOMPONENT_F -->

<!-- START_TASK_14 -->
### Task 14: Update barrel export

**Verifies:** None (infrastructure)

**Files:**
- Modify: `src/tui/index.ts`

**Implementation:**

Add exports for the new public API:
- `export { renderApp }` from `./app.tsx`
- `export { useAgentEvents, useLatestAgentEvent }` from `./hooks/use-agent-events.ts`

Component exports are optional (they're consumed internally by App), but export the hooks and `renderApp` as the public interface.

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

Run: `bun test src/tui/`
Expected: All tests pass

**Commit:** `feat(tui): export renderApp and hooks from tui module`
<!-- END_TASK_14 -->
