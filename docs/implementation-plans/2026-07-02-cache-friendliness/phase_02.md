# Cache-Friendliness Phase 2: Route Skills Through the Snapshot Pipeline

**Goal:** Stop skills from mutating the system prompt per turn; deliver skill content through the batch-anchored snapshot pipeline like recall does, so the system prompt is byte-stable across turns.

**Architecture:** A `SkillsContextState` holder (mirroring `RecallContextState` in `src/recall/context.ts`) is created in the composition root, registered as a `classification: 'dynamic'` provider in `classifiedProviders`, and populated by the agent loop after skill retrieval. The direct `systemPrompt += skillSection` mutation in `src/agent/agent.ts` is removed. Retrieval happens once per turn (the retrieval key — the user message — is constant across tool rounds), replacing the current once-per-round retrieval. This is the remediation already sketched in the KNOWN LIMITATION comment at src/agent/agent.ts:290-299.

**Tech Stack:** Bun, TypeScript 5.7+ strict, `bun:test`.

**Scope:** Phase 2 of 6 from `docs/design-plans/2026-07-02-cache-friendliness.md`.

**Codebase verified:** 2026-07-02 (codebase-investigator).

---

## Acceptance Criteria Coverage

This phase implements and tests:

### cache-friendliness.AC2: Skills no longer mutate the system prompt
- **cache-friendliness.AC2.1 Success:** With skills enabled and relevant skills returned, the system prompt string passed to `model.complete` is byte-identical across two consecutive turns when core memory and diary are unchanged.
- **cache-friendliness.AC2.2 Success:** Relevant skill content appears in the dynamic-context attachment of the latest user message (full snapshot on first composition; delta when the skill set changes; absent when unchanged).
- **cache-friendliness.AC2.3 Failure:** When skill retrieval throws, the turn completes normally with a console warning and no skill section (parity with current behaviour).

---

## Context for the implementor

**Verified current state:**
- Skills injection: `src/agent/agent.ts:289-320` — `deps.skills.getRelevant(userMessage, maxSkills, threshold)` then `systemPrompt += '\n\n' + skillSection`, inside the round loop (runs every round), wrapped in try/catch with `traceError`.
- `formatSkillsSection(skills)` in `src/skill/context.ts:17-29` returns `string | undefined` (undefined for empty skills; otherwise a `## Active Skills\n\n...` section).
- Pattern to mirror: `createRecallContextProvider()` in `src/recall/context.ts:45-60` — a callable `ContextProvider` (`() => string | undefined`) with setter/getter state attached.
- Provider registration: `src/index.ts:1104-1170` — `classifiedProviders.push({ name, provider, classification: 'dynamic' })`; recall's registration at ~1137-1141 is the template. `recallContextProvider` is created at ~line 735.
- Types: `ClassifiedProvider` / `ContextProvider` in `src/agent/types.ts:71-79`; `AgentDependencies` in the same file.
- Dynamic providers are collected by `buildDynamicProviderMap` (src/agent/agent.ts:90-101) and evaluated by `snapshotState.computeSnapshot(...)` (src/agent/agent.ts:341-350); content lands in the user-message attachment via `buildUserMessage` (src/agent/messages.ts).
- Testing conventions: hand-rolled fakes, `bun:test`, AC-prefixed test names, `(unit)` marker. Model requests are captured via `createMockModelProvider(responses, tracker)` in `src/agent/agent.test.ts:193-229` — `tracker.requests` holds every `ModelRequest` (including `system` and `messages`).

**Design decisions (from design doc D1):**
- The holder lives in `src/skill/context.ts` next to `formatSkillsSection`.
- The agent populates the holder only when BOTH `deps.skills` and `deps.skillsContextState` are present. `deps.skills` without the holder means skills are not delivered (the composition root wires both together in this same phase; no fallback to system-prompt mutation — that is the behaviour being removed).
- Retrieval failure: unchanged error handling (console.warn + traceError), holder set to `undefined`, turn continues.
- Pre-existing quirk, do not "fix" in this phase: `skill_threshold` is not declared on the `AgentConfig` type (only `max_skills_per_turn` is), yet agent.ts already reads `deps.config.skill_threshold ?? 0.3`. This phase keeps that read as-is — don't be surprised by it, and don't widen scope to add the field.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: `SkillsContextState` holder in src/skill/context.ts

**Verifies:** (foundation for cache-friendliness.AC2.1–AC2.3; directly tested in Task 2)

