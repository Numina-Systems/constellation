# Skills System Implementation Plan — Phase 1: Types + Parser + Store Port

**Goal:** Domain types, YAML frontmatter parser with Zod validation, and SkillStore port interface for the skills system.

**Architecture:** New `src/skill/` module following existing port/adapter pattern. Pure parser (Functional Core) with Zod schema validation. Store port defines the embedding persistence contract. Types reuse `ToolParameter` from `src/tool/types.ts`.

**Tech Stack:** Bun, TypeScript 5.7+ (strict mode), bun:test, Zod, yaml (npm package — new dependency)

**Scope:** 5 phases from original design (phase 1 of 5)

**Codebase verified:** 2026-03-01

---

## Acceptance Criteria Coverage

This phase implements and tests:

### skills.AC1: Skill file parsing
- **skills.AC1.1 Success:** Valid SKILL.md with all frontmatter fields (name, description, version, tags, companions, tools) parses to correct SkillMetadata + body
- **skills.AC1.2 Success:** Valid SKILL.md with only required fields (name, description) parses successfully with optional fields absent
- **skills.AC1.3 Failure:** Missing required `name` field returns parse error with descriptive message
- **skills.AC1.4 Failure:** Missing required `description` field returns parse error with descriptive message
- **skills.AC1.5 Failure:** Invalid `name` format (not kebab-case) returns validation error
- **skills.AC1.6 Failure:** Description exceeding 500 chars returns validation error
- **skills.AC1.7 Failure:** Malformed YAML (invalid syntax) returns parse error
- **skills.AC1.8 Failure:** Missing frontmatter delimiters returns parse error
- **skills.AC1.9 Success:** `tools` array in frontmatter validates against ToolParameter shape from src/tool/types.ts

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Install yaml dependency and create skill module types

**Verifies:** None (infrastructure)

**Files:**
- Modify: `package.json` (add `yaml` dependency)
- Create: `src/skill/types.ts`
- Create: `src/skill/CLAUDE.md`

**Implementation:**

Install the `yaml` package:

```bash
bun add yaml
```

Create `src/skill/types.ts` with domain types. Reuse `ToolParameter` from `src/tool/types.ts` for skill-defined tool parameters:

```typescript
// pattern: Functional Core

import type { ToolParameter } from '../tool/types.ts';

export type SkillSource = 'builtin' | 'user';

export type SkillToolDefinition = {
  readonly name: string;
  readonly description: string;
  readonly parameters: ReadonlyArray<ToolParameter>;
};

export type SkillMetadata = {
  readonly name: string;
  readonly description: string;
  readonly version?: string;
  readonly tags?: ReadonlyArray<string>;
  readonly companions?: ReadonlyArray<string>;
  readonly tools?: ReadonlyArray<SkillToolDefinition>;
};

export type SkillDefinition = {
  readonly id: string;
  readonly metadata: SkillMetadata;
  readonly body: string;
  readonly companions: ReadonlyArray<{ readonly name: string; readonly content: string }>;
  readonly source: SkillSource;
  readonly filePath: string;
  readonly contentHash: string;
};

export type SkillSearchResult = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly score: number;
};

export type ParseResult =
  | { readonly success: true; readonly metadata: SkillMetadata; readonly body: string }
  | { readonly success: false; readonly error: string };
```

Create `src/skill/CLAUDE.md`:

