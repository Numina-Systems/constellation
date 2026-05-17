# Diary Injection Implementation Plan — Phase 3: Prompt Assembly and Session Wiring

**Goal:** Wire diary retrieval into session initialization and inject the formatted diary section into the system prompt on every turn.

**Architecture:** The diary section is a static string computed once at agent creation time. It's stored in the agent closure and appended to `systemPrompt` after core memory blocks but before skills on every round of the agent loop. This follows the "session-static" pattern — unlike recall (which fires per-turn), the diary is fetched once and never changes during the session. Config fields gate the feature and control token budget/entry limits.

**Tech Stack:** TypeScript, Zod, Bun test

**Scope:** 3 phases from original design (phase 3 of 3)

**Codebase verified:** 2026-05-17

---

## Acceptance Criteria Coverage

This phase implements and tests:

### diary-injection.AC4: Prompt injection position
- **diary-injection.AC4.1 Success:** Diary section appears after core memory blocks in system prompt
- **diary-injection.AC4.2 Success:** Diary section appears before dynamic context providers and skills
- **diary-injection.AC4.3 Edge:** Absent diary (null) produces no section in prompt

### diary-injection.AC6: Guard conditions
- **diary-injection.AC6.1 Success:** `diary_enabled = false` skips retrieval entirely
- **diary-injection.AC6.2 Success:** Empty working tier (no diary blocks) returns null gracefully
- **diary-injection.AC6.3 Success:** Store error is caught, logged, and skipped (no crash)

### diary-injection.AC7: Static per session
- **diary-injection.AC7.1 Success:** Diary content fetched once at session init
- **diary-injection.AC7.2 Success:** Same diary content injected on every turn within the session
- **diary-injection.AC7.3 Success:** New diary entries written mid-session don't appear until next session

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Add diary config fields to AgentConfig and Zod schema

**Verifies:** diary-injection.AC6.1 (config gate prerequisite)

**Files:**
- Modify: `src/config/schema.ts:6-21` (add diary fields to AgentConfigSchema)
- Modify: `src/agent/types.ts:23-38` (add diary fields to AgentConfig type)

**Implementation:**

In `src/config/schema.ts`, add three fields to `AgentConfigSchema` after the existing `recall_token_budget` line:

```typescript
diary_enabled: z.boolean().default(true),
diary_token_budget: z.number().int().positive().default(3000),
diary_max_entries: z.number().int().positive().default(3),
```

Note: `diary_enabled` defaults to `true` (design specifies it's safe to enable by default since it's inert when no entries exist). This differs from `recall_enabled` which defaults to `false`.

In `src/agent/types.ts`, add corresponding optional fields to the `AgentConfig` type after `recall_token_budget`:

```typescript
diary_enabled?: boolean;
diary_token_budget?: number;
diary_max_entries?: number;
```

**Verification:**

Run: `bun run build`
Expected: Compiles without errors.

**Commit:** `feat(config): add diary_enabled, diary_token_budget, diary_max_entries config fields`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add `diarySection` to AgentDependencies

**Verifies:** diary-injection.AC7.1 (fetched once, passed as dependency)

**Files:**
- Modify: `src/agent/types.ts:78-101` (add `diarySection` to AgentDependencies)

**Implementation:**

Add an optional `diarySection` field to `AgentDependencies`:

```typescript
diarySection?: string;
```

This is a pre-computed string (the output of `buildDiarySection().section`) passed in at agent creation time. It's a simple string because the diary is static per session — no need for a stateful provider pattern.

**Verification:**

Run: `bun run build`
Expected: Compiles without errors.

**Commit:** `feat(agent): add diarySection to AgentDependencies`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->
<!-- START_TASK_3 -->
### Task 3: Inject diary section into system prompt in agent loop

**Verifies:** diary-injection.AC4.1, diary-injection.AC4.2, diary-injection.AC4.3, diary-injection.AC7.2

**Files:**
- Modify: `src/agent/agent.ts:237` (append diarySection after buildSystemPrompt, before recall and skills)

**Implementation:**

In `src/agent/agent.ts`, inside the `while (roundCount < maxRounds)` loop, immediately after line 237 (`let systemPrompt = await buildSystemPrompt(deps.memory);`), add:

```typescript
if (deps.diarySection) {
  systemPrompt += '\n\n' + deps.diarySection;
}
```

This must come BEFORE the recall block (line 240) and BEFORE the skills block (line 284). The diary section is static — same string every round — satisfying AC7.2.

The ordering in the system prompt will be:
1. Core memory blocks (from `buildSystemPrompt`)
2. **Diary section** (new, static)
3. Recall context (rebuilt if recall fires — line 267)
4. Skills (appended at line 291)

Note: When recall fires and rebuilds systemPrompt (line 267: `systemPrompt = await buildSystemPrompt(deps.memory)`), the diary section needs to be re-appended because `buildSystemPrompt` only returns core blocks. Add the same conditional after line 267:

```typescript
// Re-append diary after recall rebuilds system prompt (diary is session-static, not included in buildSystemPrompt)
if (deps.diarySection) {
  systemPrompt += '\n\n' + deps.diarySection;
}
```

This comment explains why the re-append is necessary — any future code that rebuilds `systemPrompt` must also re-append the diary section.

**Verification:**

Run: `bun run build`
Expected: Compiles without errors.

**Commit:** `feat(agent): inject diary section into system prompt after core blocks`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Unit test for diary injection positioning

**Verifies:** diary-injection.AC4.1, diary-injection.AC4.2, diary-injection.AC4.3

