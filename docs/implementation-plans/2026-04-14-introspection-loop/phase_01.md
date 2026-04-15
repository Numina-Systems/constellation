# Introspection Loop Implementation Plan - Phase 1: Introspection Event Builder

**Goal:** Pure functions that build an introspection event from assembled context and compute offset cron expressions

**Architecture:** Follows the established Functional Core pattern from `src/subconscious/impulse.ts`. A new `IntrospectionContext` type holds conversation messages, active interests, and digest content. Two pure builder functions produce an `ExternalEvent` and an offset cron string respectively.

**Tech Stack:** TypeScript, Bun, bun:test

**Scope:** 4 phases from original design (phase 1 of 4)

**Codebase verified:** 2026-04-14

---

## Acceptance Criteria Coverage

This phase implements and tests:

### introspection-loop.AC1: Introspection event fires periodically with correct context
- **introspection-loop.AC1.1 Success:** Introspection cron fires at configured offset from impulse interval
- **introspection-loop.AC1.2 Success:** Event contains `[Review]` section with recent subconscious conversation messages
- **introspection-loop.AC1.3 Success:** Event contains `[Current State]` section with active interests and last digest content
- **introspection-loop.AC1.4 Success:** Event contains `[Act]` section prompting formalization and digest update
- **introspection-loop.AC1.5 Failure:** Messages with `role = 'tool'` are excluded from review context

### introspection-loop.AC4: Time-windowed review scope
- **introspection-loop.AC4.1 Success:** Only messages within configured `introspection_lookback_hours` are included in review

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: IntrospectionContext type and buildIntrospectionCron

**Verifies:** introspection-loop.AC1.1

**Files:**
- Create: `src/subconscious/introspection.ts`

**Implementation:**

Create `src/subconscious/introspection.ts` with the `// pattern: Functional Core` header.

Define the `IntrospectionContext` type:

```typescript
export type IntrospectionContext = {
  readonly messages: ReadonlyArray<{
    readonly role: 'user' | 'assistant' | 'system';
    readonly content: string;
    readonly created_at: Date;
  }>;
  readonly interests: ReadonlyArray<Interest>;
  readonly currentDigest: string | null;
  readonly timestamp: Date;
};
```

Note: the `messages` array should already be pre-filtered to exclude `role = 'tool'` messages. The type enforces this by omitting `'tool'` from the role union. Filtering happens in the assembler (Phase 2).

Implement `buildIntrospectionCron`:

```typescript
export function buildIntrospectionCron(impulseIntervalMinutes: number, offsetMinutes: number): string {
  const effectiveInterval = impulseIntervalMinutes;
  const offset = offsetMinutes % effectiveInterval;
  return `${offset}/${effectiveInterval} * * * *`;
}
```

This produces a cron like `3/15 * * * *` meaning "starting at minute 3, every 15 minutes" — offset from the impulse cron `*/15 * * * *`.

Import `Interest` from `./types.ts` and `ExternalEvent` from `@/agent/types`.

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(subconscious): add IntrospectionContext type and buildIntrospectionCron`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: buildIntrospectionEvent implementation

**Verifies:** introspection-loop.AC1.2, introspection-loop.AC1.3, introspection-loop.AC1.4, introspection-loop.AC1.5, introspection-loop.AC4.1

**Files:**
- Modify: `src/subconscious/introspection.ts`

**Implementation:**

Add `buildIntrospectionEvent` to `src/subconscious/introspection.ts`. Follow the same line-building pattern as `buildImpulseEvent` in `impulse.ts:20-62`.

```typescript
export function buildIntrospectionEvent(context: Readonly<IntrospectionContext>): ExternalEvent {
  const lines: Array<string> = [];

  // Section 1: Review — recent conversation messages
  lines.push('[Review]');
  lines.push('Review your recent observations and conversation. What stands out?');
  lines.push('');
  lines.push(formatMessages(context.messages));

  // Section 2: Current State — active interests and last digest
  lines.push('');
  lines.push('[Current State]');
  lines.push(formatInterests(context.interests));
  lines.push('');
  if (context.currentDigest) {
    lines.push('[Last Digest]');
    lines.push(context.currentDigest);
  } else {
    lines.push('[Last Digest]');
    lines.push('No previous digest. This is your first introspection.');
  }

  // Section 3: Act — instructions for formalization and digest update
  lines.push('');
  lines.push('[Act]');
  lines.push('Based on your review:');
  lines.push('1. Formalize any observations worth tracking as interests or curiosity threads (use manage_interest, manage_curiosity)');
  lines.push('2. Update your digest with remaining unformalised observations (use memory_write with label "introspection-digest")');
  lines.push('3. The digest should capture half-formed thoughts that haven\'t risen to the level of formal interests yet');

  const prompt = lines.join('\n');

  return {
    source: 'subconscious:introspection',
    content: prompt,
    metadata: {
      taskType: 'introspection',
      messageCount: context.messages.length,
      interestCount: context.interests.length,
      hasExistingDigest: context.currentDigest !== null,
    },
    timestamp: context.timestamp,
  };
}
```

Add local helper functions (private to the module, not exported):

```typescript
function formatMessages(
  messages: ReadonlyArray<{ readonly role: string; readonly content: string; readonly created_at: Date }>,
): string {
  if (messages.length === 0) {
    return 'No recent conversation to review.';
  }

  return messages
    .map((msg) => {
      const time = msg.created_at.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      return `[${time}] (${msg.role}) ${msg.content.length > 500 ? msg.content.slice(0, 500) + '...' : msg.content}`;
    })
    .join('\n');
}

