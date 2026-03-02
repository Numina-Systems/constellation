# Skills System — Test Requirements

Generated from: docs/design-plans/2026-03-01-skills.md

## Automated Test Coverage

### skills.AC1: Skill file parsing

| AC ID | Criterion | Test Type | Expected Test File | Phase / Task |
|-------|-----------|-----------|-------------------|--------------|
| skills.AC1.1 | Valid SKILL.md with all frontmatter fields (name, description, version, tags, companions, tools) parses to correct SkillMetadata + body | unit | src/skill/parser.test.ts | Phase 1, Task 2 |
| skills.AC1.2 | Valid SKILL.md with only required fields (name, description) parses successfully; optional fields absent | unit | src/skill/parser.test.ts | Phase 1, Task 2 |
| skills.AC1.3 | Missing required `name` field returns parse error with descriptive message | unit | src/skill/parser.test.ts | Phase 1, Task 2 |
| skills.AC1.4 | Missing required `description` field returns parse error with descriptive message | unit | src/skill/parser.test.ts | Phase 1, Task 2 |
| skills.AC1.5 | Invalid `name` format (not kebab-case) returns validation error | unit | src/skill/parser.test.ts | Phase 1, Task 2 |
| skills.AC1.6 | Description exceeding 500 chars returns validation error | unit | src/skill/parser.test.ts | Phase 1, Task 2 |
| skills.AC1.7 | Malformed YAML (invalid syntax) returns parse error | unit | src/skill/parser.test.ts | Phase 1, Task 2 |
| skills.AC1.8 | Missing frontmatter delimiters returns parse error | unit | src/skill/parser.test.ts | Phase 1, Task 2 |
| skills.AC1.9 | `tools` array in frontmatter validates against ToolParameter shape from src/tool/types.ts | unit | src/skill/parser.test.ts | Phase 1, Task 2 |

### skills.AC2: Skill embedding persistence

| AC ID | Criterion | Test Type | Expected Test File | Phase / Task |
|-------|-----------|-----------|-------------------|--------------|
| skills.AC2.1 | `upsertEmbedding` inserts a new skill embedding record with vector data | integration | src/skill/postgres-store.test.ts | Phase 2, Task 4 |
| skills.AC2.2 | `upsertEmbedding` updates an existing skill embedding when called with same ID | integration | src/skill/postgres-store.test.ts | Phase 2, Task 4 |
| skills.AC2.3 | `getByHash` returns the stored content hash for a known skill ID | integration | src/skill/postgres-store.test.ts | Phase 2, Task 4 |
| skills.AC2.4 | `getByHash` returns null for an unknown skill ID | integration | src/skill/postgres-store.test.ts | Phase 2, Task 4 |
| skills.AC2.5 | `searchByEmbedding` returns skills ranked by cosine similarity, highest first | integration | src/skill/postgres-store.test.ts | Phase 2, Task 4 |
| skills.AC2.6 | `searchByEmbedding` filters results below the similarity threshold | integration | src/skill/postgres-store.test.ts | Phase 2, Task 4 |
| skills.AC2.7 | `deleteEmbedding` removes a skill's embedding record | integration | src/skill/postgres-store.test.ts | Phase 2, Task 4 |
| skills.AC2.8 | `searchByEmbedding` respects the limit parameter | integration | src/skill/postgres-store.test.ts | Phase 2, Task 4 |

### skills.AC3: Skill configuration

| AC ID | Criterion | Test Type | Expected Test File | Phase / Task |
|-------|-----------|-----------|-------------------|--------------|
| skills.AC3.1 | Config parses `[skills]` section with builtin_dir, user_dir, max_per_turn, similarity_threshold | unit | src/config/config.test.ts | Phase 2, Task 2 |
| skills.AC3.2 | Config defaults are applied when `[skills]` section is present but fields are omitted | unit | src/config/config.test.ts | Phase 2, Task 2 |
| skills.AC3.3 | Config is fully optional — absence of `[skills]` section results in `undefined` | unit | src/config/config.test.ts | Phase 2, Task 2 |

### skills.AC4: Skill loading and change detection

| AC ID | Criterion | Test Type | Expected Test File | Phase / Task |
|-------|-----------|-----------|-------------------|--------------|
| skills.AC4.1 | Loader discovers SKILL.md files in `builtinDir/*/SKILL.md` pattern | unit | src/skill/loader.test.ts | Phase 3, Task 4 |
| skills.AC4.2 | Loader discovers SKILL.md files in `userDir/*/SKILL.md` pattern | unit | src/skill/loader.test.ts | Phase 3, Task 4 |
| skills.AC4.3 | User skills override builtin skills when names conflict | unit | src/skill/loader.test.ts | Phase 3, Task 4 |
| skills.AC4.4 | Unchanged skills (same content hash) are not re-embedded | unit | src/skill/loader.test.ts | Phase 3, Task 4 |
| skills.AC4.5 | Changed skills (different content hash) are re-embedded and upserted | unit | src/skill/loader.test.ts | Phase 3, Task 4 |
| skills.AC4.6 | Orphaned embeddings (skill removed from disk) are deleted from store | unit | src/skill/loader.test.ts | Phase 3, Task 4 |
| skills.AC4.7 | Companion files referenced in metadata are loaded with correct content | unit | src/skill/loader.test.ts | Phase 3, Task 4 |
| skills.AC4.8 | Missing companion file is reported as a warning, skill still loads | unit | src/skill/loader.test.ts | Phase 3, Task 4 |
| skills.AC4.9 | Skill IDs follow `skill:${source}:${name}` format | unit | src/skill/loader.test.ts | Phase 3, Task 4 |

