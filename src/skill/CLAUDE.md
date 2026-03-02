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
