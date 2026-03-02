# Skill

Last verified: 2026-03-01

## Purpose
Embedding-based skill retrieval system. Skills are structured markdown files (SKILL.md) with YAML frontmatter that teach the agent how to approach specific situations. Retrieved per-turn via semantic similarity.

## Contracts
- **Exposes**: `parseSkillFile(content)`, `SkillStore` port interface, `SkillRegistry` interface, all domain types (`SkillMetadata`, `SkillDefinition`, `SkillSource`, `SkillSearchResult`, `ParseResult`, `SkillToolDefinition`, `LoadResult`)
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
- **Expects**: `yaml` npm package for YAML parsing, `EmbeddingProvider` for skill embeddings

*Note: This CLAUDE.md reflects phase 3 (loader + registry). Future phases will add skill authoring tools and agent integration.*

## Dependencies
- **Uses**: `src/tool/` (ToolParameter type), `yaml` (YAML parsing)
- **Used by**: (later phases will add consumers)

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
- `index.ts` — Barrel exports
