# Batch-Anchored Snapshots Design

## Summary

Constellation injects dynamic context (memory snapshots, recall results, skill injections) as synthetic system messages or system prompt sections that change every turn. Every time this content changes, the "system prompt" identity shifts from Anthropic's prompt-caching perspective, busting the cache and forcing re-tokenization of the entire prefix. This is expensive — system prompts with tools and memory context can be 10-20K tokens, and re-processing them on every turn wastes both latency and money.

The fix is architectural: separate *stable* context (system prompt, tool definitions, persona) from *dynamic* context (recall results, memory snapshots, skill injections, scheduling context). Stable context stays in the system prompt and remains cache-friendly across turns. Dynamic context attaches to the user message that opens each model call batch as structured attachments, riding alongside the user's actual input. This way the system prompt hash stays constant between turns (assuming tools don't change), and dynamic content is positioned after the cached prefix where it doesn't affect cache identity.

Additionally, snapshots use content hashing to detect actual changes: a Full snapshot is sent on the first turn or after compaction, and Delta snapshots (only changed content) are sent on subsequent turns when content has actually changed. No-op turns where nothing changed skip attachment entirely.

Ported from Pattern's `MessageAttachment` design, adapted for Constellation's `ContextProvider` pattern, `buildMessages()` flow, and Anthropic SDK message format.

## Definition of Done

1. Dynamic context providers no longer contribute to the system prompt. Their output attaches to the batch-opening user message instead.
2. The system prompt content is stable between turns when tool definitions and persona haven't changed.
3. Snapshots use content hashing to distinguish full vs delta vs no-op, minimizing redundant tokens.
4. Existing conversation persistence stores attachments alongside user messages without schema changes (attachments are part of the message content array).
5. All existing context providers continue to function — their output is rerouted, not removed.

## Acceptance Criteria

### batch-anchored-snapshots.AC1: System Prompt Stability
- **batch-anchored-snapshots.AC1.1 Success:** System prompt content hash is identical between consecutive turns when tools and persona haven't changed
- **batch-anchored-snapshots.AC1.2 Success:** Adding/removing a tool changes the system prompt hash (expected cache bust)
- **batch-anchored-snapshots.AC1.3 Success:** Changing memory content does NOT change the system prompt hash
- **batch-anchored-snapshots.AC1.4 Success:** Changing recall results does NOT change the system prompt hash
- **batch-anchored-snapshots.AC1.5 Edge:** First turn with no dynamic context produces a user message with no attachments

### batch-anchored-snapshots.AC2: Attachment Composition
- **batch-anchored-snapshots.AC2.1 Success:** Dynamic context from all providers is collected into a single structured attachment block
- **batch-anchored-snapshots.AC2.2 Success:** Attachment block is prepended to the user message's content array as a `text` content block
- **batch-anchored-snapshots.AC2.3 Success:** User's actual message text remains the final content block in the array
- **batch-anchored-snapshots.AC2.4 Success:** Empty dynamic context (all providers return `undefined`) produces no attachment block
- **batch-anchored-snapshots.AC2.5 Failure:** Attachment content never appears in the system prompt string

### batch-anchored-snapshots.AC3: Snapshot Modes
- **batch-anchored-snapshots.AC3.1 Success:** First turn of a conversation produces a Full snapshot (all dynamic context included)
- **batch-anchored-snapshots.AC3.2 Success:** Turn immediately after compaction produces a Full snapshot
- **batch-anchored-snapshots.AC3.3 Success:** Subsequent turns produce a Delta snapshot containing only sections whose content hash changed
- **batch-anchored-snapshots.AC3.4 Success:** Turn where no dynamic content changed produces no attachment (no-op)
- **batch-anchored-snapshots.AC3.5 Edge:** Single provider changing while others stay constant produces a delta with only that provider's section

