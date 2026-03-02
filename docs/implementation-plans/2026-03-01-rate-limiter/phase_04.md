# Rate Limiter Implementation Plan — Phase 4: Context Provider System

**Goal:** General-purpose context injection mechanism for the agent's system prompt, enabling the rate limiter (and future extensions) to inject dynamic context each round.

**Architecture:** A `ContextProvider` type (function returning optional string) added to `src/agent/types.ts`. The `AgentDependencies` type gains a `contextProviders` field. `buildSystemPrompt()` in `src/agent/context.ts` appends context provider output to the system prompt each round. Fully optional — no providers means no change to prompt.

**Tech Stack:** Bun, TypeScript (strict mode), bun:test

**Scope:** 5 phases from original design (phase 4 of 5)

**Codebase verified:** 2026-03-01

---

## Acceptance Criteria Coverage

This phase implements and tests:

### rate-limiter.AC3: Spirit sees resource budget in context
- **rate-limiter.AC3.1 Success:** System prompt includes current remaining capacity for input tokens, output tokens, and queue depth
- **rate-limiter.AC3.2 Success:** Budget display updates each round (reflects consumption from previous round)
- **rate-limiter.AC3.3 Success:** When no rate limiter is configured, no budget section appears in system prompt

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Add ContextProvider type and update AgentDependencies

**Verifies:** rate-limiter.AC3.3 (optional field — no providers means no change)

**Files:**
- Modify: `src/agent/types.ts:42-51` (AgentDependencies)

**Implementation:**

Add the `ContextProvider` type and update `AgentDependencies` in `src/agent/types.ts`.

The `ContextProvider` type is a function that returns an optional string. When it returns a string, that string is appended to the system prompt. When it returns `undefined`, nothing is appended.

Add this type before the `AgentDependencies` definition (around line 41):

```typescript
export type ContextProvider = () => string | undefined;
```

Add `contextProviders` as an optional field on `AgentDependencies` (after the `compactor` field at line 50):

```typescript
export type AgentDependencies = {
  model: ModelProvider;
  memory: MemoryManager;
  registry: ToolRegistry;
  runtime: CodeRuntime;
  persistence: PersistenceProvider;
  config: AgentConfig;
  getExecutionContext?: () => ExecutionContext;
  compactor?: Compactor;
  contextProviders?: ReadonlyArray<ContextProvider>;
};
```

**Verification:**

Run: `bun run build`
Expected: Type-check passes. No existing code breaks because the field is optional.

**Commit:** `feat(agent): add ContextProvider type and optional contextProviders to AgentDependencies`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Update buildSystemPrompt to use context providers

**Verifies:** rate-limiter.AC3.1, rate-limiter.AC3.2, rate-limiter.AC3.3

**Files:**
- Modify: `src/agent/context.ts:17-19` (buildSystemPrompt function)
- Modify: `src/agent/agent.ts` (call site for buildSystemPrompt — pass contextProviders)

**Implementation:**

Update `buildSystemPrompt()` in `src/agent/context.ts` to accept an optional `contextProviders` parameter. When providers are present, call each one and append non-null results to the system prompt.

```typescript
export async function buildSystemPrompt(
  memory: MemoryManager,
  contextProviders?: ReadonlyArray<ContextProvider>,
): Promise<string> {
  let prompt = await memory.buildSystemPrompt();

  if (contextProviders) {
    for (const provider of contextProviders) {
      const section = provider();
      if (section !== undefined) {
        prompt += '\n\n' + section;
      }
    }
  }

  return prompt;
}
```

Add the import for `ContextProvider` at the top of `context.ts`:

```typescript
import type { ConversationMessage, ContextProvider } from './types.ts';
```

Update the call site in `src/agent/agent.ts`. Find where `buildSystemPrompt(deps.memory)` is called (line 91 inside the tool loop) and change it to:

```typescript
const systemPrompt = await buildSystemPrompt(deps.memory, deps.contextProviders);
```

Also check if `buildSystemPrompt` is called elsewhere in `agent.ts` and update those call sites too.

**Testing:**

Tests to write in `src/agent/context.test.ts` (create new test file):

- **rate-limiter.AC3.3:** Call `buildSystemPrompt(mockMemory)` with no context providers. Verify output equals `memory.buildSystemPrompt()` result exactly (no extra content appended).
- **rate-limiter.AC3.3:** Call `buildSystemPrompt(mockMemory, [])` with empty array. Same result — no extra content.
- **rate-limiter.AC3.1:** Call `buildSystemPrompt(mockMemory, [() => '## Resource Budget\nInput tokens: 1000/5000'])`. Verify the resource budget section is appended after the memory prompt.
- **rate-limiter.AC3.2:** Call `buildSystemPrompt` twice with a provider that returns different values each time (simulating consumption). Verify each call reflects the current provider output.
- Provider returning `null` is skipped — no extra newlines or empty sections.
- Multiple providers — all non-null sections are appended in order, separated by `\n\n`.

Mock `MemoryManager` with `buildSystemPrompt` returning a fixed string (e.g., `'You are the spirit.'`).

**Verification:**

Run: `bun test src/agent/context.test.ts`
Expected: All tests pass

Run: `bun test src/agent/`
Expected: All existing agent tests still pass

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(agent): wire context providers into system prompt assembly`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Update barrel exports

**Verifies:** None (infrastructure)

**Files:**
- Modify: `src/agent/index.ts:7` (type exports)

**Implementation:**

Add `ContextProvider` to the type exports in `src/agent/index.ts`:

```typescript
export type { Agent, AgentConfig, AgentDependencies, ConversationMessage, ExternalEvent, ContextProvider } from './types.ts';
```

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(agent): export ContextProvider type from barrel`

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
