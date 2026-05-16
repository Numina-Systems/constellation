# Batch-Anchored Snapshots Implementation Plan

**Goal:** Wire snapshot computation and user message composition into the agent loop. Classify existing providers as dynamic. Ensure compaction compatibility and backward compatibility with existing conversations.
**Architecture:** Imperative Shell changes in the agent loop and composition root. Creates `SnapshotState` in agent initialization, computes snapshots each tool round with dynamic providers, passes results to `buildUserMessage`, and resets snapshot state after compaction. All existing context providers are classified as dynamic since the only truly stable content is the core memory blocks from `memory.buildSystemPrompt()`.
**Tech Stack:** Bun, TypeScript 5.7+, Anthropic SDK
**Scope:** Phase 4 of 4
**Codebase verified:** 2026-05-15

---

## Acceptance Criteria Coverage

This phase implements and tests:

### batch-anchored-snapshots.AC5: Backward Compatibility
- **batch-anchored-snapshots.AC5.1 Success:** Persisted conversation messages with attachment content blocks load correctly on replay
- **batch-anchored-snapshots.AC5.2 Success:** Existing conversations without attachment content blocks continue to work (no migration required)
- **batch-anchored-snapshots.AC5.3 Success:** ContextProvider interface (`() => string | undefined`) is unchanged — providers don't need modification
- **batch-anchored-snapshots.AC5.4 Success:** Compaction pipeline can process messages containing attachment content blocks (treats them as regular text for summarization purposes)

### batch-anchored-snapshots.AC6: Agent Loop Integration
- **batch-anchored-snapshots.AC6.1 Success:** `buildMessages()` composes the user message with dynamic context attachments before sending to the model
- **batch-anchored-snapshots.AC6.2 Success:** Snapshot state (previous hashes) is maintained across tool rounds within a single turn
- **batch-anchored-snapshots.AC6.3 Success:** Snapshot state resets after compaction (forces full snapshot on next turn)

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Wire snapshot state into agent loop

**Verifies:** batch-anchored-snapshots.AC6.1, batch-anchored-snapshots.AC6.2, batch-anchored-snapshots.AC6.3

**Files:**
- Modify: `src/agent/agent.ts`

**Implementation:**

Changes to `createAgent()` in `src/agent/agent.ts`:

1. **Import snapshot and message modules:**
```typescript
import { createSnapshotState } from './snapshot.ts';
import { buildUserMessage } from './messages.ts';
```

2. **Create snapshot state in agent initialization** (inside `createAgent`, before the returned object):
```typescript
const snapshotState = createSnapshotState();
```

