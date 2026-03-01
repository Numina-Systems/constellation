# Compaction V2 Implementation Plan — Phase 4: Importance Scoring

**Goal:** Add heuristic importance scoring for messages so that when messages must be compressed, the least important ones go first. Integrate scoring with `splitHistory()` to sort compressible messages by importance ascending.

**Architecture:** A pure scoring function `scoreMessage()` assigns a numeric importance to each message based on configurable factors: role weight, recency decay, content signals (questions, tool calls, keywords, length). `splitHistory()` is modified to score the older messages and return `toCompress` sorted by importance ascending (lowest-scored first). Scoring is a Functional Core pure function; `splitHistory()` remains pure.

**Tech Stack:** TypeScript, Bun

**Scope:** 4 of 6 phases from original design (phase 4)

**Codebase verified:** 2026-02-28

---

## Acceptance Criteria Coverage

This phase implements and tests:

### compaction-v2.AC3: Importance-Based Scoring
- **compaction-v2.AC3.1 Success:** Messages scored by role weight (system > user > assistant by default)
- **compaction-v2.AC3.2 Success:** Newer messages score higher than older messages via recency decay
- **compaction-v2.AC3.3 Success:** Content signals (questions, tool calls, keywords) increase score
- **compaction-v2.AC3.4 Success:** `splitHistory()` returns `toCompress` sorted by importance ascending (lowest-scored first)
- **compaction-v2.AC3.5 Success:** Scoring config is customizable via `[summarization]` TOML section
- **compaction-v2.AC3.6 Edge:** Messages with identical scores maintain their original chronological order (stable sort)

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Add ImportanceScoringConfig to types.ts

**Verifies:** compaction-v2.AC3.5

**Files:**
- Modify: `src/compaction/types.ts`

**Implementation:**

Add the `ImportanceScoringConfig` type after the existing `CompactionConfig` type:

```typescript
export type ImportanceScoringConfig = {
  readonly roleWeightSystem: number;
  readonly roleWeightUser: number;
  readonly roleWeightAssistant: number;
  readonly recencyDecay: number;
  readonly questionBonus: number;
  readonly toolCallBonus: number;
  readonly keywordBonus: number;
  readonly importantKeywords: ReadonlyArray<string>;
  readonly contentLengthWeight: number;
};

export const DEFAULT_SCORING_CONFIG: ImportanceScoringConfig = {
  roleWeightSystem: 10.0,
  roleWeightUser: 5.0,
  roleWeightAssistant: 3.0,
  recencyDecay: 0.95,
  questionBonus: 2.0,
  toolCallBonus: 4.0,
  keywordBonus: 1.5,
  importantKeywords: ['error', 'fail', 'bug', 'fix', 'decision', 'agreed', 'constraint', 'requirement'],
  contentLengthWeight: 1.0,
};
```

Also update `CompactionConfig` to include the optional scoring config:

```typescript
export type CompactionConfig = {
  readonly chunkSize: number;
  readonly keepRecent: number;
  readonly maxSummaryTokens: number;
  readonly clipFirst: number;
  readonly clipLast: number;
  readonly prompt: string | null;
  readonly scoring?: ImportanceScoringConfig;
};
```

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(compaction): add ImportanceScoringConfig type and defaults`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Create scoring.ts with scoreMessage function

**Verifies:** compaction-v2.AC3.1, compaction-v2.AC3.2, compaction-v2.AC3.3

**Files:**
- Create: `src/compaction/scoring.ts`

**Implementation:**

Create a new file `src/compaction/scoring.ts` with pattern annotation `// pattern: Functional Core`.

The file exports a single pure function:

```typescript
import type { ConversationMessage } from '../agent/types.js';
import type { ImportanceScoringConfig } from './types.js';
import { DEFAULT_SCORING_CONFIG } from './types.js';

export function scoreMessage(
  msg: ConversationMessage,
  index: number,
  total: number,
  config: ImportanceScoringConfig = DEFAULT_SCORING_CONFIG,
): number {
  let score = 0;

  // Role weight (AC3.1)
  switch (msg.role) {
    case 'system':
      score += config.roleWeightSystem;
      break;
    case 'user':
      score += config.roleWeightUser;
      break;
    case 'assistant':
      score += config.roleWeightAssistant;
      break;
    case 'tool':
      score += config.roleWeightUser;
      break;
  }

  // Recency decay (AC3.2) — newer messages (higher index) score higher
  // Uses exponential decay: score *= decay^(total - 1 - index)
  // At index=total-1 (newest): multiplier = 1.0
  // At index=0 (oldest): multiplier = decay^(total-1)
  const distanceFromEnd = total - 1 - index;
  const recencyMultiplier = Math.pow(config.recencyDecay, distanceFromEnd);
  score *= recencyMultiplier;

  // Content signals (AC3.3)
  const content = msg.content;

  // Question marks
  if (content.includes('?')) {
    score += config.questionBonus;
  }

  // Tool calls — check if message has tool_calls field
  if (msg.tool_calls) {
    score += config.toolCallBonus;
  }

  // Important keywords — cumulative: +keywordBonus per distinct keyword match
  const lowerContent = content.toLowerCase();
  for (const keyword of config.importantKeywords) {
    if (lowerContent.includes(keyword.toLowerCase())) {
      score += config.keywordBonus;
    }
  }

  // Content length bonus: +contentLengthWeight per 100 chars, capped at 3.0
  const lengthBonus = Math.min(
    (content.length / 100) * config.contentLengthWeight,
    3.0,
  );
  score += lengthBonus;

  return score;
}
```

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(compaction): add scoreMessage pure function`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Scoring function tests

**Verifies:** compaction-v2.AC3.1, compaction-v2.AC3.2, compaction-v2.AC3.3

**Files:**
- Create: `src/compaction/scoring.test.ts`

**Testing:**

Create a new test file with `// pattern: Functional Core` annotation.

