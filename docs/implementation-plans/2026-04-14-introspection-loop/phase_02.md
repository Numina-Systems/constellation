# Introspection Loop Implementation Plan - Phase 2: Introspection Assembler

**Goal:** Imperative shell that gathers context from persistence, memory store, and interest registry, then delegates to the Phase 1 event builder

**Architecture:** Follows the `createImpulseAssembler()` factory pattern from `src/subconscious/impulse-assembler.ts`. The introspection assembler diverges by querying raw conversation messages from the `messages` table via `PersistenceProvider.query()` (a new data source for the subconscious module) and reading the digest block by label via `MemoryStore.getBlockByLabel()` rather than semantic search.

**Tech Stack:** TypeScript, Bun, Zod, bun:test

**Scope:** 4 phases from original design (phase 2 of 4)

**Codebase verified:** 2026-04-14

---

## Acceptance Criteria Coverage

This phase implements and tests:

### introspection-loop.AC1: Introspection event fires periodically with correct context
- **introspection-loop.AC1.3 Success:** Event contains `[Current State]` section with active interests and last digest content
- **introspection-loop.AC1.6 Edge:** Empty conversation window (no messages in lookback period) produces event with empty review section, not an error

### introspection-loop.AC3: No schema migrations required
- **introspection-loop.AC3.2 Success:** Conversation messages queried via existing `PersistenceProvider.query()` with no new tables or columns

### introspection-loop.AC4: Time-windowed review scope
- **introspection-loop.AC4.2 Success:** Config validates `introspection_lookback_hours` (min 1, max 72) and `introspection_offset_minutes` (min 1, max 30)

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Config schema additions

**Verifies:** introspection-loop.AC4.2

**Files:**
- Modify: `src/config/schema.ts:192-209` (SubconsciousConfigSchema)

**Implementation:**

Add two fields to the `SubconsciousConfigSchema` object, before the closing `.superRefine()`:

```typescript
const SubconsciousConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    inner_conversation_id: z.string().optional(),
    impulse_interval_minutes: z.number().min(5).max(120).default(20),
    max_tool_rounds: z.number().min(1).max(20).default(5),
    engagement_half_life_days: z.number().min(1).max(90).default(7),
    max_active_interests: z.number().min(1).max(50).default(10),
    introspection_offset_minutes: z.number().min(1).max(30).default(3),
    introspection_lookback_hours: z.number().min(1).max(72).default(24),
  })
  .superRefine((data, ctx) => {
    // ... existing superRefine unchanged
  });
```

Follow the existing pattern: `z.number().min(X).max(Y).default(Z)`.

**Verification:**
Run: `bun run build`
Expected: Type-check passes (the inferred `SubconsciousConfig` type will automatically include the new fields)

**Commit:** `feat(config): add introspection offset and lookback config fields`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Config validation tests

**Verifies:** introspection-loop.AC4.2

**Files:**
- Modify or create test covering SubconsciousConfigSchema validation

**Testing:**

Check if there's an existing config schema test file. If so, add tests there. If not, add tests in a new describe block.

Tests must verify:
- **introspection-loop.AC4.2 (defaults):** Parsing `{ enabled: false }` produces `introspection_offset_minutes: 3` and `introspection_lookback_hours: 24`
- **introspection-loop.AC4.2 (min bounds):** `introspection_offset_minutes: 0` fails validation. `introspection_lookback_hours: 0` fails validation.
- **introspection-loop.AC4.2 (max bounds):** `introspection_offset_minutes: 31` fails validation. `introspection_lookback_hours: 73` fails validation.
- **introspection-loop.AC4.2 (valid custom):** `introspection_offset_minutes: 5` and `introspection_lookback_hours: 48` both parse successfully.

Use the Zod `.safeParse()` method for validation tests, matching whatever pattern the existing config tests use.

**Verification:**
Run: `bun test src/config/`
Expected: All tests pass

**Commit:** `test(config): add introspection config validation tests`
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->

<!-- START_TASK_3 -->
### Task 3: IntrospectionAssembler type and factory

**Verifies:** introspection-loop.AC1.3, introspection-loop.AC1.6, introspection-loop.AC3.2

**Files:**
- Create: `src/subconscious/introspection-assembler.ts`

**Implementation:**

Create `src/subconscious/introspection-assembler.ts` with `// pattern: Imperative Shell` header.

Define dependencies type. The introspection assembler needs different deps than the impulse assembler because it queries raw messages (via `PersistenceProvider`) and reads a specific labeled block (via `MemoryStore.getBlockByLabel`):

```typescript
import { buildIntrospectionEvent } from './introspection';
import type { ExternalEvent } from '@/agent/types';
import type { InterestRegistry } from './types';
import type { PersistenceProvider } from '@/persistence/types';
import type { MemoryStore } from '@/memory/store';

type IntrospectionAssemblerDeps = {
  readonly persistence: PersistenceProvider;
  readonly interestRegistry: InterestRegistry;
  readonly memoryStore: MemoryStore;
  readonly owner: string;
  readonly subconsciousConversationId: string;
  readonly lookbackHours: number;
};

export type IntrospectionAssembler = {
  assembleIntrospection(): Promise<ExternalEvent>;
};
```