**Files:**
- Create: `src/agent/diary-injection.test.ts` (agent-level test for diary positioning)

**Testing:**

Since the diary injection happens in the agent loop (not in `buildSystemPrompt()`), the positioning test should verify the system prompt string construction logic. However, since it's a simple string append in `agent.ts`, and integration testing the full agent loop for prompt construction is complex, the tests should verify the contract:

- **diary-injection.AC4.1:** Given a diarySection string and a system prompt from buildSystemPrompt, the result should contain the diary section after the core blocks content.
- **diary-injection.AC4.2:** The diary section should appear before any skills content in the final prompt.
- **diary-injection.AC4.3:** When `diarySection` is undefined/not provided in deps, the system prompt should be unchanged (no empty sections, no extra newlines).

The most practical approach is to test the wiring contract: create a minimal agent with mock deps that includes a `diarySection`, send a message, and verify the system prompt passed to the model contains the diary section in the correct position.

Alternatively, if the agent loop test is too heavy, extract the prompt assembly logic into a testable helper. Given existing patterns (skills are appended directly in agent.ts), follow the same approach and verify via integration test or by checking model call arguments.

Test approach — verify via model mock:
- Create agent with `diarySection: '## Diary\n\n### 2026-05-17\ntest entry'`
- Mock the model to capture the system prompt from the `complete()` call
- Assert system prompt contains the diary section
- Assert diary section appears after core memory content
- Assert diary section appears before skills content (if skills present)

- **Additional: null diarySection.** Create agent without `diarySection` in deps. Assert system prompt does NOT contain `## Diary`.

**Verification:**

Run: `bun test src/agent/diary-injection.test.ts`
Expected: All tests pass.

**Commit:** `test(agent): verify diary section positioning in system prompt`
<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 5-6) -->
<!-- START_TASK_5 -->
### Task 5: Wire diary retrieval in composition root (`src/index.ts`)

**Verifies:** diary-injection.AC6.1, diary-injection.AC6.2, diary-injection.AC6.3, diary-injection.AC7.1

**Files:**
- Modify: `src/index.ts` (add diary retrieval at session init, pass to agent deps)

**Implementation:**

In `src/index.ts`, after the memory store is created (around line 567-571) and before agent creation (around line 1069), add the diary retrieval block:

```typescript
let diarySection: string | undefined;
if (config.agent.diary_enabled !== false) {
  try {
    const diaryBlocks = await memoryStore.getBlocksByLabelPrefix(
      AGENT_OWNER,
      'diary:',
      'working',
    );
    if (diaryBlocks.length > 0) {
      const result = buildDiarySection(diaryBlocks, {
        tokenBudget: config.agent.diary_token_budget ?? 3000,
        maxEntries: config.agent.diary_max_entries ?? 3,
      });
      diarySection = result?.section;
    }
  } catch (error) {
    console.warn('diary: retrieval failed, continuing without diary', error);
  }
}
```

Then pass `diarySection` into the agent deps object (around line 1160-1180 where `createAgent` is called):

```typescript
const agent = createAgent({
  ...existingDeps,
  diarySection,
}, restoredConversationId);
```

Required imports at top of `src/index.ts`:
```typescript
import { buildDiarySection } from '@/diary';
```

Guard conditions:
- `diary_enabled !== false` → skips retrieval entirely (AC6.1)
- `diaryBlocks.length > 0` check → returns undefined gracefully (AC6.2)
- `try/catch` → logs warning and continues (AC6.3)
- Called once before agent creation → static per session (AC7.1)

**Verification:**

Run: `bun run build`
Expected: Compiles without errors.

Run: `bun test`
Expected: All existing tests still pass.

**Commit:** `feat: wire diary retrieval into session init`
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Integration test for session-static diary behavior

**Verifies:** diary-injection.AC7.1, diary-injection.AC7.2, diary-injection.AC7.3, diary-injection.AC6.1, diary-injection.AC6.2, diary-injection.AC6.3

**Files:**
- Create: `src/diary/integration.test.ts`

**Testing:**

Integration tests that verify the full wiring works end-to-end. These require a running database.

Test cases:

- **diary-injection.AC7.1 + AC7.2:** Insert diary blocks in the database, create an agent with diary retrieval, verify the diary section is present in the system prompt on the first turn AND on subsequent turns (same content both times).

- **diary-injection.AC7.3:** Insert diary blocks, create agent (diary is fetched), then insert additional diary blocks. Verify the system prompt still contains only the original diary content (new entries not visible until next session).

- **diary-injection.AC6.1:** Set `diary_enabled: false` in config. Verify no diary retrieval is attempted and system prompt has no `## Diary` section.

- **diary-injection.AC6.2:** Ensure no diary blocks exist in the database. Verify agent creation succeeds and system prompt has no `## Diary` section.

- **diary-injection.AC6.3:** Use a broken/disconnected memory store (or mock that throws). Verify agent creation succeeds gracefully with no diary section and a warning is logged.

Given the complexity of full agent integration tests, the implementor should decide whether to:
1. Test at the wiring level (call the retrieval + buildDiarySection directly with a real DB)
2. Test at the agent level (create agent, mock model, verify system prompt)

Option 1 is more practical and still verifies the full pipeline. The key guarantee is: diary retrieval + formatting works correctly with real DB data, and the result is a stable string.

**Verification:**

Run: `bun test src/diary/integration.test.ts`
Expected: All tests pass.

**Commit:** `test(diary): add integration tests for session-static diary behavior`
<!-- END_TASK_6 -->
<!-- END_SUBCOMPONENT_C -->
