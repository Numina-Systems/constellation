# MCP

Last verified: 2026-09-09

## Purpose

Connects stdio/HTTP MCP servers and publishes validated, namespaced tools, prompts, and instructions through bounded, generation-safe discovery.

## Contracts

- **Exposes**: `McpClient`, discovery options/errors, client/provider adapters, schema mapping/validation, startup publication helpers, prompt skills, and MCP config schemas.
- **Guarantees**:
  - Tool names are `mcp_{server}_{tool}` with hyphens normalized to underscores. Duplicate original names and distinct normalized collisions fail before publication.
  - Each list operation has one absolute deadline and page cap. Defaults are 30000 ms and 64 pages. Caller cancellation, deadline expiry, repeated cursors, and page caps return typed errors with no partial result publication.
  - Discovery builds immutable generation-tagged snapshots off to the side. A stale or failed attempt leaves the prior generation intact; stale handlers fail rather than dispatch a newly mapped tool.
  - Full valid input schemas are retained. Flat parameters are only a model/stub projection. Nested objects/arrays, unions, and enums validate through the schema path; unsupported schema keywords fail closed with a bounded path diagnostic.
  - MCP result-level `isError`, structured content, and bounded text/image/audio/resource/resource-link descriptors are preserved. Transport/protocol failures remain distinct from result errors.
  - Failed startup clients are disconnected and later configured servers continue with a bounded visible summary. Shutdown disconnects connected clients.
  - `${VAR_NAME}` expansion applies to configured command, args, environment values, and URLs. MCP is disabled by default when its config section is absent.
- **Expects**: the pinned `@modelcontextprotocol/sdk` 1.29.0 API and valid per-server transport configuration.

## Dependencies

- **Uses**: MCP SDK, tool registry/types, custom-tool validator, skill types, agent context provider types, and config.
- **Used by**: composition root startup/shutdown and agent tool registry.
- **Boundary**: remote protocol data is bounded and summarized; raw protocol bodies/secrets are not logged.

## Key files

- `types.ts` -- discovery/result/generation contracts and defaults.
- `client.ts`, `discovery-bounds.ts` -- client calls and whole-operation bounds.
- `provider.ts`, `schema-mapper.ts` -- immutable generations and schema projection.
- `startup.ts` -- atomic publication, instructions, and startup summary.
- `skill-adapter.ts`, `env.ts`, `schema.ts`, `index.ts` -- prompt/config support and exports.
