# Skills System Implementation Plan — Phase 5: Skill Authoring Tools + Composition Root

**Goal:** Agent-facing skill management tools and composition root wiring to make the full skills system operational.

**Architecture:** Tool factory creates 4 agent tools (`skill_list`, `skill_read`, `skill_create`, `skill_update`) following `src/tool/builtin/memory.ts` pattern. Composition root in `src/index.ts` wires SkillStore, SkillRegistry, registers skill management tools, registers skill-defined tools, and passes the registry to the agent. Gated by presence of `config.skills` — system is fully optional.

**Tech Stack:** Bun, TypeScript 5.7+ (strict mode), bun:test

**Scope:** 5 phases from original design (phase 5 of 5)

**Codebase verified:** 2026-03-01

---

## Acceptance Criteria Coverage

This phase implements and tests:

### skills.AC8: Skill management tools
- **skills.AC8.1 Success:** `skill_list` returns all skills with names, descriptions, sources, and tags
- **skills.AC8.2 Success:** `skill_list` with `source` parameter filters by builtin or user
- **skills.AC8.3 Success:** `skill_read` returns full skill content including companions
- **skills.AC8.4 Failure:** `skill_read` with unknown name returns error
- **skills.AC8.5 Success:** `skill_create` creates a new user skill and returns confirmation
- **skills.AC8.6 Failure:** `skill_create` with invalid name format returns error
- **skills.AC8.7 Success:** `skill_update` updates an existing user skill
- **skills.AC8.8 Failure:** `skill_update` on a builtin skill returns error

### skills.AC9: Composition root wiring
- **skills.AC9.1 Success:** Skills system initialises when `[skills]` config section is present
- **skills.AC9.2 Success:** Skills system is skipped when `[skills]` config section is absent
- **skills.AC9.3 Success:** Skill-defined tools are registered in the tool registry
- **skills.AC9.4 Success:** Skill-defined tool handlers return the skill body as output

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Skill management tools

**Verifies:** skills.AC8.1, skills.AC8.2, skills.AC8.3, skills.AC8.4, skills.AC8.5, skills.AC8.6, skills.AC8.7, skills.AC8.8

**Files:**
- Create: `src/skill/tools.ts`

**Implementation:**

Create `src/skill/tools.ts` following the `src/tool/builtin/memory.ts` factory pattern:

```typescript
// pattern: Imperative Shell

import type { Tool, ToolResult } from '../tool/types.ts';
import type { SkillRegistry } from './types.ts';

export function createSkillTools(registry: SkillRegistry): Array<Tool> {
  // ... tool definitions
  return [skill_list, skill_read, skill_create, skill_update];
}
```

**Tool definitions:**

**`skill_list`:**
- Parameters: `source` (string, optional, enum_values: `['builtin', 'user']`)
- Handler: Call `registry.getAll()`, optionally filter by source, return JSON array of `{ name, description, source, tags }` objects
- Returns: `{ success: true, output: JSON.stringify(skills, null, 2) }`

**`skill_read`:**
- Parameters: `name` (string, required)
- Handler: Call `registry.getByName(name)`. If not found, return `{ success: false, output: '', error: 'skill not found: ${name}' }`. If found, format as: metadata summary + full body + companion contents
- Returns: `{ success: true, output: formattedContent }`

**`skill_create`:**
- Parameters: `name` (string, required), `description` (string, required), `body` (string, required), `tags` (string, optional — comma-separated, split into array)
- Handler: Call `registry.createUserSkill(name, description, body, tagsArray)`. Wrap in try/catch — parse errors from invalid name format will throw.
- Returns: `{ success: true, output: 'created skill: ${name}' }` or error

**`skill_update`:**
- Parameters: `name` (string, required), `description` (string, required), `body` (string, required), `tags` (string, optional)
- Handler: Call `registry.updateUserSkill(name, description, body, tagsArray)`. Wrap in try/catch — builtin skill errors will throw.
- Returns: `{ success: true, output: 'updated skill: ${name}' }` or error

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(skill): implement skill management tools`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Skill management tool tests

**Verifies:** skills.AC8.1, skills.AC8.2, skills.AC8.3, skills.AC8.4, skills.AC8.5, skills.AC8.6, skills.AC8.7, skills.AC8.8

**Files:**
- Create: `src/skill/tools.test.ts`

**Implementation:**

Tests use a mock `SkillRegistry` with pre-loaded skills. Create an in-memory registry mock:

```typescript
function createMockRegistry(skills: Array<SkillDefinition>): SkillRegistry {
  const map = new Map(skills.map(s => [s.metadata.name, s]));
  return {
    async load() {},
    getAll: () => Array.from(map.values()),
    getByName: (name) => map.get(name),
    async search() { return []; },
    async getRelevant() { return []; },
    async createUserSkill(name, description, body, tags) {
      // Validate name format
      if (!/^[a-z0-9-]+$/.test(name)) throw new Error('invalid name format');
      const skill: SkillDefinition = { /* construct */ };
      map.set(name, skill);
      return skill;
    },
    async updateUserSkill(name, description, body, tags) {
      const existing = map.get(name);
      if (!existing) throw new Error('skill not found');
      if (existing.source === 'builtin') throw new Error('cannot update builtin skill');
      const updated: SkillDefinition = { /* construct */ };
      map.set(name, updated);
      return updated;
    },
  };
}
```

**Testing:**

Tests to write:

- **skills.AC8.1:** Create tools with a registry containing 3 skills. Call `skill_list` handler. Verify JSON output contains all 3 skills with name, description, source, tags fields.
- **skills.AC8.2:** Create tools with builtin and user skills. Call `skill_list` handler with `{ source: 'user' }`. Verify only user skills returned.
- **skills.AC8.3:** Create tools with a skill that has companions. Call `skill_read` handler with `{ name: 'test-skill' }`. Verify output contains skill body and companion content.
- **skills.AC8.4:** Call `skill_read` handler with `{ name: 'nonexistent' }`. Verify `success: false` and error message.
- **skills.AC8.5:** Call `skill_create` handler with valid name, description, body. Verify `success: true` and skill appears in `getAll()`.
- **skills.AC8.6:** Call `skill_create` handler with `{ name: 'Invalid Name' }`. Verify `success: false` and error about name format.
- **skills.AC8.7:** Create a user skill, then call `skill_update` handler with new description. Verify `success: true`.
- **skills.AC8.8:** Try to update a builtin skill. Verify `success: false` and error about builtin skills.

**Verification:**

Run: `bun test src/skill/tools.test.ts`
Expected: All tests pass

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(skill): add skill management tool tests`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Composition root wiring