### skills.AC5: Skill registry search

| AC ID | Criterion | Test Type | Expected Test File | Phase / Task |
|-------|-----------|-----------|-------------------|--------------|
| skills.AC5.1 | `getRelevant(context)` returns skills above similarity threshold | unit | src/skill/registry.test.ts | Phase 3, Task 6 |
| skills.AC5.2 | `getRelevant` respects `limit` parameter | unit | src/skill/registry.test.ts | Phase 3, Task 6 |
| skills.AC5.3 | `getAll()` returns all loaded skills | unit | src/skill/registry.test.ts | Phase 3, Task 6 |
| skills.AC5.4 | `getByName(name)` returns the skill with matching name, or undefined | unit | src/skill/registry.test.ts | Phase 3, Task 6 |
| skills.AC5.5 | `search(query)` returns `SkillSearchResult` array ranked by relevance | unit | src/skill/registry.test.ts | Phase 3, Task 6 |
| skills.AC5.6 | `createUserSkill` writes SKILL.md to user dir, parses, embeds, and adds to registry | unit | src/skill/registry.test.ts | Phase 3, Task 6 |
| skills.AC5.7 | `updateUserSkill` updates existing user skill on disk and in registry | unit | src/skill/registry.test.ts | Phase 3, Task 6 |
| skills.AC5.8 | `updateUserSkill` on a builtin skill returns error (user skills only) | unit | src/skill/registry.test.ts | Phase 3, Task 6 |

### skills.AC6: Agent skill retrieval

| AC ID | Criterion | Test Type | Expected Test File | Phase / Task |
|-------|-----------|-----------|-------------------|--------------|
| skills.AC6.1 | Skills matching the user message appear in the system prompt's `## Active Skills` section | unit | src/skill/context.test.ts | Phase 4, Task 3 |
| skills.AC6.2 | Only skills above the similarity threshold are included | unit | src/skill/context.test.ts | Phase 4, Task 3 |
| skills.AC6.3 | At most `max_skills_per_turn` skills are included per turn | unit | src/skill/context.test.ts | Phase 4, Task 3 |
| skills.AC6.4 | When no skills match, no `## Active Skills` section appears | unit | src/skill/context.test.ts | Phase 4, Task 3 |
| skills.AC6.5 | Agent functions correctly when `skills` dependency is not provided (optional) | unit | src/skill/context.test.ts | Phase 4, Task 3 |
| skills.AC6.5 | Existing agent tests continue to pass without `skills` dependency | regression | all agent test files (`bun test src/agent/`) | Phase 4, Task 3 |

### skills.AC7: Skill context formatting

| AC ID | Criterion | Test Type | Expected Test File | Phase / Task |
|-------|-----------|-----------|-------------------|--------------|
| skills.AC7.1 | Each skill is formatted with its name as a heading and body as content | unit | src/skill/context.test.ts | Phase 4, Task 3 |
| skills.AC7.2 | Companion content is included after the skill body | unit | src/skill/context.test.ts | Phase 4, Task 3 |
| skills.AC7.3 | Skills are ordered by relevance score (highest first) | unit | src/skill/context.test.ts | Phase 4, Task 3 |

### skills.AC8: Skill management tools

| AC ID | Criterion | Test Type | Expected Test File | Phase / Task |
|-------|-----------|-----------|-------------------|--------------|
| skills.AC8.1 | `skill_list` returns all skills with names, descriptions, sources, and tags | unit | src/skill/tools.test.ts | Phase 5, Task 2 |
| skills.AC8.2 | `skill_list` with `source` parameter filters by builtin or user | unit | src/skill/tools.test.ts | Phase 5, Task 2 |
| skills.AC8.3 | `skill_read` returns full skill content including companions | unit | src/skill/tools.test.ts | Phase 5, Task 2 |
| skills.AC8.4 | `skill_read` with unknown name returns error | unit | src/skill/tools.test.ts | Phase 5, Task 2 |
| skills.AC8.5 | `skill_create` creates a new user skill and returns confirmation | unit | src/skill/tools.test.ts | Phase 5, Task 2 |
| skills.AC8.6 | `skill_create` with invalid name format returns error | unit | src/skill/tools.test.ts | Phase 5, Task 2 |
| skills.AC8.7 | `skill_update` updates an existing user skill | unit | src/skill/tools.test.ts | Phase 5, Task 2 |
| skills.AC8.8 | `skill_update` on a builtin skill returns error | unit | src/skill/tools.test.ts | Phase 5, Task 2 |

