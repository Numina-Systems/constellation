# MCP Client Implementation Plan

**Goal:** Add MCP (Model Context Protocol) client support to Constellation, allowing it to connect to external MCP servers and surface their tools and prompts as first-class capabilities.

**Architecture:** Standalone `src/mcp/` module wrapping `@modelcontextprotocol/sdk`. Implements existing `ToolProvider` interface for tool discovery, adds skill adapter for MCP prompts, and wires into the composition root following the Bluesky DataSource lifecycle pattern.

**Tech Stack:** TypeScript 5.7+, Bun, Zod, `@modelcontextprotocol/sdk` v1.29+

**Scope:** 5 phases from original design (phases 1-5)

**Codebase verified:** 2026-04-05

---

## Acceptance Criteria Coverage

This phase implements and tests:

### mcp-client.AC5: Prompts surfaced through skill system
- **mcp-client.AC5.1 Success:** MCP prompts appear as SkillDefinitions with source 'mcp'
- **mcp-client.AC5.2 Success:** Virtual skills have correct IDs (skill:mcp:{server}:{name}) and kebab-case names
- **mcp-client.AC5.3 Success:** Virtual skills appear in skill_list and skill_read tool output
- **mcp-client.AC5.4 Success:** Virtual skills participate in semantic search for per-turn injection
- **mcp-client.AC5.5 Failure:** skill_create rejects creating a skill with source 'mcp'
- **mcp-client.AC5.6 Failure:** skill_update rejects updating a skill with source 'mcp'

---

## Phase 4: Skill Adapter

**Goal:** Convert MCP prompts into virtual skills for the skill registry, enabling per-turn injection and semantic search.

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Extend SkillSource to include 'mcp'

**Files:**
- Modify: `src/skill/types.ts` (line 5)

**Implementation:**

Change the `SkillSource` type at line 5 from:
```typescript
export type SkillSource = 'builtin' | 'agent';
```
to:
```typescript
export type SkillSource = 'builtin' | 'agent' | 'mcp';
```

Also update the error message in `src/skill/registry.ts:177`. The current message says `"cannot update builtin skill"` but it now guards both builtin and MCP skills. Change it to use the actual source:

```typescript
throw new Error(`cannot update ${existing.source} skill "${name}" — only agent skills can be updated`);
```

The existing guard `source !== 'agent'` is otherwise correct — it already protects MCP skills from modification via `updateAgentSkill()`. Similarly, `createAgentSkill()` hardcodes `source: 'agent'`, so no MCP skill can be created through that path.

**Verification:**

Run:
```bash
bun run build
```

Expected: Type-check passes. No code changes needed elsewhere — the union extension is backward-compatible.

Run:
```bash
bun test
```

Expected: All existing tests pass.

**Commit:**

