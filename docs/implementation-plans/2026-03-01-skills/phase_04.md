# Skills System Implementation Plan — Phase 4: Agent Integration

**Goal:** Wire skill retrieval into the agent loop so relevant skills are injected into the system prompt per-turn based on the user's message.

**Architecture:** Add `skills?: SkillRegistry` to `AgentDependencies`. In the agent loop, after `buildSystemPrompt` returns the system prompt string, call `skills.getRelevant(userMessage)` to retrieve per-turn skills, format them via `formatSkillsSection`, and concatenate the result onto the system prompt. Add `max_skills_per_turn` and `skill_threshold` to `AgentConfig` for tunability.

**Tech Stack:** Bun, TypeScript 5.7+ (strict mode), bun:test

**Scope:** 5 phases from original design (phase 4 of 5)

**Codebase verified:** 2026-03-01

---

## Acceptance Criteria Coverage

This phase implements and tests:

### skills.AC6: Agent skill retrieval
- **skills.AC6.1 Success:** Skills matching the user message appear in the system prompt's `## Active Skills` section
- **skills.AC6.2 Success:** Only skills above the similarity threshold are included
- **skills.AC6.3 Success:** At most `max_skills_per_turn` skills are included per turn
- **skills.AC6.4 Success:** When no skills match, no `## Active Skills` section appears
- **skills.AC6.5 Success:** Agent functions correctly when `skills` dependency is not provided (optional)

### skills.AC7: Skill context formatting
- **skills.AC7.1 Success:** Each skill is formatted with its name as a heading and body as content
- **skills.AC7.2 Success:** Companion content is included after the skill body
- **skills.AC7.3 Success:** Skills are ordered by relevance score (highest first)

---

<!-- START_TASK_1 -->
### Task 1: Add skills to AgentDependencies and AgentConfig

**Verifies:** None (infrastructure — type changes only)

**Files:**
- Modify: `src/agent/types.ts` (lines 16-22 for AgentConfig, lines 44-54 for AgentDependencies)

**Implementation:**

Add two optional fields to `AgentConfig` (at `src/agent/types.ts:16-22`):

```typescript
  max_skills_per_turn?: number;   // default 3
  skill_threshold?: number;       // default 0.3
```

Add `skills` to `AgentDependencies` (at `src/agent/types.ts:44-54`):

```typescript
  skills?: SkillRegistry;
```

Add the import for `SkillRegistry` at the top of the file:

```typescript
import type { SkillRegistry } from '../skill/types.ts';
```

The full `AgentDependencies` after modification:

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
  skills?: SkillRegistry;
};
```

**Verification:**

Run: `bun run build`
Expected: Type-check passes (all existing code unaffected — new fields are optional)

**Commit:** `feat(skill): add skills to AgentDependencies and AgentConfig`

<!-- END_TASK_1 -->

<!-- START_SUBCOMPONENT_A (tasks 2-3) -->

<!-- START_TASK_2 -->
### Task 2: Skill context formatting and agent loop integration

**Verifies:** skills.AC6.1, skills.AC6.2, skills.AC6.3, skills.AC6.4, skills.AC6.5, skills.AC7.1, skills.AC7.2, skills.AC7.3

**Files:**
- Create: `src/skill/context.ts`
- Modify: `src/agent/agent.ts` (around line 87-101, the message processing loop)

**Implementation:**

Create `src/skill/context.ts` — a pure function that formats skill definitions into a system prompt section:

```typescript
// pattern: Functional Core

import type { SkillDefinition } from './types.ts';

export function formatSkillsSection(skills: ReadonlyArray<SkillDefinition>): string | undefined {
  if (skills.length === 0) return undefined;

  const sections = skills.map(skill => {
    const parts = [`### ${skill.metadata.name}\n\n${skill.body}`];
    for (const companion of skill.companions) {
      parts.push(`\n\n#### ${companion.name}\n\n${companion.content}`);
    }
    return parts.join('');
  });

  return `## Active Skills\n\n${sections.join('\n\n---\n\n')}`;
}
```

Modify `src/agent/agent.ts` — in the `processMessage` function, inside the while loop. The current code at line ~91 calls `buildSystemPrompt(deps.memory)` which returns a string. After that call, append the skill section:

```typescript
// Existing line (~91):
const systemPrompt = await buildSystemPrompt(deps.memory);

