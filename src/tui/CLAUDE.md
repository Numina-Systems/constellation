# TUI

Last verified: 2026-04-05

## Purpose

Terminal UI for Constellation, built with React 19 and Ink 6. Provides real-time streaming display, tool call visualization, thinking indicators, mutation approval prompts, and a status bar. Activated via `--tui` flag as an alternative to the readline REPL. Communicates with the agent loop through a typed event bus (fire-and-forget pub/sub).

## Contracts

- **Exposes**: `AgentEvent` discriminated union, `AgentEventBus` interface, `createAgentEventBus()` factory, `renderApp()` entry point, `detectTuiMode()` flag parser, `createMutationPromptViaBus()` bridge, `useAgentEvents()` and `useLatestAgentEvent()` hooks, all event-related helper types
- **Guarantees**:
  - Event bus publishes to all subscribers matching their filter (or all if no filter)
  - One failing listener does not prevent delivery to other listeners
  - `subscribe()` returns an idempotent unsubscribe function
  - No buffering or replay -- pub/sub is fire-and-forget
  - `detectTuiMode()` is a pure function: returns `{ useTui, warning? }` from argv and TTY state
  - `renderApp()` returns `{ waitUntilExit }` for lifecycle management
  - Mutation bridge converts event bus mutation:request/response events into the `MutationCallback` interface expected by the memory module
- **Expects**: `AgentEventBus` injected into `AgentDependencies.eventBus` to receive agent loop events. React/Ink only loaded via dynamic import when TUI mode is active.

## Dependencies

- **Uses**: `src/model/` (for `UsageStats`, `StopReason`, `StreamEvent` types), `react`, `ink`, `ink-spinner`, `ink-text-input`, `chalk`
- **Used by**: `src/index.ts` (composition root, conditional TUI launch), `src/agent/` (event bus integration)
- **Boundary**: Event bus is the sole integration point between agent loop and UI. The TUI never calls agent methods directly; it subscribes to events and renders state derived from them. User input flows through `renderApp`'s `onSubmit` which calls `agent.processMessage`.

## Key Decisions

- **Event bus over direct coupling**: Agent publishes events; TUI subscribes. Neither depends on the other's internals. The event bus is an optional dependency (`eventBus?: AgentEventBus`), so the agent works identically without it.
- **Dynamic import**: React/Ink dependencies are only loaded when `--tui` is passed, keeping the REPL path dependency-free.
- **Stream assembler in agent module**: `assembleResponseFromStream` lives in `src/agent/` (not `src/tui/`) because it produces a `ModelResponse` -- it bridges streaming to the existing non-streaming agent loop while publishing events as a side effect.
- **Mutation bridge pattern**: Memory mutations require interactive approval. The bridge converts event bus request/response pairs into the callback interface the memory module expects, using a promise-per-mutation coordination pattern.
- **Factory functions over classes**: All public APIs use `createFoo()` pattern consistent with project conventions.

## Invariants

- `AgentEvent.type` is always a valid discriminant literal
- TUI components only read from event bus subscriptions; they never publish agent-domain events
- `detectTuiMode()` never throws; it returns warnings as data
- The REPL path remains unchanged when `--tui` is not passed

## Key Files

- `types.ts` -- `AgentEvent` discriminated union (16 event types), `AgentEventBus` interface, helper types
- `event-bus.ts` -- `createAgentEventBus()` factory with Set-based subscription tracking
- `detect.ts` -- `detectTuiMode(argv, isTTY)` pure function for `--tui` flag parsing
- `mutation-bridge.ts` -- `createMutationPromptViaBus()` converts event bus into `MutationCallback`
- `hooks/use-agent-events.ts` -- `useAgentEvents()` and `useLatestAgentEvent()` React hooks
- `app.tsx` -- Root `App` component and `renderApp()` entry point
- `components/conversation-view.tsx` -- Message list with auto-scroll
- `components/message.tsx` -- Individual message rendering (user/assistant)
- `components/streaming-text.tsx` -- Real-time streaming text display
- `components/thinking-indicator.tsx` -- Extended thinking visualization
- `components/tool-call.tsx` -- Single tool call display
- `components/tool-call-group.tsx` -- Grouped tool calls per turn
- `components/status-bar.tsx` -- Model info, token usage, message count
- `components/input-area.tsx` -- User input with disabled state during processing
- `components/mutation-prompt.tsx` -- Interactive mutation approval UI
- `components/system-event.tsx` -- System event display (compaction, activity, errors)
- `index.ts` -- Barrel export of public API