**Files:**
- Modify: `src/skill/context.ts`

**Implementation:**

Mirror `createRecallContextProvider` exactly (src/recall/context.ts:45-60):

```typescript
export type SkillsContextState = {
  setSection(section: string | undefined): void;
  getSection(): string | undefined;
};

/**
 * Creates a context provider for per-turn skill sections.
 * The provider returns undefined when no section is set, which signals
 * the snapshot pipeline to omit the skills section entirely.
 */
export function createSkillsContextProvider(): ContextProvider & SkillsContextState {
  let currentSection: string | undefined;

  const provider = (() => currentSection) as ContextProvider & SkillsContextState;

  provider.setSection = (section: string | undefined) => {
    currentSection = section;
  };

  provider.getSection = () => currentSection;

  return provider;
}
```

Import `ContextProvider` from `@/agent/types.js` (match the existing import style in `src/recall/context.ts`). Export `SkillsContextState` and `createSkillsContextProvider` from the skill module barrel (`src/skill/index.ts`).

**Verification:**
Run: `bun run build`
Expected: no type errors.
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Holder unit tests

**Verifies:** provider contract used by AC2.2 (undefined when unset / empty; section string when set)

**Files:**
- Modify: `src/skill/context.test.ts` (create if absent — check for an existing test file for `src/skill/context.ts` first and extend it if present)

**Testing:**
- Provider returns `undefined` before any `setSection` call.
- After `setSection('## Active Skills\n\n...')`, the provider returns that exact string.
- After `setSection(undefined)`, the provider returns `undefined` again.

Follow the Functional Core test style (no mocks needed). File header comment: `// pattern: Functional Core`.

**Verification:**
Run: `bun test src/skill/context.test.ts`
Expected: all pass.

**Commit:** `feat(skill): add SkillsContextState snapshot provider`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->
<!-- START_TASK_3 -->
### Task 3: Agent loop — populate the holder instead of mutating the system prompt

**Verifies:** cache-friendliness.AC2.1, cache-friendliness.AC2.3 (tested in Task 5)

**Files:**
- Modify: `src/agent/types.ts` — add optional `skillsContextState` to `AgentDependencies`
- Modify: `src/agent/agent.ts:289-320`

**Implementation:**

1. In `src/agent/types.ts`, add to `AgentDependencies` (near the existing `recallContextState` field):

```typescript
  readonly skillsContextState?: SkillsContextState;
```

Import the type from `../skill/context.ts` (or the skill barrel — match how `RecallContextState` is imported for `recallContextState`).

2. In `src/agent/agent.ts`, replace the skills block (current lines 289-320, including the KNOWN LIMITATION comment — the limitation is now fixed):
   - Introduce a `skillsRetrieved` flag alongside the existing `recallExecuted` flag (declared before the round loop, reset per `processMessage` call) so retrieval fires once per turn instead of once per round.
   - Guard on `deps.skills && deps.skillsContextState`.
   - On success: `deps.skillsContextState.setSection(skillSection)` (where `skillSection` is `formatSkillsSection(relevantSkills)` — may be `undefined`, which correctly clears the section).
   - On error: keep the existing `console.warn` + `traceError` handling, and call `deps.skillsContextState.setSection(undefined)`.
   - Delete the `systemPrompt += '\n\n' + skillSection;` mutation and the surrounding `if (skillSection)` guard.

The shape:

```typescript
      // Retrieve relevant skills once per turn; delivered via the snapshot pipeline
      if (!skillsRetrieved && deps.skills && deps.skillsContextState) {
        skillsRetrieved = true;
        try {
          const maxSkills = deps.config.max_skills_per_turn ?? 3;
          const threshold = deps.config.skill_threshold ?? 0.3;
          const relevantSkills = await deps.skills.getRelevant(userMessage, maxSkills, threshold);
          deps.skillsContextState.setSection(formatSkillsSection(relevantSkills));
        } catch (error) {
          deps.skillsContextState.setSection(undefined);
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.warn(`failed to retrieve relevant skills: ${errorMsg}`);
          if (deps.traceRecorder) {
            const structured = isConstellationError(error)
              ? error
              : wrapError(error, 'TOOL_DISPATCH_FAILED', 'agent', { operation: 'skill_retrieval' });
            traceError(structured, deps.traceRecorder, deps.owner ?? 'unknown', id);
          }
        }
      }
```