Use the `createMessage` helper pattern from the existing compactor tests:

```typescript
function createMessage(
  id: string,
  role: ConversationMessage['role'],
  content: string,
  offset: number = 0,
): ConversationMessage {
  return {
    id,
    conversation_id: 'test-conv',
    role,
    content,
    created_at: new Date(1000 + offset),
  };
}
```

Tests must verify:

- compaction-v2.AC3.1 (role weight): Given messages with different roles at the same position, system messages score highest, then user, then assistant. Test with identical content and position, varying only role.
- compaction-v2.AC3.2 (recency): Given identical messages at different positions, newer messages (higher index) score higher than older ones. Test with same role and content, varying only index.
- compaction-v2.AC3.3 (content signals):
  - A message with `?` scores higher than identical message without
  - A message with `tool_calls` set scores higher than one without
  - A message containing a keyword from `importantKeywords` scores higher
  - A longer message scores higher than a shorter one (up to the cap)
- Custom config: Verify that passing a custom `ImportanceScoringConfig` overrides the defaults.
- Edge cases: Empty content, single message (total=1), all identical messages.

Follow project testing patterns: `describe`/`it` blocks, `bun:test` imports.

**Verification:**

Run: `bun test src/compaction/scoring.test.ts`
Expected: All tests pass

**Commit:** `test(compaction): add scoring function tests`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-6) -->
<!-- START_TASK_4 -->
### Task 4: Update splitHistory() to score and sort by importance

**Verifies:** compaction-v2.AC3.4, compaction-v2.AC3.6

**Files:**
- Modify: `src/compaction/compactor.ts:40-80` (splitHistory function)

**Implementation:**

Update `splitHistory` to accept an optional scoring config and sort `toCompress` by importance ascending.

Update the function signature — scoring is always active with `DEFAULT_SCORING_CONFIG` as fallback:

```typescript
export function splitHistory(
  history: ReadonlyArray<ConversationMessage>,
  keepRecent: number,
  scoringConfig: ImportanceScoringConfig = DEFAULT_SCORING_CONFIG,
): {
  toCompress: ReadonlyArray<ConversationMessage>;
  toKeep: ReadonlyArray<ConversationMessage>;
  priorSummary: ConversationMessage | null;
} {
```

Add imports at top of file:

```typescript
import { scoreMessage } from './scoring.js';
import type { ImportanceScoringConfig } from './types.js';
import { DEFAULT_SCORING_CONFIG } from './types.js';
```

After the existing split logic (line 76), before the return statement, add scoring and sorting:

```typescript
// Score and sort compressible messages by importance (lowest first)
const compressSlice = history.slice(compressStartIndex, splitIndex);

if (compressSlice.length > 1) {
  const scored = compressSlice.map((msg, idx) => ({
    msg,
    originalIndex: idx,
    score: scoreMessage(msg, idx, compressSlice.length, scoringConfig),
  }));

  // Stable sort: equal scores maintain original chronological order (AC3.6)
  scored.sort((a, b) => {
    const scoreDiff = a.score - b.score;
    if (scoreDiff !== 0) return scoreDiff;
    return a.originalIndex - b.originalIndex;
  });

  return {
    toCompress: scored.map((s) => s.msg),
    toKeep: history.slice(splitIndex),
    priorSummary,
  };
}

return {
  toCompress: compressSlice,
  toKeep: history.slice(splitIndex),
  priorSummary,
};
```

Note: Scoring is always active. When no config is provided, `DEFAULT_SCORING_CONFIG` is used. Custom configs from TOML override the defaults.

Also update the `compress()` method to pass the scoring config to `splitHistory`:

```typescript
const { toCompress, toKeep, priorSummary } = splitHistory(
  history,
  config.keepRecent,
  config.scoring,
);
```

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(compaction): integrate importance scoring into splitHistory`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Update splitHistory tests for importance ordering

**Verifies:** compaction-v2.AC3.4, compaction-v2.AC3.6

**Files:**
- Modify: `src/compaction/compactor.test.ts`

**Testing:**

Add new tests in the existing `splitHistory` describe block. These test the scoring integration.

Tests must verify:
- compaction-v2.AC3.4: When `scoringConfig` is provided, `toCompress` is sorted by importance ascending (lowest-scored messages first). Create messages with different roles and content, verify ordering changes from chronological to importance-based.
- compaction-v2.AC3.6: When two messages have identical scores, they maintain their original chronological order. Create messages with the same role and similar content at different positions.

Also verify backward compatibility: When `scoringConfig` is omitted, `toCompress` is in chronological order (same as before).

Follow existing test patterns in compactor.test.ts using the `createMessage` factory.

**Verification:**

Run: `bun test src/compaction/compactor.test.ts`
Expected: All tests pass (existing + new)

**Commit:** `test(compaction): add importance-ordered splitHistory tests`
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Update barrel exports for scoring module

**Verifies:** None (infrastructure)

**Files:**
- Modify: `src/compaction/index.ts`
- Modify: `src/compaction/types.ts` (already modified in Task 1 — just verify exports)

**Implementation:**

Add scoring exports to the barrel:

```typescript
export type { ImportanceScoringConfig } from './types.js';
export { DEFAULT_SCORING_CONFIG } from './types.js';
export { scoreMessage } from './scoring.js';
```

**Verification:**

Run: `bun run build`
Expected: Type-check passes

Run: `bun test`
Expected: All tests pass

**Commit:** `refactor(compaction): export scoring types and function`
<!-- END_TASK_6 -->
<!-- END_SUBCOMPONENT_B -->