```markdown
# Skill

Last verified: 2026-03-01

## Purpose
Embedding-based skill retrieval system. Skills are structured markdown files (SKILL.md) with YAML frontmatter that teach the agent how to approach specific situations. Retrieved per-turn via semantic similarity.

## Contracts
- **Exposes**: `parseSkillFile(content)`, `SkillStore` port interface, all domain types (`SkillMetadata`, `SkillDefinition`, `SkillSource`, `SkillSearchResult`, `ParseResult`, `SkillToolDefinition`)
- **Guarantees**:
  - `parseSkillFile` validates frontmatter with Zod, returns discriminated ParseResult
- **Expects**: `yaml` npm package for YAML parsing

*Note: This CLAUDE.md will be expanded in later phases as the module grows (registry, loader, tools, agent integration).*

## Dependencies
- **Uses**: `src/tool/` (ToolParameter type), `yaml` (YAML parsing)
- **Used by**: (later phases will add consumers)

## Key Decisions
- Embedding-based retrieval over system-prompt enumeration: Scales without bloating context
- Content-hash change detection: Skip re-embedding unchanged skills
- User skills override builtin: Explicit user intent to replace behaviour
- skill_embeddings table is a search index only: Source of truth is always SKILL.md files on disk

## Key Files
- `types.ts` — Domain types: `SkillMetadata`, `SkillDefinition`, `SkillSource`, `SkillSearchResult`, `ParseResult`, `SkillToolDefinition`
- `parser.ts` — Pure YAML frontmatter parser with Zod validation
- `store.ts` — `SkillStore` port interface for embedding persistence
- `index.ts` — Barrel exports
```

**Verification:**

Run: `bun run build`
Expected: Type-check passes with no errors

**Commit:** `feat(skill): add domain types and module docs`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Skill file parser with Zod validation

**Verifies:** skills.AC1.1, skills.AC1.2, skills.AC1.3, skills.AC1.4, skills.AC1.5, skills.AC1.6, skills.AC1.7, skills.AC1.8, skills.AC1.9

**Files:**
- Create: `src/skill/parser.ts`
- Create: `src/skill/parser.test.ts`

**Implementation:**

Create `src/skill/parser.ts`. This is a pure function that:
1. Extracts content between `---` frontmatter delimiters
2. Parses the YAML string with the `yaml` package
3. Validates with a Zod schema
4. Returns a discriminated `ParseResult`

The Zod schema validates:
- `name`: required, matches `/^[a-z0-9-]+$/` (kebab-case)
- `description`: required, max 500 chars
- `version`: optional string
- `tags`: optional array of strings
- `companions`: optional array of strings (relative paths)
- `tools`: optional array matching `ToolParameter`-compatible shape (name, description, parameters array with name/type/description/required)

```typescript
// pattern: Functional Core

import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import type { SkillMetadata, ParseResult } from './types.ts';
import type { ToolParameterType } from '../tool/types.ts';

// Zod's z.enum requires a mutable tuple type; cast is unavoidable here
const TOOL_PARAMETER_TYPES: ReadonlyArray<ToolParameterType> = [
  'string', 'number', 'boolean', 'object', 'array',
];

const SkillToolParameterSchema = z.object({
  name: z.string(),
  type: z.enum(TOOL_PARAMETER_TYPES as [string, ...Array<string>]),
  description: z.string(),
  required: z.boolean(),
  enum_values: z.array(z.string()).optional(),
});

const SkillToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.array(SkillToolParameterSchema),
});

const SkillMetadataSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/, 'name must be kebab-case (lowercase letters, numbers, hyphens)'),
  description: z.string().max(500, 'description must be 500 characters or fewer'),
  version: z.string().optional(),
  tags: z.array(z.string()).optional(),
  companions: z.array(z.string()).optional(),
  tools: z.array(SkillToolDefinitionSchema).optional(),
});

function extractFrontmatter(content: string): { yaml: string; body: string } | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  return { yaml: match[1], body: match[2] };
}

export function parseSkillFile(content: string): ParseResult {
  const extracted = extractFrontmatter(content);
  if (!extracted) {
    return { success: false, error: 'missing or malformed frontmatter delimiters' };
  }

  let raw: unknown;
  try {
    raw = parseYaml(extracted.yaml);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `invalid YAML: ${message}` };
  }

  const result = SkillMetadataSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { success: false, error: `validation failed: ${issues}` };
  }

  return {
    success: true,
    metadata: result.data as SkillMetadata,
    body: extracted.body.trim(),
  };
}
```

**Testing:**

