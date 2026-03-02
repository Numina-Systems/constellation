# Skill

Last verified: 2026-03-01

## Purpose
Embedding-based skill retrieval system. Skills are structured markdown files (SKILL.md) with YAML frontmatter that teach the agent how to approach specific situations. Retrieved per-turn via semantic similarity.

## Contracts
- **Exposes**: `parseSkillFile(content)`, `SkillStore` port interface, `SkillRegistry` interface, `createSkillRegistry(options)`, `createPostgresSkillStore(persistence)`, `loadSkills(options)`, `createSkillTools(registry)`, `formatSkillsSection(skills)`, all domain types (`SkillMetadata`, `SkillDefinition`, `SkillSource`, `SkillSearchResult`, `ParseResult`, `SkillToolDefinition`, `LoadResult`)
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
  - `formatSkillsSection` formats an array of skills into a markdown system prompt section (returns `undefined` if empty)
  - Skills are injected per-turn via `SkillRegistry.getRelevant()`, with errors logged and execution continuing (skills are optional/supplementary)
- **Expects**: `yaml` npm package for YAML parsing, `EmbeddingProvider` for skill embeddings

## Dependencies
- **Uses**: `src/tool/` (ToolParameter type), `yaml` (YAML parsing)
- **Used by**: `src/agent/` (per-turn skill retrieval and formatting), `src/index.ts` (composition root wires registry, store, and skill-defined tools)

## Key Decisions
- Embedding-based retrieval over system-prompt enumeration: Scales without bloating context
- Content-hash change detection: Skip re-embedding unchanged skills
- User skills override builtin: Explicit user intent to replace behaviour
- skill_embeddings table is a search index only: Source of truth is always SKILL.md files on disk

## Key Files
- `types.ts` — Domain types: `SkillMetadata`, `SkillDefinition`, `SkillSource`, `SkillSearchResult`, `ParseResult`, `SkillToolDefinition`, `LoadResult`, `SkillRegistry` interface
- `parser.ts` — Pure YAML frontmatter parser with Zod validation
- `store.ts` — `SkillStore` port interface for embedding persistence
- `postgres-store.ts` — PostgreSQL implementation of SkillStore
- `loader.ts` — Filesystem skill loader with change detection (phase 3)
- `registry.ts` — SkillRegistry implementation (phase 3)
- `context.ts` — `formatSkillsSection(skills)` for system prompt injection (phase 4)
- `tools.ts` — Agent-facing skill management tools: `skill_list`, `skill_read`, `skill_create`, `skill_update` (phase 5)
- `test-helpers.ts` — Shared test utilities (mock skill store, embedding provider, skill factories)
- `index.ts` — Barrel exports