function formatInterests(interests: ReadonlyArray<Interest>): string {
  if (interests.length === 0) {
    return 'No active interests.';
  }

  return interests
    .map(
      (interest) =>
        `- ${interest.name} (score: ${interest.engagementScore.toFixed(2)}): ${interest.description}`,
    )
    .join('\n');
}
```

Note: The `formatInterests` helper here is local to introspection.ts — it's intentionally separate from the one in impulse.ts to avoid coupling. They format similarly but may diverge as introspection needs different detail levels.

**Verification:**
Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(subconscious): add buildIntrospectionEvent pure builder`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Tests for buildIntrospectionEvent and buildIntrospectionCron

**Verifies:** introspection-loop.AC1.1, introspection-loop.AC1.2, introspection-loop.AC1.3, introspection-loop.AC1.4, introspection-loop.AC1.5, introspection-loop.AC4.1

**Files:**
- Create: `src/subconscious/introspection.test.ts`

**Testing:**

Create `src/subconscious/introspection.test.ts`. Follow the established test pattern from `impulse.test.ts` — use `describe` blocks named after ACs, inline fixture creation, `@/` imports.

Tests must verify each AC listed above:

- **introspection-loop.AC1.1:** `buildIntrospectionCron` produces offset cron expression. Test that `buildIntrospectionCron(15, 3)` returns `'3/15 * * * *'`. Test that `buildIntrospectionCron(30, 5)` returns `'5/30 * * * *'`. Test that offset wraps: `buildIntrospectionCron(15, 20)` returns `'5/15 * * * *'` (20 % 15 = 5).

- **introspection-loop.AC1.2:** Event contains `[Review]` section. Build event with messages array containing sample conversation messages (role 'assistant', content 'I noticed an interesting pattern...'), verify event content contains `[Review]` and the message content.

- **introspection-loop.AC1.3:** Event contains `[Current State]` section with interests and digest. Build event with an `Interest` fixture (same shape as in impulse.test.ts:46-56) and a `currentDigest` string. Verify content contains `[Current State]`, the interest name, and `[Last Digest]` with the digest content.

- **introspection-loop.AC1.4:** Event contains `[Act]` section. Verify content contains `[Act]`, `manage_interest`, `manage_curiosity`, and `memory_write`.

- **introspection-loop.AC1.5:** Messages with `role = 'tool'` are excluded. Since the `IntrospectionContext.messages` type union does not include `'tool'`, this is enforced at the type level. Test that the builder correctly handles the pre-filtered messages — build an event with only assistant/user messages, verify they appear in content. (The actual filtering is tested in Phase 2's assembler tests.)

- **introspection-loop.AC4.1:** Time-windowed review. Build event with messages that have specific `created_at` timestamps. Verify messages appear in the output. (The time-windowing logic itself is in the assembler — the builder just formats what it receives. Test that the builder faithfully renders timestamps from the messages.)

**Note on timestamp assertions:** `toLocaleTimeString` output can vary across runtime environments. Test assertions should match patterns (e.g., `expect(event.content).toContain(']')` for timestamp presence) rather than exact locale-dependent format strings. The existing `impulse.test.ts` avoids asserting on exact time formats.

Additional edge case tests:
- Empty messages array produces "No recent conversation to review."
- Null `currentDigest` produces "No previous digest. This is your first introspection."
- Event source is `'subconscious:introspection'`
- Event metadata includes `messageCount`, `interestCount`, `hasExistingDigest`
- Empty interests array produces "No active interests."

**Verification:**
Run: `bun test src/subconscious/introspection.test.ts`
Expected: All tests pass

**Commit:** `test(subconscious): add introspection event builder tests`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
