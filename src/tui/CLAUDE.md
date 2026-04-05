# TUI

Last verified: 2026-04-05

## Purpose

Implements a typed event bus for terminal UI integration with the agent loop. Provides a discriminated union of all TUI events (streaming, tool use, activity, mutations) and a fire-and-forget pub/sub mechanism for decoupled event delivery.

## Contracts

- **Exposes**: `AgentEvent` discriminated union type, `AgentEventBus` interface, `createAgentEventBus()` factory, helper types `AgentEventType`, `AgentEventListener`, `AgentEventFilter`, re-exported `UsageStats` and `StopReason` from model types
- **Guarantees**:
  - Event bus publishes to all subscribers matching their filter (or all if no filter)
  - One failing listener doesn't prevent delivery to other listeners
  - `subscribe()` returns an idempotent unsubscribe function
  - `clear()` removes all listeners
  - Publishing with zero subscribers doesn't throw
  - No buffering or replay — pub/sub is fire-and-forget
- **Expects**: None (pure functional implementation, no external dependencies)

## Dependencies

- **Uses**: `src/model/` (for `UsageStats` and `StopReason` types)
- **Used by**: TUI components and future agent event listeners
- **Boundary**: Event bus is a pure pub/sub mechanism; event interpretation is the responsibility of subscribers

## Key Decisions

- **Discriminated union over multiple event types**: Single `AgentEvent` type with `type` field as discriminant enables TypeScript's type narrowing and easier pattern matching
- **Factory function over class**: `createAgentEventBus()` returns a closure with private `subscriptions` Set, avoiding class boilerplate and preventing accidental state mutation
- **Silent listener error handling**: Exceptions in one listener are caught and silently ignored to prevent cascading failures
- **Functional Core pattern**: No side effects, pure pub/sub logic, fire-and-forget delivery

## Invariants

- `AgentEvent.type` is always a valid event type literal
- `subscribe()` always returns a valid unsubscribe function
- Unsubscribe function is idempotent (can be called multiple times safely)
- No two calls to `publish()` are serialized (events are independent)

## Key Files

- `types.ts` -- `AgentEvent` discriminated union, `AgentEventBus` interface, helper types, `UsageStats`/`StopReason` re-exports
- `event-bus.ts` -- `createAgentEventBus()` factory implementation with Set-based subscription tracking
- `index.ts` -- Barrel export of public API (types and factory)
- `event-bus.test.ts` -- Comprehensive unit tests covering all acceptance criteria and edge cases
