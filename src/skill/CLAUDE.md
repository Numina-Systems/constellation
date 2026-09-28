# Skill

Last verified: 2026-07-03

## Purpose
Embedding-based skill retrieval system. Skills are structured markdown files (SKILL.md) with YAML frontmatter that teach the agent how to approach specific situations. Retrieved per-turn via semantic similarity.

## Contracts
- **Exposes**: `parseSkillFile(content)`, `SkillStore` port interface, `SkillRegistry` interface (including `injectSkills()`), `createSkillRegistry(options)`, `createPostgresSkillStore(persistence)`, `loadSkills(options)`, `createSkillTools(registry)`, `formatSkillsSection(skills)`, `createSkillsContextProvider()`, `SkillsContextState` type, all domain types (`SkillMetadata`, `SkillDefinition`, `SkillSource`, `SkillSearchResult`, `ParseResult`, `SkillToolDefinition`, `LoadResult`)
- **SkillStore interface methods**:
  - `upsertEmbedding()` — Write or update skill embedding
  - `deleteEmbedding()` — Remove skill embedding
  - `getByHash()` — Check content hash for change detection
  - `searchByEmbedding()` — Semantic similarity search
  - `getAllIds()` — Get all skill IDs for orphan cleanup
- **Guarantees**:
  - `parseSkillFile` validates frontmatter with Zod, returns discriminated ParseResult
  - `SkillRegistry` provides unified interface for loading, searching, and managing skills
  - `LoadResult` captures both successful loads and errors from the loader
  - `getAllIds()` enables orphan cleanup when skills are removed from disk
  - `injectSkills()` accepts non-filesystem skill sources (e.g. MCP prompts) and embeds them for semantic retrieval
  - `SkillSource` is `'builtin' | 'agent' | 'mcp'` -- only `'agent'` skills can be updated via `updateAgentSkill()`
  - `formatSkillsSection` formats an array of skills into a markdown system prompt section (returns `undefined` if empty)
  - `createSkillsContextProvider()` returns a callable provider + state object (matching `RecallContextState` pattern): `provider()` returns current section, `setSection()` updates it, `getSection()` reads it
  - `SkillsContextState` holder is created in the composition root and registered as a dynamic classified provider named 'skills'
  - Skills are retrieved once per turn via `SkillRegistry.getRelevant()` and delivered via the snapshot pipeline, not appended to system prompt
  - Retrieval errors are logged and execution continues; the holder is cleared (no skill section appended)
- **Expects**: `yaml` npm package for YAML parsing, `EmbeddingProvider` for skill embeddings

## Dependencies
- **Uses**: `src/tool/` (ToolParameter type), `src/agent/types.ts` (ContextProvider type), `yaml` (YAML parsing)
- **Used by**: `src/agent/` (per-turn skill retrieval via registry, delivery via skillsContextState holder in snapshot pipeline), `src/index.ts` (composition root creates holder, registers as dynamic provider, wires registry and holder to agent), `src/mcp/` (prompt-to-skill conversion via `injectSkills()`)

## Key Decisions
- Embedding-based retrieval over system-prompt enumeration: Scales without bloating context
- Content-hash change detection: Skip re-embedding unchanged skills
- Agent skills override builtin: Explicit intent to replace behaviour
- skill_embeddings table is a search index only: Source of truth is always SKILL.md files on disk

## Key Files
- `types.ts` — Domain types: `SkillMetadata`, `SkillDefinition`, `SkillSource`, `SkillSearchResult`, `ParseResult`, `SkillToolDefinition`, `LoadResult`, `SkillRegistry` interface
- `parser.ts` — Pure YAML frontmatter parser with Zod validation
- `store.ts` — `SkillStore` port interface for embedding persistence
- `postgres-store.ts` — PostgreSQL implementation of SkillStore
- `loader.ts` — Filesystem skill loader with change detection (phase 3)
- `registry.ts` — SkillRegistry implementation (phase 3)
- `context.ts` — `formatSkillsSection(skills)` formatter, `createSkillsContextProvider()` factory, `SkillsContextState` type (snapshot pipeline delivery; phase 4)
- `tools.ts` — Agent-facing skill management tools: `skill_list`, `skill_read`, `skill_create`, `skill_update` (phase 5)
- `test-helpers.ts` — Shared test utilities (mock skill store, embedding provider, skill factories)
- `index.ts` — Barrel exports