### batch-anchored-snapshots.AC4: Content Hashing
- **batch-anchored-snapshots.AC4.1 Success:** Content hash uses a fast non-cryptographic hash (Bun's native `Bun.hash()` or equivalent)
- **batch-anchored-snapshots.AC4.2 Success:** Hash is computed per-provider, not on the aggregate output
- **batch-anchored-snapshots.AC4.3 Success:** Identical content across turns produces identical hashes (deterministic)
- **batch-anchored-snapshots.AC4.4 Edge:** Empty string and `undefined` produce distinct hash values (no collision on absence vs empty)

### batch-anchored-snapshots.AC5: Backward Compatibility
- **batch-anchored-snapshots.AC5.1 Success:** Persisted conversation messages with attachment content blocks load correctly on replay
- **batch-anchored-snapshots.AC5.2 Success:** Existing conversations without attachment content blocks continue to work (no migration required)
- **batch-anchored-snapshots.AC5.3 Success:** ContextProvider interface (`() => string | undefined`) is unchanged — providers don't need modification
- **batch-anchored-snapshots.AC5.4 Success:** Compaction pipeline can process messages containing attachment content blocks (treats them as regular text for summarization)

### batch-anchored-snapshots.AC6: Agent Loop Integration
- **batch-anchored-snapshots.AC6.1 Success:** `buildMessages()` composes the user message with dynamic context attachments before sending to the model
- **batch-anchored-snapshots.AC6.2 Success:** Snapshot state (previous hashes) is maintained across tool rounds within a single turn
- **batch-anchored-snapshots.AC6.3 Success:** Snapshot state resets after compaction (forces full snapshot on next turn)

## Glossary

- **ContextProvider**: A function `() => string | undefined` registered in `AgentDependencies.contextProviders`. Currently outputs are appended to the system prompt. This feature reroutes their output to user message attachments instead.
- **Batch-opening user message**: The user message that starts each model call. In Anthropic's API, the prompt cache covers the prefix up to (but not including) the last message. Dynamic context attached to this message sits outside the cached prefix.
- **Full snapshot**: A snapshot that includes all dynamic context provider outputs, regardless of whether they changed. Sent on first turn and after compaction.
- **Delta snapshot**: A snapshot that includes only the dynamic context sections whose content hash changed since the last snapshot. Reduces redundant tokens on stable turns.
- **No-op**: A turn where no dynamic content changed at all. No attachment is produced.
- **Content hash**: A fast non-cryptographic hash (via `Bun.hash()`) of each provider's output, used to detect changes between turns.
- **`buildMessages()`**: The function in the agent loop that constructs the message array for `model.complete()`. Being modified to compose user messages with dynamic context attachments.
- **Content block**: Anthropic's message format allows a message to contain an array of typed content blocks (`text`, `image`, `tool_use`, etc.). Attachments are injected as `text` content blocks prepended to the user message's content array.
- **Prompt cache**: Anthropic's server-side cache that reuses tokenized prefixes across turns. Cache key is based on the content identity of the prefix (system prompt + tools + message history up to the last message). Changing any prefix byte busts the cache.

## Architecture

The core insight is a separation of concerns: stable context (persona, capabilities, tool definitions) stays in the system prompt where it's cache-friendly; dynamic context (memory, recall, skills, scheduling) moves to the user message where it doesn't affect cache identity.

### Current Flow (Cache-Hostile)

```
System Prompt
├── Persona / instructions          (stable)
├── Core memory blocks              (changes on memory write)
├── Recalled context section        (changes every turn)
├── Skill injections                (changes every turn)
└── Scheduling context              (changes on schedule events)

Messages[]
├── ... history ...
└── User message (text only)
```

Every dynamic section change busts the system prompt cache.

### New Flow (Cache-Friendly)

```
System Prompt
├── Persona / instructions          (stable)
└── Capability declarations         (stable unless tools change)

Messages[]
├── ... history ...
└── User message
    ├── [Dynamic Context Attachment] (text content block)
    │   ├── ## Core Memory
    │   ├── ## Recalled Context
    │   ├── ## Active Skills
    │   └── ## Recent Activity
    └── [User Text]                 (text content block)
```

System prompt is stable. Dynamic content rides on the user message.

### Components

**SnapshotState** (`src/agent/snapshot.ts`, Functional Core) — Tracks per-provider content hashes from the previous turn. Exposes `computeSnapshot(providers)` which evaluates all dynamic context providers, hashes each output, compares against previous hashes, and returns a `SnapshotResult` indicating mode (full/delta/noop) and the content to attach.

**buildUserMessage** (`src/agent/messages.ts`, Functional Core) — Takes the raw user message text and an optional `SnapshotResult`, returns a properly structured Anthropic message with content blocks. If snapshot is full or delta, prepends a text content block with the formatted dynamic context. If noop or absent, returns the user message as-is.

**System prompt builder** (`src/agent/context.ts`, modified) — Stops evaluating dynamic context providers for system prompt construction. Only includes stable content: persona, capability declarations, and any static instructions. Dynamic providers are evaluated separately by SnapshotState.

**Provider classification** — Context providers are classified as `stable` (included in system prompt) or `dynamic` (routed to attachments). This classification lives in the composition root where providers are registered, not in the providers themselves. The `ContextProvider` interface is unchanged.

### Contracts

```typescript
// src/agent/snapshot.ts

type SnapshotMode = 'full' | 'delta' | 'noop';

type SnapshotResult = {
  readonly mode: SnapshotMode;
  readonly content: string | null;   // null for noop
  readonly hashes: ReadonlyMap<string, number>;
  readonly changedProviders: ReadonlyArray<string>;
};

type SnapshotState = {
  computeSnapshot(
    providers: ReadonlyMap<string, () => string | undefined>,
    forceFullSnapshot: boolean,
  ): SnapshotResult;
  reset(): void;
};

function createSnapshotState(): SnapshotState;
```

```typescript
// src/agent/messages.ts

function buildUserMessage(
  text: string,
  snapshot: SnapshotResult | null,
): AnthropicMessage;
```

### Data Flow in Agent Loop

Position in `processMessage()` (src/agent/agent.ts):

1. User message persisted *(existing)*
2. Load conversation history *(existing)*
3. Compaction check — if over budget, compress *(existing)*
   - If compaction fired: `snapshotState.reset()` (forces full snapshot next)
4. **Tool loop begins** *(existing)*
   - Build stable system prompt (persona + capabilities only) *(modified)*
   - Recall step — updates recall context provider state *(existing)*
   - Skill injection — updates skill context provider state *(existing)*
   - **Snapshot step** *(new)*
     - `snapshotState.computeSnapshot(dynamicProviders, isFirstRound)`
     - Returns `SnapshotResult` with mode and content
   - **Build user message with attachment** *(modified)*
     - `buildUserMessage(userText, snapshotResult)`
   - Pre-flight guard *(existing)*
   - Call model *(existing)*

### Hashing Strategy

Each dynamic provider's output is hashed independently using `Bun.hash()` (wyhash, non-cryptographic, fast). The hash map is keyed by provider name (e.g., `"recall"`, `"memory"`, `"skills"`, `"scheduling"`).

On first turn or after compaction reset, all providers are included regardless of hash comparison (full snapshot). On subsequent turns, only providers whose hash differs from the previous turn are included (delta). If no hashes changed, mode is `noop` and no attachment is produced.

## Existing Patterns

- **ContextProvider interface** — `() => string | undefined` from `src/agent/types.ts`. This interface is preserved; providers are unmodified. The change is in how their output is consumed.
- **Functional Core / Imperative Shell** — `SnapshotState` and `buildUserMessage` are pure (Functional Core). Agent loop orchestration is Imperative Shell.
- **Factory functions** — `createSnapshotState()` returns the `SnapshotState` interface. No classes.
- **Content block composition** — Anthropic SDK supports `content: Array<TextBlock>` on user messages. This is the standard way to attach structured content alongside user text.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Snapshot State and Hashing

**Goal:** Implement per-provider content hashing and snapshot mode detection (full/delta/noop).

**Components:**
- `src/agent/snapshot.ts` (Functional Core) — `createSnapshotState()` factory, `SnapshotResult` type, hashing logic using `Bun.hash()`
- `src/agent/snapshot.test.ts` — Unit tests: first call is always full, subsequent calls with same content are noop, single provider change produces delta, `reset()` forces full on next call, empty/undefined handling

**Dependencies:** None

**Covers:** batch-anchored-snapshots.AC3 (snapshot modes), batch-anchored-snapshots.AC4 (content hashing)

**Done when:** `computeSnapshot()` correctly identifies full/delta/noop modes based on provider output hashes. Hash is deterministic. Reset forces full. All tests pass.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: User Message Composition

**Goal:** Build user messages with dynamic context attachment content blocks.

**Components:**
- `src/agent/messages.ts` (Functional Core) — `buildUserMessage()` function that composes the Anthropic message with optional attachment block
- `src/agent/messages.test.ts` — Unit tests: full snapshot prepends content block, delta prepends only changed sections, noop produces no extra block, user text is always the last content block, empty snapshot content produces no block

**Dependencies:** Phase 1 (consumes `SnapshotResult`)

**Covers:** batch-anchored-snapshots.AC2 (attachment composition)

**Done when:** User messages are correctly composed with dynamic context as leading text content blocks. User text is always last. No attachment on noop. All tests pass.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: System Prompt Separation

**Goal:** Split context providers into stable (system prompt) and dynamic (attachment) groups. Remove dynamic provider output from system prompt construction.

**Components:**
- `src/agent/context.ts` — Modify system prompt builder to only include stable providers. Add provider classification support (stable vs dynamic)
- `src/agent/types.ts` — Add `ProviderClassification` type (`'stable' | 'dynamic'`) to provider registration
- `src/agent/context.test.ts` — Unit tests: system prompt excludes dynamic providers, system prompt hash unchanged when dynamic content changes, stable providers still appear in system prompt

**Dependencies:** None (independent of Phases 1-2)

**Covers:** batch-anchored-snapshots.AC1 (system prompt stability)

**Done when:** System prompt hash is stable across turns when only dynamic context changes. Dynamic providers are still evaluated but their output is excluded from the system prompt. All tests pass.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Agent Loop Integration

**Goal:** Wire snapshot computation and user message composition into the agent loop. Classify existing providers. Ensure compaction compatibility.

**Components:**
- `src/agent/agent.ts` — Insert snapshot step in tool loop. Call `computeSnapshot()` with dynamic providers, pass result to `buildUserMessage()`. Reset snapshot state after compaction. Cache snapshot across tool rounds within a turn.
- `src/index.ts` — Classify existing context providers: recall, skills, scheduling, prediction as `dynamic`; persona/static instructions as `stable`. Pass dynamic providers to snapshot state.
- `src/compaction/compactor.ts` — Verify compaction handles messages with multi-block content arrays (attachment blocks treated as regular text for summarization purposes)

**Dependencies:** Phases 1, 2, 3

**Covers:** batch-anchored-snapshots.AC5 (backward compatibility), batch-anchored-snapshots.AC6 (agent loop integration)

**Done when:** Dynamic context is injected via user message attachments, not system prompt. System prompt is stable between turns. Compaction handles attachment blocks. Existing conversations load correctly. Build succeeds (`bun run build`). All tests pass.
<!-- END_PHASE_4 -->

## Additional Considerations

**Anthropic cache semantics.** Anthropic's prompt caching caches the tokenized prefix — everything before the last message in the conversation. By keeping the system prompt stable and attaching dynamic content to the last user message, we maximize cache hits on the prefix. The dynamic content is tokenized fresh each turn, but it's typically 2-8K tokens vs 15-30K for the full system prompt + tool definitions.

**Multi-block message persistence.** Constellation persists messages as JSONB. Messages with content arrays (multiple text blocks) serialize naturally. No schema migration is needed — the existing `content` column already stores the full Anthropic message structure.

**Provider classification is a composition concern.** Individual providers don't know or care whether they're stable or dynamic. Classification happens in the composition root (`src/index.ts`) when providers are registered. This keeps the `ContextProvider` interface unchanged and avoids modifying existing provider implementations.

**Delta snapshots and model comprehension.** Delta snapshots only include changed sections, which means the model sees partial context on non-first turns. This is acceptable because: (a) the model has seen the full context on the first turn or after compaction, (b) unchanged context is still present in earlier messages in the conversation history, and (c) the delta explicitly labels which sections are included. If this causes comprehension issues in practice, the delta strategy can be disabled in favour of always-full snapshots with a config flag.