**Verifies:** skills.AC9.1, skills.AC9.2, skills.AC9.3, skills.AC9.4

**Files:**
- Modify: `src/index.ts` (insert after web tools registration at ~line 348, before agent creation at ~line 420)

**Implementation:**

Add skill system wiring to `src/index.ts`. Insert between the web tools section (ending ~line 348) and the agent creation section (starting ~line 420).

Add imports at top of file:

```typescript
import { createPostgresSkillStore } from './skill/postgres-store.ts';
import { createSkillRegistry } from './skill/registry.ts';
import { createSkillTools } from './skill/tools.ts';
import type { SkillRegistry } from './skill/types.ts';
```

Add the wiring block (after web tools, before agent creation):

```typescript
// Skills system (optional)
let skillRegistry: SkillRegistry | undefined;

if (config.skills) {
  const skillStore = createPostgresSkillStore(persistence);
  skillRegistry = createSkillRegistry({
    store: skillStore,
    embedding,
    builtinDir: config.skills.builtin_dir,
    userDir: config.skills.user_dir,
  });
  await skillRegistry.load();

  // Register skill management tools
  const skillTools = createSkillTools(skillRegistry);
  for (const tool of skillTools) {
    registry.register(tool);
  }

  // Register skill-defined tools
  for (const skill of skillRegistry.getAll()) {
    if (skill.metadata.tools) {
      for (const toolDef of skill.metadata.tools) {
        registry.register({
          definition: {
            name: toolDef.name,
            description: toolDef.description,
            parameters: toolDef.parameters,
          },
          handler: async () => ({
            success: true,
            output: `[Skill: ${skill.metadata.name}]\n\n${skill.body}`,
          }),
        });
      }
    }
  }

  console.log(`skills loaded (${skillRegistry.getAll().length} skills)`);
}
```

Modify the `createAgent` call to include skills:

```typescript
const agent = createAgent({
  model,
  memory,
  registry,
  runtime,
  persistence,
  config: {
    max_tool_rounds: config.agent.max_tool_rounds,
    context_budget: config.agent.context_budget,
    model_max_tokens: DEFAULT_MODEL_MAX_TOKENS,
    model_name: config.model.name,
    max_skills_per_turn: config.skills?.max_per_turn,
    skill_threshold: config.skills?.similarity_threshold,
  },
  getExecutionContext,
  compactor,
  skills: skillRegistry,
});
```

**Note on skill-defined tools (AC9.3, AC9.4):** When a skill has `tools` in its metadata, each tool is registered with the ToolRegistry. The handler returns the skill's body as instructions — the LLM reads the instructions and uses existing tools to carry them out. This keeps skills purely declarative.

**Verification:**

Run: `bun run build`
Expected: Type-check passes

Run: `bun test`
Expected: All tests pass (skills are optional — no config = no change)

**Commit:** `feat(skill): wire skills into composition root`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Final barrel exports update

**Verifies:** None (infrastructure)

**Files:**
- Modify: `src/skill/index.ts`

**Implementation:**

Ensure all public APIs are exported from the barrel:

```typescript
// pattern: Functional Core

export type {
  SkillSource,
  SkillToolDefinition,
  SkillMetadata,
  SkillDefinition,
  SkillSearchResult,
  ParseResult,
  LoadResult,
  SkillRegistry,
} from './types.ts';

export type { SkillStore } from './store.ts';

export { parseSkillFile } from './parser.ts';
export { createPostgresSkillStore } from './postgres-store.ts';
export { loadSkills } from './loader.ts';
export { createSkillRegistry } from './registry.ts';
export { createSkillTools } from './tools.ts';
export { formatSkillsSection } from './context.ts';
```

**Verification:**

Run: `bun run build`
Expected: Type-check passes

Run: `bun test`
Expected: All tests pass

**Commit:** `feat(skill): complete barrel exports for skill module`

<!-- END_TASK_4 -->