Note: retrieval must happen BEFORE `snapshotState.computeSnapshot(...)` runs in the same round (it does — the skills block precedes the snapshot composition at ~line 341). Keep it there.

**Verification:**
Run: `bun run build && bun test src/agent/`
Expected: type-check clean. Existing agent tests pass (none currently assert skill content in the system prompt; if any do, update them to assert delivery via the attachment instead — see Task 5 patterns).
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Composition root wiring

**Verifies:** cache-friendliness.AC2.2 (end-to-end wiring; tested at unit level in Task 5)

**Files:**
- Modify: `src/index.ts`

**Implementation:**

1. Near the recall provider creation (~line 735), create the holder:

```typescript
  const skillsContextProvider = createSkillsContextProvider();
```

Import `createSkillsContextProvider` from the skill barrel.

2. In the `classifiedProviders` block (src/index.ts:1104-1170), register it following the recall pattern at ~1137-1141:

```typescript
  classifiedProviders.push({
    name: 'skills',
    provider: skillsContextProvider,
    classification: 'dynamic',
  });
```

Register the provider and pass the dep **unconditionally**. (Verified: `skillRegistry` is declared as `let skillRegistry: SkillRegistry | undefined` but is passed unconditionally as `skills: skillRegistry` at index.ts:~1298. The holder is safe without a registry — its provider returns `undefined` until a section is set, and the agent loop guards retrieval on `deps.skills && deps.skillsContextState`. Do NOT gate the registration or the dep on registry presence.)

3. Add `skillsContextState: skillsContextProvider` to the `AgentDependencies` object passed to `createAgent` (same place `skills: skillRegistry` is passed).

**Verification:**
Run: `bun run build`
Expected: no type errors.
Run: `bun test`
Expected: full suite passes (integration tests that need Postgres/Ollama skip or pass per their env guards).
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Agent-level unit tests for AC2

**Verifies:** cache-friendliness.AC2.1, cache-friendliness.AC2.2, cache-friendliness.AC2.3

**Files:**
- Modify: `src/agent/agent.test.ts`

**Testing:**

Build a small fake skill registry (hand-rolled, matching `SkillRegistry.getRelevant(message, maxSkills?, threshold?) => Promise<SkillDefinition[]>` — check the exact `SkillDefinition` shape in `src/skill/types.ts` and construct minimal valid objects). Wire deps the way index.ts does: create `createSkillsContextProvider()`, pass it both as `skillsContextState` and inside `classifiedProviders: [{ name: 'skills', provider: skillsContextProvider, classification: 'dynamic' }]`.

- **cache-friendliness.AC2.1 (unit):** Two consecutive `processMessage` calls on one agent, fake registry returns a non-empty skill list both times, request tracker on the mock model. Assert `tracker.requests[0].system === tracker.requests[1].system` (byte-identical), and that neither contains the skill section text.
- **cache-friendliness.AC2.2 (unit):** Single turn; assert the LAST message of `tracker.requests[0].messages` is the user message and its content contains the `[Dynamic Context — Full Snapshot]` header, the `## skills` section header (snapshot section header uses the provider name — see `formatSnapshotContent` in src/agent/snapshot.ts:47-51), and the skill section text.
- **cache-friendliness.AC2.3 (unit):** Fake registry whose `getRelevant` throws. Assert `processMessage` resolves to the mock model's text, and no skill content appears anywhere in `tracker.requests[0]` (system or messages).

**Verification:**
Run: `bun test src/agent/agent.test.ts -t "AC2"`
Expected: all pass.
Run: `bun test src/agent/ src/skill/`
Expected: all pass.

**Commit:** `feat(agent,skill): deliver skills via snapshot pipeline instead of system prompt`
<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_6 -->
### Task 6: Update subsystem docs

**Verifies:** None (documentation hygiene)

**Files:**
- Modify: `src/agent/CLAUDE.md` — the guarantee line "Relevant skills are injected into the system prompt per turn" becomes delivery via the snapshot pipeline; note the new `skillsContextState` dependency.
- Modify: `src/skill/CLAUDE.md` — add `createSkillsContextProvider` / `SkillsContextState` to the exposed API list.

**Step 1: Make both edits, keeping each file's existing structure and updating the "Last verified" date.**

**Step 2: Commit**

```bash
git add src/agent/CLAUDE.md src/skill/CLAUDE.md
git commit -m "docs: update agent/skill contracts for snapshot-delivered skills"
```
<!-- END_TASK_6 -->