Implement `createIntrospectionAssembler`:

```typescript
type ReviewMessage = {
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: string;
  readonly created_at: Date;
};

export function createIntrospectionAssembler(
  deps: Readonly<IntrospectionAssemblerDeps>,
): IntrospectionAssembler {
  async function fetchRecentMessages(): Promise<ReadonlyArray<ReviewMessage>> {
    const since = new Date(Date.now() - deps.lookbackHours * 3600_000);
    const rows = await deps.persistence.query<{
      role: string;
      content: string;
      created_at: Date;
    }>(
      `SELECT role, content, created_at
       FROM messages
       WHERE conversation_id = $1
         AND role != 'tool'
         AND created_at >= $2
       ORDER BY created_at ASC`,
      [deps.subconsciousConversationId, since],
    );

    return rows.map((row) => ({
      role: row.role as ReviewMessage['role'],
      content: row.content,
      created_at: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
    }));
  }

  async function fetchCurrentDigest(): Promise<string | null> {
    const block = await deps.memoryStore.getBlockByLabel(deps.owner, 'introspection-digest');
    return block?.content ?? null;
  }

  async function assembleIntrospection(): Promise<ExternalEvent> {
    const [messages, interests, currentDigest] = await Promise.all([
      fetchRecentMessages(),
      deps.interestRegistry.listInterests(deps.owner, { status: 'active' }),
      fetchCurrentDigest(),
    ]);

    return buildIntrospectionEvent({
      messages,
      interests,
      currentDigest,
      timestamp: new Date(),
    });
  }

  return { assembleIntrospection };
}
```

Key design notes:
- SQL selects only `role`, `content`, `created_at` — the minimum columns needed for introspection review
- SQL filters out `role = 'tool'` at query time (AC1.5 enforcement at data layer)
- Time-window via `created_at >= $2` (AC4.1 enforcement at data layer)
- Uses existing `messages` table index `idx_messages_conversation_created` on `(conversation_id, created_at)`
- Reads digest block by label via `MemoryStore.getBlockByLabel()` (not `MemoryManager.read()` which is semantic search)
- Returns `null` for digest when block doesn't exist (first-run case)

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(subconscious): add introspection assembler`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Barrel export additions (Phase 1 + Phase 2 modules)

**Files:**
- Modify: `src/subconscious/index.ts`

**Implementation:**

Add exports for both the Phase 1 event builder and Phase 2 assembler modules. Phase 1 did not include a barrel export task, so this task handles barrel exports for both phases.

```typescript
export { buildIntrospectionEvent, buildIntrospectionCron } from './introspection.ts';
export type { IntrospectionContext } from './introspection.ts';
export { createIntrospectionAssembler } from './introspection-assembler.ts';
export type { IntrospectionAssembler } from './introspection-assembler.ts';
```

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(subconscious): export introspection modules from barrel`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Introspection assembler tests

**Verifies:** introspection-loop.AC1.3, introspection-loop.AC1.6, introspection-loop.AC3.2

**Files:**
- Create: `src/subconscious/introspection-assembler.test.ts`

**Testing:**

Follow the mock patterns from `impulse-assembler.test.ts`. Create mock factories for dependencies:
- `createMockPersistence()` — returns a `PersistenceProvider` with a `query()` that returns configurable message rows
- `createMockMemoryStore()` — returns a `MemoryStore` with `getBlockByLabel()` returning a configurable digest block
- Reuse `createMockInterestRegistry()` from `impulse-assembler.test.ts` (or duplicate the pattern)

Tests must verify:
- **introspection-loop.AC1.3:** `assembleIntrospection()` queries interests with `{ status: 'active' }` and includes them in the event. Verify the event contains the interest name from the mock registry.
- **introspection-loop.AC1.3 (digest):** When `getBlockByLabel('introspection-digest')` returns a block with content, the event's `[Last Digest]` section contains that content.
- **introspection-loop.AC1.6:** When `query()` returns zero message rows, the event is still produced (no error), and the `[Review]` section contains "No recent conversation to review."
- **introspection-loop.AC3.2:** `assembleIntrospection()` calls `persistence.query()` with SQL that includes `conversation_id = $1`, `role != 'tool'`, and `created_at >= $2`. Capture the SQL string and params to verify.

Additional tests:
- Verify `persistence.query()` receives `subconsciousConversationId` as the first param
- Verify the lookback window param is approximately `Date.now() - lookbackHours * 3600_000`
- Verify `getBlockByLabel` is called with `(owner, 'introspection-digest')`
- When `getBlockByLabel` returns `null`, event still produces (first-run case)
- Event source is `'subconscious:introspection'`
- Event metadata includes `messageCount`, `interestCount`, `hasExistingDigest`

**Verification:**
Run: `bun test src/subconscious/introspection-assembler.test.ts`
Expected: All tests pass

**Commit:** `test(subconscious): add introspection assembler tests`
<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->