// Replace with:
let systemPrompt = await buildSystemPrompt(deps.memory);

// Retrieve and append relevant skills
if (deps.skills) {
  const maxSkills = deps.config.max_skills_per_turn ?? 3;
  const threshold = deps.config.skill_threshold ?? 0.3;
  const relevantSkills = await deps.skills.getRelevant(userMessage, maxSkills, threshold);
  const skillSection = formatSkillsSection(relevantSkills);
  if (skillSection) {
    systemPrompt += '\n\n' + skillSection;
  }
}
```

Add import at top of agent.ts:

```typescript
import { formatSkillsSection } from '../skill/context.ts';
```

This approach:
- Retrieves skills per-turn based on `userMessage`
- Directly appends to the system prompt string — no changes to `buildSystemPrompt` function signature
- Gracefully handles missing `skills` dependency (AC6.5) — the `if` block is skipped entirely
- Skills only appear when they match above threshold (AC6.2, AC6.4) — `getRelevant` filters by threshold, `formatSkillsSection` returns undefined for empty array
- Respects `max_skills_per_turn` limit (AC6.3) — passed as `limit` to `getRelevant`

**Note:** `userMessage` is the parameter to `processMessage` and is accessible inside the while loop. On subsequent rounds (tool loop), skills remain based on the initial user message — the user's intent doesn't change during tool execution rounds.

Update `src/skill/index.ts` to export the new function:

```typescript
export { formatSkillsSection } from './context.ts';
```

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(skill): integrate skill retrieval into agent loop`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Skill context formatting and agent integration tests

**Verifies:** skills.AC6.1, skills.AC6.2, skills.AC6.3, skills.AC6.4, skills.AC6.5, skills.AC7.1, skills.AC7.2, skills.AC7.3

**Files:**
- Create: `src/skill/context.test.ts`

**Implementation:**

Test both the `formatSkillsSection` pure function and the skill retrieval pipeline.

**Testing:**

**Part 1: formatSkillsSection unit tests**

- **skills.AC7.1:** Pass a single skill definition to `formatSkillsSection`. Verify output contains `## Active Skills`, `### skill-name`, and the skill body.
- **skills.AC7.2:** Pass a skill with companions. Verify output contains companion headings (`#### companion-name`) and content after the main body.
- **skills.AC7.3:** Pass 3 skills in a specific order. Verify output preserves that order (caller is responsible for sorting by relevance — `getRelevant` returns sorted).
- **skills.AC6.4:** Pass empty array to `formatSkillsSection`. Verify it returns `undefined`.

**Part 2: Skill injection pipeline tests**

Create a helper function that simulates the agent.ts skill injection logic (extracted for testability):

```typescript
async function buildSystemPromptWithSkills(
  basePrompt: string,
  skills: SkillRegistry | undefined,
  userMessage: string,
  maxSkills: number,
  threshold: number,
): Promise<string> {
  if (!skills) return basePrompt;
  const relevantSkills = await skills.getRelevant(userMessage, maxSkills, threshold);
  const section = formatSkillsSection(relevantSkills);
  return section ? basePrompt + '\n\n' + section : basePrompt;
}
```

Test this helper with a mock `SkillRegistry`:

- **skills.AC6.1:** Mock `getRelevant` to return 2 skills. Call helper. Verify result contains `## Active Skills` and both skill names.
- **skills.AC6.2:** Mock `getRelevant` that respects threshold (the mock should only return skills above threshold). Verify lower-similarity skills don't appear. This tests the contract — the actual filtering is in registry (Phase 3).
- **skills.AC6.3:** Mock `getRelevant` with a `limit` check — verify the helper passes `maxSkills` value through. Mock returns at most `limit` results.
- **skills.AC6.5:** Pass `undefined` for skills parameter. Verify base prompt returned unchanged.

**Part 3: Existing test compatibility**

Run: `bun test`
Expected: All existing tests still pass — `skills` field is optional, agent tests don't provide it, no behavior change.

**Verification:**

Run: `bun test src/skill/context.test.ts`
Expected: All tests pass

Run: `bun test`
Expected: All existing tests still pass

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(skill): add context formatting and integration tests`

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
