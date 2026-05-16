# Architectural Hardening Implementation Plan

**Goal:** Abstract message queries behind a typed MessageStore following existing store conventions

**Architecture:** Factory function `createMessageStore(persistence)` returns a `MessageStore` interface with `count`, `listIds`, and `getLatest` methods. Automatically transaction-aware via Phase 1's AsyncLocalStorage. Registered in composition root and exported from persistence barrel.

**Tech Stack:** Bun (TypeScript), PostgreSQL 17

**Scope:** 6 phases from original design (phase 2 of 6)

**Codebase verified:** 2026-05-16

---

## Acceptance Criteria Coverage

This phase implements and tests:

### arch-hardening.AC4: MessageStore interface
- **arch-hardening.AC4.1 Success:** `count()` returns accurate message count for a conversation
- **arch-hardening.AC4.2 Success:** `listIds()` returns all message IDs ordered by creation time
- **arch-hardening.AC4.3 Success:** `getLatest()` returns the N most recent messages as `ConversationMessage[]`

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: MessageStore type definition and factory

**Verifies:** None (infrastructure for Task 3 tests)

**Files:**
- Create: `src/persistence/message-store.ts`
- Modify: `src/persistence/index.ts` (add barrel export)

**Implementation:**

Create `src/persistence/message-store.ts` with the `MessageStore` type and `createMessageStore` factory function.

The type:
```typescript
import type { ConversationMessage } from '@/agent/types.ts';
import type { PersistenceProvider } from './types.ts';

export type MessageStore = {
  count(conversationId: string): Promise<number>;
  listIds(conversationId: string): Promise<Array<string>>;
  getLatest(conversationId: string, limit: number): Promise<Array<ConversationMessage>>;
};
```

The factory function follows the exact pattern from `createPredictionStore`:
- Takes `PersistenceProvider` as sole dependency
- Returns an object literal implementing `MessageStore`
- Uses `persistence.query<RowType>(sql, params)` for each method

SQL queries (derived from the existing raw SQL in checkpoint-restore.ts):

- `count`: `SELECT COUNT(*)::int as count FROM messages WHERE conversation_id = $1`
- `listIds`: `SELECT id FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`
- `getLatest`: `SELECT id, conversation_id, role, content, tool_calls, tool_call_id, reasoning_content, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2`

For `getLatest`, define a row type matching the DB columns and parse to `ConversationMessage`:
```typescript
type MessageRow = {
  readonly id: string;
  readonly conversation_id: string;
  readonly role: string;
  readonly content: string;
  readonly tool_calls: unknown;
  readonly tool_call_id: string | null;
  readonly reasoning_content: string | null;
  readonly created_at: Date;
};
```

The parser maps snake_case DB rows to the `ConversationMessage` type (which already uses snake_case field names, so it's a direct cast with role narrowing):
```typescript
function parseMessage(row: MessageRow): ConversationMessage {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    role: row.role as ConversationMessage['role'],
    content: row.content,
    tool_calls: row.tool_calls ?? undefined,
    tool_call_id: row.tool_call_id ?? undefined,
    reasoning_content: row.reasoning_content,
    created_at: row.created_at,
  };
}
```

Note: `getLatest` returns results in reverse chronological order (most recent first) since that's the typical use case for "latest N messages."

Add `// pattern: Functional Core` at the top.

Then add to `src/persistence/index.ts`:
```typescript
export type { MessageStore } from './message-store.ts';
export { createMessageStore } from './message-store.ts';
```

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/arch-hardening && bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(persistence): add MessageStore type and factory`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Register MessageStore in composition root

**Verifies:** None (wiring for downstream consumers)

**Files:**
- Modify: `src/index.ts` (near line 595 where other stores are created)

**Implementation:**

Import `createMessageStore` from `@/persistence` and create the instance after `persistence` is connected (near line 595 where `predictionStore` is created):

```typescript
const messageStore = createMessageStore(persistence);
```

This instance will be passed to checkpoint-restore dependencies in Phase 4. For now, just create it so it's available.

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/arch-hardening && bunx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(persistence): register MessageStore in composition root`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: MessageStore integration tests

**Verifies:** arch-hardening.AC4.1, arch-hardening.AC4.2, arch-hardening.AC4.3

**Files:**
- Create: `src/persistence/message-store.test.ts`

**Implementation:**

Integration tests hitting a real PostgreSQL database following the established test pattern.

Setup:
- `beforeAll`: create provider (`postgresql://constellation:constellation@localhost:5432/constellation`), connect, run migrations, create store
- `afterEach`: `TRUNCATE TABLE messages CASCADE`
- `afterAll`: disconnect

Helper to insert test messages:
```typescript
async function insertMessage(conversationId: string, role: string, content: string): Promise<string> {
  const id = crypto.randomUUID();
  await persistence.query(
    `INSERT INTO messages (id, conversation_id, role, content, created_at)
     VALUES ($1, $2, $3, $4, NOW() + ($5 || ' seconds')::interval)`,
    [id, conversationId, role, content, messageCounter++],
  );
  return id;
}
```

Use an incrementing counter for `created_at` offsets to ensure deterministic ordering in tests.

**Testing:**

Tests must verify each AC listed above:

- **arch-hardening.AC4.1:** Insert 3 messages for conversation A, 2 for conversation B. `count('A')` returns 3. `count('B')` returns 2. `count('nonexistent')` returns 0.

- **arch-hardening.AC4.2:** Insert 3 messages for a conversation (in known order). `listIds(conversationId)` returns all 3 IDs in created_at ascending order.

- **arch-hardening.AC4.3:** Insert 5 messages. `getLatest(conversationId, 3)` returns the 3 most recent as `ConversationMessage` objects with all fields populated (id, conversation_id, role, content, created_at). Verify ordering is most-recent-first. Verify `getLatest(conversationId, 10)` returns all 5 (limit exceeds count gracefully).

Additional: verify MessageStore participates in transactions — inside `withTransaction`, insert a message, call `count()`, verify it sees the uncommitted row (same transaction context via AsyncLocalStorage).

Follow project pattern: `describe('arch-hardening.AC4.1: ...', () => { it('...', async () => { ... }) })`

**Verification:**
Run: `cd /Users/scarndp/dev/numina-systems/constellation/.worktrees/arch-hardening && bun test src/persistence/message-store.test.ts`
Expected: All tests pass

**Commit:** `test(persistence): add integration tests for MessageStore`

<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