3. **Build dynamic providers map from classified providers** — Add a helper that extracts dynamic providers from `deps.classifiedProviders` into the `ReadonlyMap<string, () => string | undefined>` format that `computeSnapshot` expects. **Compute this once before the tool loop**, not inside it (the classified providers don't change between rounds):

```typescript
function buildDynamicProviderMap(
  classified: ReadonlyArray<ClassifiedProvider> | undefined,
): ReadonlyMap<string, () => string | undefined> {
  if (!classified) return new Map();
  const map = new Map<string, () => string | undefined>();
  for (const cp of classified) {
    if (cp.classification === 'dynamic') {
      map.set(cp.name, cp.provider);
    }
  }
  return map;
}

// Before the tool loop:
const dynamicProviders = buildDynamicProviderMap(deps.classifiedProviders);
```

4. **In the tool loop** (around line 208-216 where `model.complete()` is called), insert snapshot computation and user message composition:

   Before the model call:
   ```typescript
   // Compute snapshot — first round forces full, subsequent rounds detect delta/noop
   const isFirstRound = round === 0;
   const snapshotResult = snapshotState.computeSnapshot(dynamicProviders, isFirstRound);
   ```

   The `forceFullSnapshot` parameter is `true` on the first tool round of each turn. This ensures the model always sees full dynamic context at the start of a new user message, even if the content hasn't changed since the last turn. On subsequent tool rounds within the same turn, delta/noop detection applies normally (AC6.2).

   Modify the message array construction. Currently the last message in the array is the user's raw text. Replace it with the composed message:
   ```typescript
   // Replace the last user message with the snapshot-composed version
   const composedUserMessage = buildUserMessage(userText, snapshotResult);
   ```

   The exact integration point depends on how messages are currently built. The key change: instead of passing the raw user text as the last message, pass the `composedUserMessage` which may have a content array with the dynamic context attachment prepended.

5. **Reset after compaction** (around lines 126-129 where compaction fires):
   ```typescript
   // After compaction completes:
   snapshotState.reset();
   ```

   This ensures the next tool round produces a full snapshot (AC6.3), since the model's conversation history has been compressed and it needs the full dynamic context again.

6. **Fallback behavior:** If `deps.classifiedProviders` is not provided (backward compat), the dynamic provider map is empty, `computeSnapshot` returns noop (no providers to evaluate), and `buildUserMessage` returns the plain user text. This means the agent behaves identically to pre-feature behavior when classified providers aren't configured.

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation && bun run build`
Expected: Type-check passes

**Commit:** `feat(agent): wire snapshot computation into agent tool loop`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Classify providers in composition root

**Verifies:** batch-anchored-snapshots.AC5.3

**Files:**
- Modify: `src/index.ts`

**Implementation:**

In the composition root (`src/index.ts`, around lines 477-913 where context providers are constructed), classify all existing providers as dynamic and pass them via `classifiedProviders` on `AgentDependencies`.

All context providers are dynamic because they produce content that changes between turns. The only stable content is the persona/core memory blocks, which come from `memory.buildSystemPrompt()` and are already handled by the `buildSystemPrompt` function directly.

Current providers to classify (all as `'dynamic'`):
1. Rate limit context provider → `{ name: 'rate-limit', provider: rateLimitProvider, classification: 'dynamic' }`
2. MCP instructions providers → `{ name: 'mcp-<serverName>', provider: mcpProvider, classification: 'dynamic' }` (one per server)
3. Activity context provider → `{ name: 'activity', provider: activityProvider, classification: 'dynamic' }`
4. Recall context provider → `{ name: 'recall', provider: recallProvider, classification: 'dynamic' }`
5. Prediction context provider → `{ name: 'prediction', provider: predictionProvider, classification: 'dynamic' }`
6. Scheduling context provider → `{ name: 'scheduling', provider: schedulingProvider, classification: 'dynamic' }`
7. Subconscious context provider → `{ name: 'subconscious', provider: subconsciousProvider, classification: 'dynamic' }`
8. Introspection context provider → `{ name: 'introspection', provider: introspectionProvider, classification: 'dynamic' }`

**Skills injection:** Skills are currently injected inline in the agent loop (lines 173-186) via direct string concatenation to `systemPrompt`, bypassing the `ContextProvider` interface. To route skills through the snapshot pipeline, wrap skill injection as a cached dynamic provider using the same pattern as `recallContextState`:

1. Create a `SkillContextState` similar to `RecallContextState` — holds the last skill injection result
2. In the agent loop, after `skills.getRelevant()` completes (async), call `skillContextState.setResult(skillSection)` 
3. Register `{ name: 'skills', provider: skillContextState, classification: 'dynamic' }`
4. Remove the inline `systemPrompt += '\n\n' + skillSection` concatenation

This ensures skill changes don't bust the system prompt cache. Without this change, skills would still mutate the system prompt each turn, partially defeating the cache-stability goal.

Build the classified array:
```typescript
const classifiedProviders: Array<ClassifiedProvider> = [
  { name: 'rate-limit', provider: rateLimitProvider, classification: 'dynamic' },
  // ... etc for each provider
];
```

Pass to agent dependencies:
```typescript
const deps: AgentDependencies = {
  // ... existing fields ...
  classifiedProviders,
  // Keep contextProviders for any code that still references it during transition
  contextProviders: classifiedProviders.map(cp => cp.provider),
};
```

Actually, after Phase 3, `contextProviders` is no longer consumed by `buildSystemPrompt`. It may still be referenced elsewhere in `agent.ts` — check for other usages. If no other code reads `contextProviders`, it can be omitted. If other code does read it, keep passing it for backward compat and mark it for removal in a follow-up cleanup.

The `ContextProvider` interface (`() => string | undefined`) is unchanged (AC5.3). Individual providers are not modified — they don't know they've been classified. Classification is purely a composition concern.

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation && bun run build`
Expected: Type-check passes

**Commit:** `feat: classify all context providers as dynamic in composition root`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->
<!-- START_TASK_3 -->
### Task 3: Verify compaction compatibility

**Verifies:** batch-anchored-snapshots.AC5.4

**Files:**
- Read (verify only): `src/compaction/compactor.ts`
- Optionally create: `src/agent/snapshot-compat.test.ts`

**Implementation:**

Verify that the compaction pipeline handles messages with multi-block content arrays. The compactor processes `ConversationMessage` objects, which store `content` as a string. When messages with content block arrays are persisted, the persistence layer serializes them — the `content` field in `ConversationMessage` is always a string.

Check the following:
1. `ConversationMessage.content` is typed as `string` in `src/agent/types.ts` — confirmed from investigation. This means persisted user messages with content block arrays are stored as serialized JSON strings or as the concatenated text (depending on how the persistence layer handles them).
2. The compactor operates on `ConversationMessage` strings, not raw Anthropic `Message` objects. So content block arrays are already flattened to strings by the time compaction sees them.

If the persistence layer stores user message content as a plain string (the text content, not the JSON array), then attachment blocks are naturally included in the stored text and compaction handles them as regular text content. This is the most likely case based on the codebase patterns.

If the persistence layer stores the raw content array as JSON, verify the compactor's summarization prompt handles this gracefully (it should, since it processes text content).

Write a focused compatibility test:

```typescript
describe('AC5.4: Compaction compatibility with attachment blocks', () => {
  test('messages with multi-block content arrays are processed by compaction', () => {
    // Create a ConversationMessage with content that includes attachment text
    // (as it would appear after persistence round-trip)
    const messageWithAttachment: ConversationMessage = {
      id: 'test-1',
      conversation_id: 'conv-1',
      role: 'user',
      content: '[Dynamic Context — Full Snapshot]\n\n## Recall\nSome context\n\nHello, how are you?',
      created_at: new Date(),
    };
    
    // Verify estimateTokens handles it (used by shouldCompress)
    const tokens = estimateTokens(messageWithAttachment.content);
    expect(tokens).toBeGreaterThan(0);
    
    // Verify shouldCompress doesn't choke on it
    const result = shouldCompress([messageWithAttachment], 0.5, 100000, 0);
    expect(typeof result).toBe('boolean');
  });
});
```

If the persistence layer stores content arrays as JSON, add a test verifying the compactor extracts text from the JSON structure. But based on the `ConversationMessage` type having `content: string`, this should not be needed.

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation && bun test src/agent/snapshot-compat.test.ts`
Expected: All tests pass

**Commit:** `test(agent): verify compaction compatibility with attachment content blocks`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Backward compatibility verification tests

**Verifies:** batch-anchored-snapshots.AC5.1, batch-anchored-snapshots.AC5.2

**Files:**
- Add tests to: `src/agent/snapshot-compat.test.ts` (same file as Task 3)

**Implementation:**

Add tests verifying that `buildMessages()` in `src/agent/context.ts` correctly handles both old-format messages (plain string content) and new-format messages (content array with attachment blocks):

**`describe('AC5: Backward Compatibility')`:**

- **AC5.1 — messages with content arrays load correctly:** Create a mock conversation history containing a user message whose content was persisted with an attachment block (as a string containing the attachment text). Pass through `buildMessages()`. Verify the output message preserves the content.

- **AC5.2 — old messages without attachments still work:** Create a mock conversation history with plain string content user messages (no attachments). Pass through `buildMessages()`. Verify output is identical to pre-feature behavior.

- **AC5.3 — ContextProvider interface unchanged (compile-time check):** Write a test that creates a `ContextProvider` using the existing `() => string | undefined` signature. Verify it type-checks. This is a compile-time guarantee — if it compiles, AC5.3 is satisfied.

```typescript
test('AC5.3: ContextProvider interface is unchanged', () => {
  const provider: ContextProvider = () => 'some context';
  expect(provider()).toBe('some context');
  
  const undefinedProvider: ContextProvider = () => undefined;
  expect(undefinedProvider()).toBeUndefined();
});
```

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation && bun test src/agent/snapshot-compat.test.ts`
Expected: All tests pass

**Commit:** `test(agent): verify backward compatibility for existing conversations`
<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_5 -->
### Task 5: Full integration verification

**Verifies:** All ACs (integration-level)

**Files:**
- No new files — verification only

**Implementation:**

Run the full test suite and type-checker to confirm nothing is broken:

1. Type-check the entire project
2. Run all tests
3. Verify no regressions in existing test files

Specifically verify:
- `buildSystemPrompt` no longer includes dynamic provider output (AC1)
- `buildUserMessage` produces correct message structure (AC2)
- `computeSnapshot` detects full/delta/noop correctly (AC3)
- `Bun.hash()` is used for per-provider hashing (AC4)
- Existing conversations and compaction are unaffected (AC5)
- Agent loop computes snapshots and resets after compaction (AC6)

**Verification:**
Run:
```bash
cd /Users/scarndp/dev/numina-systems/constellation && bun run build && bun test
```
Expected: Type-check passes, all tests pass

**Commit:** No commit — verification only
<!-- END_TASK_5 -->