Tests must verify each AC listed above. Follow project test patterns:
- Use `describe`/`it` blocks from `bun:test`, colocated as `src/skill/parser.test.ts`
- Name describe blocks with AC references
- File starts with `// pattern: Functional Core`

Tests to write:

- **skills.AC1.1:** Parse a complete SKILL.md with all frontmatter fields (name, description, version, tags, companions, tools with parameters). Verify all metadata fields are present and correct. Verify body content is trimmed and correct.
- **skills.AC1.2:** Parse SKILL.md with only `name` and `description`. Verify success, verify optional fields are undefined.
- **skills.AC1.3:** Parse SKILL.md where `name` is missing. Verify `success: false`, error mentions "name".
- **skills.AC1.4:** Parse SKILL.md where `description` is missing. Verify `success: false`, error mentions "description".
- **skills.AC1.5:** Parse SKILL.md where name is "Invalid Name" (has uppercase/spaces). Verify `success: false`, error mentions kebab-case.
- **skills.AC1.6:** Parse SKILL.md where description is 501+ chars. Verify `success: false`, error mentions 500 characters.
- **skills.AC1.7:** Parse SKILL.md with syntactically invalid YAML (e.g., `name: [unterminated`). Verify `success: false`, error mentions "invalid YAML".
- **skills.AC1.8:** Parse content with no `---` delimiters. Verify `success: false`, error mentions "frontmatter delimiters".
- **skills.AC1.9:** Parse SKILL.md with `tools` array containing a tool with name, description, and parameters array (matching ToolParameter shape). Verify the parsed tool has correct structure.

Edge cases:
- Empty body after frontmatter — should parse successfully with empty string body
- Frontmatter with extra unknown fields — Zod strips them, parse succeeds
- Body containing `---` (not at start) — should not be confused with frontmatter delimiter

**Verification:**

Run: `bun test src/skill/parser.test.ts`
Expected: All tests pass

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(skill): implement YAML frontmatter parser with Zod validation`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: SkillStore port interface

**Verifies:** None (infrastructure — port interface only, no implementation)

**Files:**
- Create: `src/skill/store.ts`

**Implementation:**

Create `src/skill/store.ts` defining the `SkillStore` port interface. This follows the same port pattern as other modules — the interface defines what the store must do, the adapter (Phase 2) implements it.

```typescript
// pattern: Functional Core

export interface SkillStore {
  upsertEmbedding(id: string, name: string, description: string, contentHash: string, embedding: ReadonlyArray<number>): Promise<void>;
  deleteEmbedding(id: string): Promise<void>;
  getByHash(id: string): Promise<string | null>;
  searchByEmbedding(embedding: ReadonlyArray<number>, limit: number, threshold: number): Promise<ReadonlyArray<{ id: string; score: number }>>;
}
```

- `upsertEmbedding`: Insert or update a skill's embedding vector and metadata
- `deleteEmbedding`: Remove a skill's embedding (orphan cleanup)
- `getByHash`: Return the content hash for a skill ID (change detection — if hash matches, skip re-embedding)
- `searchByEmbedding`: Find skills by cosine similarity, returning IDs and scores above threshold

**Verification:**

Run: `bun run build`
Expected: Type-check passes

**Commit:** `feat(skill): add SkillStore port interface`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Barrel exports

**Verifies:** None (infrastructure)

**Files:**
- Create: `src/skill/index.ts`

**Implementation:**

Create `src/skill/index.ts` following the project's barrel export pattern (see `src/tool/index.ts` for reference):

```typescript
// pattern: Functional Core

export type {
  SkillSource,
  SkillToolDefinition,
  SkillMetadata,
  SkillDefinition,
  SkillSearchResult,
  ParseResult,
} from './types.ts';

export type { SkillStore } from './store.ts';

export { parseSkillFile } from './parser.ts';
```

**Verification:**

Run: `bun run build`
Expected: Type-check passes

Run: `bun test src/skill/`
Expected: All parser tests still pass

**Commit:** `feat(skill): add barrel exports`

<!-- END_TASK_4 -->