### skills.AC9: Composition root wiring

| AC ID | Criterion | Test Type | Expected Test File | Phase / Task |
|-------|-----------|-----------|-------------------|--------------|
| skills.AC9.1 | Skills system initialises when `[skills]` config section is present | — | — | Phase 5, Task 3 |
| skills.AC9.2 | Skills system is skipped when `[skills]` config section is absent | — | — | Phase 5, Task 3 |
| skills.AC9.3 | Skill-defined tools are registered in the tool registry | — | — | Phase 5, Task 3 |
| skills.AC9.4 | Skill-defined tool handlers return the skill body as output | — | — | Phase 5, Task 3 |

## Human Verification

| AC ID | Criterion | Why Not Automated | Verification Approach |
|-------|-----------|-------------------|----------------------|
| skills.AC9.1 | Skills system initialises when `[skills]` config section is present | Composition root (`src/index.ts`) wires real dependencies (Postgres, embedding provider, filesystem). Isolating this for a unit test would require mocking the entire application bootstrap, providing no value beyond the individual component tests that already cover each piece. | Add `[skills]` section to `config.toml`, run `bun run start`, verify console output shows `skills loaded (N skills)`. Confirm agent context includes `## Active Skills` when a relevant message is sent. |
| skills.AC9.2 | Skills system is skipped when `[skills]` config section is absent | Same as AC9.1 — this tests the absence path through the composition root. The config parsing (AC3.3) is already unit-tested to return `undefined`. | Remove or comment out `[skills]` from `config.toml`, run `bun run start`, verify no skill-related console output and no errors. Verify agent operates normally without skill injection. |
| skills.AC9.3 | Skill-defined tools are registered in the tool registry | The registration loop in `src/index.ts` iterates over `skillRegistry.getAll()` and calls `registry.register()` for each tool definition. Both `getAll()` and `register()` are individually tested. The wiring is a 5-line loop with no branching logic beyond the null check, making a full-stack integration test overkill. | Create a test skill with a `tools` entry in its SKILL.md frontmatter (e.g., `generate_persona_template`). Start the daemon. Verify the tool appears in the agent's available tools (invoke it and confirm the response). |
| skills.AC9.4 | Skill-defined tool handlers return the skill body as output | The handler is a trivial closure: `async () => ({ success: true, output: \`[Skill: ${name}]\n\n${body}\` })`. Testing this in isolation would be testing a string template, not meaningful behaviour. The real verification is that the LLM receives the skill body when the tool is invoked. | Invoke a skill-defined tool via the agent REPL. Verify the tool output contains `[Skill: <name>]` followed by the skill's markdown body. Confirm the agent interprets and acts on the instructions. |

## Notes

### Test strategy overview

Tests are organized in three layers:

1. **Pure function unit tests** -- `parser.test.ts` and `context.test.ts` test the Functional Core directly: YAML parsing, Zod validation, context formatting. These are fast, deterministic, and cover the bulk of the AC1 and AC7 criteria.

2. **Component unit tests with mocks** -- `loader.test.ts`, `registry.test.ts`, and `tools.test.ts` use in-memory mock implementations of `SkillStore` and `EmbeddingProvider` to test the imperative shell without external dependencies. Temp filesystem directories are used for loader and registry tests. These cover AC4, AC5, and AC8.

3. **Integration tests** -- `postgres-store.test.ts` tests against a real PostgreSQL+pgvector instance. These require `docker compose up -d` and `bun run migrate` before running. These cover AC2.

### Integration test prerequisites

The postgres-store integration tests (AC2) require:
- Running PostgreSQL: `docker compose up -d`
- Applied migrations: `bun run migrate` (includes the `003_skill_embeddings.sql` migration from Phase 2, Task 1)
- Connection string: `postgresql://constellation:constellation@localhost:5432/constellation`

### Composition root coverage gap

AC9 criteria (AC9.1 through AC9.4) are deliberately left to human verification. The composition root is a wiring layer that connects already-tested components. Each individual component (config parsing, store, registry, tools, agent integration) has its own automated tests. The composition root itself is a straight-line sequence of factory calls and registrations with no complex logic worth isolating in a unit test.

### AC coverage redundancy

AC6 criteria appear in `context.test.ts` via a `buildSystemPromptWithSkills` helper that simulates the agent.ts injection logic. This is intentional -- it tests the contract between the agent and the skill system without requiring a full agent loop. The actual `agent.ts` modification is covered by regression (existing agent tests must pass unchanged).

### No real LLM or embedding calls

All automated tests use mocked providers. The semantic quality of skill retrieval (whether embedding similarity actually surfaces relevant skills for real user messages) is not testable via automation. That is an implicit human evaluation during use.