```bash
git add src/skill/types.ts src/skill/registry.ts
git commit -m "feat(skill): extend SkillSource union to include 'mcp' and update guard error message"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add injectSkills() to SkillRegistry interface and implementation

**Files:**
- Modify: `src/skill/types.ts` (add method to `SkillRegistry` interface at line ~56)
- Modify: `src/skill/registry.ts` (add implementation)
- Modify: `src/skill/index.ts` (no changes expected — `SkillRegistry` is already re-exported as a type)

**Implementation:**

**2a: Add to interface** (`src/skill/types.ts`)

Add a new method to the `SkillRegistry` interface after `updateAgentSkill`:

```typescript
injectSkills(skills: ReadonlyArray<SkillDefinition>): Promise<void>;
```

This method accepts fully-formed `SkillDefinition` objects (the caller is responsible for constructing them) and adds them to the registry, making them available via `getAll()`, `getByName()`, `search()`, and `getRelevant()`.

**2b: Implement in registry** (`src/skill/registry.ts`)

Add the implementation inside the `createSkillRegistry` factory function, after the `updateAgentSkill` method (around line 200). The implementation:

1. For each skill in the input array:
   - Add to `skillsByName` map: `skillsByName.set(skill.metadata.name, skill)`
   - Add to `idToName` map: `idToName.set(skill.id, skill.metadata.name)`
2. For each skill, embed and upsert into the store:
   - Generate embedding: `const vector = await embedding.embed(skill.metadata.description + ' ' + skill.body)`
   - Upsert: `await store.upsertEmbedding(skill.id, skill.metadata.name, skill.metadata.description, skill.contentHash, vector)`
3. Log: `console.log(\`[skill] injected ${skills.length} virtual skills\`)`

This ensures injected skills participate in semantic search (`search()` and `getRelevant()` both use `store.searchByEmbedding()` which will find the embedded MCP skills).

**Verification:**

Run:
```bash
bun run build
```

Expected: Type-check passes.

**Commit:**

```bash
git add src/skill/types.ts src/skill/registry.ts
git commit -m "feat(skill): add injectSkills() method for non-filesystem skill sources"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Create MCP prompt-to-skill adapter

**Files:**
- Create: `src/mcp/skill-adapter.ts`
- Modify: `src/mcp/index.ts` (add re-export)

**Implementation:**

Mark as `// pattern: Functional Core` (pure transformation of MCP prompts into SkillDefinition objects).

Import `SkillDefinition` from `@/skill/types.ts`.
Import `McpClient`, `McpPromptInfo` from `./types.ts`.

Create a pure function:

```typescript
function mcpPromptToSkill(serverName: string, prompt: McpPromptInfo, body: string): SkillDefinition
```

Mapping:
- `id`: `\`skill:mcp:${serverName}:${prompt.name}\``
- `metadata.name`: Convert `prompt.name` to kebab-case (replace underscores and spaces with hyphens, lowercase)
- `metadata.description`: `prompt.description ?? \`MCP prompt from ${serverName}\``
- `metadata.version`: `undefined`
- `metadata.tags`: `['mcp', serverName]`
- `metadata.companions`: `undefined`
- `metadata.tools`: `undefined`
- `body`: The `body` parameter (resolved prompt content)
- `companions`: `[]` (empty — MCP prompts don't have companion files)
- `source`: `'mcp'`
- `filePath`: `\`mcp://${serverName}/${prompt.name}\`` (virtual path — not a real filesystem path)
- `contentHash`: Generate a simple hash from the body content. Use a deterministic approach: `crypto.createHash('sha256').update(body).digest('hex').slice(0, 16)` (import from `node:crypto`). Alternatively, use `Bun.hash(body).toString(16)` which is available in the Bun runtime.

Create a convenience function that fetches and converts all prompts from a client:

```typescript
async function mcpPromptsToSkills(client: McpClient): Promise<Array<SkillDefinition>>
```

This function:
1. Calls `client.listPrompts()` to get all prompt metadata
2. For each prompt, calls `client.getPrompt(prompt.name)` to get the full content
3. Concatenates the prompt messages into the body: `messages.map(m => m.content).join('\n\n')`
4. Calls `mcpPromptToSkill(client.serverName, prompt, body)` for each
5. Returns the array

Export both functions. Add re-exports to `src/mcp/index.ts`.

**Verification:**

Run:
```bash
bun run build
```

Expected: Type-check passes.

**Commit:**

```bash
git add src/mcp/skill-adapter.ts src/mcp/index.ts
git commit -m "feat(mcp): add prompt-to-skill adapter for converting MCP prompts to virtual skills"
```
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->

---

<!-- START_SUBCOMPONENT_B (tasks 4-6) -->
<!-- START_TASK_4 -->
### Task 4: Tests for mcpPromptToSkill pure function

**Verifies:** mcp-client.AC5.1, mcp-client.AC5.2

**Files:**
- Create: `src/mcp/skill-adapter.test.ts`

**Testing:**

- mcp-client.AC5.1 (source field): Create a skill via `mcpPromptToSkill('github', promptInfo, 'body text')`. Verify `skill.source === 'mcp'`.
- mcp-client.AC5.2 (ID format): Verify `skill.id === 'skill:mcp:github:code-review'` for a prompt named `'code-review'`.
- mcp-client.AC5.2 (kebab-case name): For a prompt with `name: 'code_review'`, verify `skill.metadata.name === 'code-review'`.
- mcp-client.AC5.2 (kebab-case with spaces): For a prompt with `name: 'Code Review'`, verify `skill.metadata.name === 'code-review'`.
- Test that `skill.body` matches the input body string.
- Test that `skill.companions` is an empty array.
- Test that `skill.filePath` starts with `'mcp://'`.
- Test that `skill.contentHash` is a non-empty string.
- Test that `skill.metadata.tags` includes `'mcp'` and the server name.
- Test that `skill.metadata.description` uses the prompt description when provided.
- Test that `skill.metadata.description` falls back to a default when prompt description is undefined.

**Verification:**

Run:
```bash
bun test src/mcp/skill-adapter.test.ts
```

Expected: All tests pass.

**Commit:**

```bash
git add src/mcp/skill-adapter.test.ts
git commit -m "test(mcp): add prompt-to-skill conversion tests covering AC5.1, AC5.2"
```
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Tests for skill_create and skill_update guards

**Verifies:** mcp-client.AC5.5, mcp-client.AC5.6

**Files:**
- Modify: `src/skill/tools.test.ts` (if exists) or create `src/mcp/skill-guard.test.ts`

**Testing:**

These tests verify that MCP skills cannot be created or updated through the skill tools.

First check if `src/skill/tools.test.ts` exists. If it does, append tests there. If not, create a new test file.

- mcp-client.AC5.5 (create rejection): This is implicitly enforced because `createAgentSkill()` hardcodes `source: 'agent'`. There's no code path to create an MCP skill through the tool. Test that calling `skill_create` tool results in a skill with `source: 'agent'`, never `'mcp'`. (This is a confirmation test, not a new guard.)

- mcp-client.AC5.6 (update rejection): Create a mock registry, inject an MCP skill via `injectSkills()`, then attempt to call `updateAgentSkill()` with the MCP skill's name. Verify it throws an error whose message contains `"mcp skill"` (confirming the updated error message from Task 1 includes the actual source type, not the old "builtin" message). The existing guard `source !== 'agent'` in `registry.ts:176-177` catches this.

Use the test helpers from `src/skill/test-helpers.ts` (which provides `createMockSkillStore()`, `createMockEmbeddingProvider()`, `createTestSkill()`).

**Verification:**

Run:
```bash
bun test src/skill/
```

Expected: All tests pass (existing + new).

Run:
```bash
bun test
```

Expected: All tests pass (no regressions).

**Commit:**

```bash
git add src/skill/tools.test.ts  # or src/mcp/skill-guard.test.ts
git commit -m "test(mcp): add skill create/update guard tests covering AC5.5, AC5.6"
```
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Tests for injectSkills and skill visibility

**Verifies:** mcp-client.AC5.3, mcp-client.AC5.4

**Files:**
- Create or modify: test file for skill registry injection (use `src/skill/registry.test.ts` if exists, otherwise `src/mcp/skill-inject.test.ts`)

**Testing:**

These tests verify that injected MCP skills appear in the registry and participate in search.

Create a skill registry using `createSkillRegistry()` with a mock store and mock embedding provider from `src/skill/test-helpers.ts`. Then inject a test MCP skill via `injectSkills()`.

- mcp-client.AC5.3 (getAll visibility): After injection, call `getAll()`. Verify the MCP skill appears in the returned array.
- mcp-client.AC5.3 (getByName visibility): After injection, call `getByName('the-skill-name')`. Verify it returns the injected MCP skill.
- mcp-client.AC5.3 (getByName returns null for unknown): Call `getByName('nonexistent')`. Verify it returns `null`.
- mcp-client.AC5.4 (embedding upserted): After injection, verify that the mock store's `upsertEmbedding` was called with the skill's ID. This confirms the skill will participate in semantic search.

Note: Testing actual semantic search results requires a real embedding pipeline. The upsert verification is sufficient to prove the skill participates in the search index.

**Verification:**

Run:
```bash
bun test src/skill/ src/mcp/
```

Expected: All tests pass.

**Commit:**

```bash
git add src/skill/registry.test.ts  # or src/mcp/skill-inject.test.ts
git commit -m "test(mcp): add skill injection and visibility tests covering AC5.3, AC5.4"
```
<!-- END_TASK_6 -->
<!-- END_SUBCOMPONENT_B -->
