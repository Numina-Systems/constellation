# TUI Implementation Plan — Phase 6: Entry Point and Flag Wiring

**Goal:** `--tui` flag starts the Ink application instead of the readline REPL.

**Architecture:** The composition root in `src/index.ts` checks `process.argv` for `--tui`. When present, it creates an event bus, injects it into the agent's dependencies, renders the Ink app, and skips the readline REPL setup. When absent (or in non-TTY environments), the existing readline REPL launches unchanged. The event bus is created in the composition root and passed down to both the agent and the TUI app.

**Tech Stack:** TypeScript, Bun, Ink

**Scope:** Phase 6 of 6 from original design

**Codebase verified:** 2026-04-04

**Codebase findings:**
- ✓ No existing CLI arg parsing in `src/index.ts` — will use simple `process.argv.includes('--tui')`
- ✓ REPL setup at `src/index.ts:1060-1102` — readline interface, `createInteractionLoop`, REPL event loop
- ✓ Agent creation at `src/index.ts:781-803` — all deps injected here
- ✓ Shutdown handler at `src/index.ts:1073-1083` — needs equivalent for TUI mode
- ✓ `main()` function wraps everything, called at `src/index.ts:1106`

---

## Acceptance Criteria Coverage

This phase implements and tests:

### tui.AC8: Entry point flag
- **tui.AC8.1 Success:** `--tui` flag launches Ink interface
- **tui.AC8.2 Success:** No flag launches existing readline REPL unchanged
- **tui.AC8.3 Edge:** `--tui` in non-TTY environment falls back gracefully

---

<!-- START_TASK_1 -->
### Task 1: Add --tui flag detection and event bus creation

**Verifies:** tui.AC8.1, tui.AC8.2, tui.AC8.3

**Files:**
- Modify: `src/index.ts:781-803` (agent creation — add eventBus)
- Modify: `src/index.ts:1060-1102` (REPL setup — conditional on flag)

**Implementation:**

Add flag detection near the top of the `main()` function:

```typescript
const useTui = process.argv.includes('--tui');
```

Add TTY detection for graceful fallback:

```typescript
const isTty = process.stdout.isTTY === true;
const shouldUseTui = useTui && isTty;

if (useTui && !isTty) {
  console.warn('--tui flag ignored: not running in a TTY environment, falling back to REPL');
}
```

Create event bus conditionally before agent creation:

```typescript
import { createAgentEventBus } from '@/tui';
import type { AgentEventBus } from '@/tui';

const eventBus: AgentEventBus | undefined = shouldUseTui ? createAgentEventBus() : undefined;
```

Add `eventBus` to the agent creation call at line ~781:

```typescript
const agent = createAgent({
  // ... existing deps ...
  eventBus,  // undefined when not in TUI mode — agent ignores it
}, mainConversationId);
```

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

Run: `bun test`
Expected: All existing tests pass

**Commit:** `feat(tui): add --tui flag detection and conditional event bus creation`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Wire TUI app launch as alternative to REPL

**Verifies:** tui.AC8.1, tui.AC8.2

**Files:**
- Modify: `src/index.ts:1060-1102` (replace REPL section with conditional)

**Implementation:**

Replace the REPL setup section (lines 1060-1102) with a conditional branch:

```typescript
if (shouldUseTui) {
  // TUI mode: render Ink application
  const { renderApp, createMutationPromptViaBus } = await import('@/tui');

  const { waitUntilExit } = renderApp({
    agent,
    bus: eventBus!,
    modelName: config.model.name,
    memory,
  });

  // Set up graceful shutdown for TUI — must clean up all resources
  // (same as REPL shutdown handler: schedulers, data sources, activity manager, persistence)
  const schedulerWrapper = {
    stop: () => {
      agentScheduler.stop();
      systemScheduler.stop();
    },
  };

  const tuiShutdown = async () => {
    schedulerWrapper.stop();
    if (dataSourceRegistry) {
      await dataSourceRegistry.disconnectAll();
    }
    if (activityManager) {
      activityManager.stop();
    }
    await persistence.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', tuiShutdown);
  process.on('SIGTERM', tuiShutdown);

  await waitUntilExit();
} else {
  // REPL mode: existing readline interface (unchanged)
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const interactionHandler = createInteractionLoop({
    agent,
    memory,
    persistence,
    readline: rl,
  });

  const schedulerWrapper = {
    stop: () => {
      agentScheduler.stop();
      systemScheduler.stop();
    },
  };
  const shutdownHandler = createShutdownHandler(rl, persistence, dataSourceRegistry, schedulerWrapper, activityManager);

  process.on('SIGINT', shutdownHandler);
  process.on('SIGTERM', shutdownHandler);

  console.log('Type your message (press Ctrl+C to exit):\n');

  rl.setPrompt('> ');
  rl.on('line', async (line: string) => {
    const trimmed = line.trim();
    if (trimmed) {
      try {
        await interactionHandler(trimmed);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`error: ${errorMsg}`);
      }
    }
    rl.prompt();
  });

  rl.prompt();
}
```

Note the dynamic `import('@/tui')` — this avoids loading React/Ink when running in REPL mode, keeping the REPL path lightweight.

The `AppProps` type needs to include `memory` (for mutation processing in Phase 5). Update the import and type if not already done.

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

Run: `bun run start` (without --tui)
Expected: Existing REPL launches unchanged

Run: `bun run start --tui`
Expected: Ink TUI launches

**Commit:** `feat(tui): wire TUI app launch as alternative to REPL`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Add detect module and barrel export update

**Verifies:** None (infrastructure)

**Files:**
- Create: `src/tui/detect.ts`
- Modify: `src/tui/index.ts`

**Implementation:**

Create `src/tui/detect.ts` with `// pattern: Functional Core` annotation.

Implement the pure detection function:

```typescript
function detectTuiMode(argv: ReadonlyArray<string>, isTty: boolean): { useTui: boolean; warning: string | null }
```

- If `argv` includes `--tui` and `isTty` is true: return `{ useTui: true, warning: null }`
- If `argv` includes `--tui` and `isTty` is false: return `{ useTui: false, warning: '--tui flag ignored: not running in a TTY environment, falling back to REPL' }`
- If `argv` does not include `--tui`: return `{ useTui: false, warning: null }`

Update barrel export to include `detectTuiMode`:

```typescript
export { detectTuiMode } from './detect.ts';
```

**Verification:**
Run: `bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(tui): add TUI mode detection and finalize exports`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Entry point detection tests

**Verifies:** tui.AC8.1, tui.AC8.2, tui.AC8.3

**Files:**
- Create: `src/tui/detect.test.ts`

**Testing:**

These tests verify the flag detection and fallback logic by testing the pure `detectTuiMode` function from `src/tui/detect.ts` (created in Task 3).

- **tui.AC8.1:** Call `detectTuiMode(['node', 'start', '--tui'], true)`. Verify `useTui` is true and `warning` is null.
- **tui.AC8.2:** Call `detectTuiMode(['node', 'start'], true)`. Verify `useTui` is false and `warning` is null.
- **tui.AC8.3:** Call `detectTuiMode(['node', 'start', '--tui'], false)`. Verify `useTui` is false and `warning` contains a message about non-TTY fallback.

**Verification:**
Run: `bun test src/tui/detect.test.ts`
Expected: All tests pass

**Commit:** `test(tui): add entry point flag detection tests`
<!-- END_TASK_4 -->
