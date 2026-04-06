# MCP

Last verified: 2026-04-05

## Purpose
Model Context Protocol client integration. Connects to external MCP servers (stdio or HTTP transport) to discover and bridge remote tools, prompts, and instructions into the agent's runtime. Tools are namespaced and registered in the tool registry; prompts are converted to virtual skills; server instructions become context providers.

## Contracts
- **Exposes**: `McpClient` interface, `createMcpClient(serverName, config)`, `createMcpToolProvider(client)`, `mcpPromptsToSkills(client)`, `mcpPromptToSkill(serverName, prompt, body)`, `resolveEnvVars(value, env)`, `resolveServerConfigEnv(config, env)`, `buildTransportOptions(config, processEnv)`, `mapInputSchemaToParameters(schema)`, `namespaceTool(serverName, toolName)`, `createMcpInstructionsProvider(serverName, instructions)`, `formatMcpStartupSummary(connected, failed)`, config schemas (`McpConfigSchema`, `McpServerConfigSchema`, `McpStdioServerConfigSchema`, `McpHttpServerConfigSchema`), domain types (`McpToolInfo`, `McpPromptInfo`, `McpPromptResult`, `McpConfig`, `McpServerConfig`)
- **Guarantees**:
  - Tool names are namespaced as `mcp_{serverName}_{toolName}` with hyphens converted to underscores
  - Failed server connections do not block startup (graceful degradation)
  - Disconnected clients return empty arrays for discovery and error results for execution
  - Config supports `${VAR_NAME}` env var expansion in command, args, env values, and URLs
  - Config uses discriminated union on `transport` field: `"stdio"` or `"http"`
  - MCP section defaults to `{ enabled: false, servers: {} }` when absent from config
  - Prompts converted to skills use `source: 'mcp'` and `filePath: 'mcp://{server}/{prompt}'`
  - Server instructions (when present) are injected as context providers formatted `[MCP: {serverName}]\n{instructions}`
- **Expects**: `@modelcontextprotocol/sdk` package, valid `McpServerConfig` per server

## Dependencies
- **Uses**: `@modelcontextprotocol/sdk` (Client, StdioClientTransport, StreamableHTTPClientTransport), `src/tool/types.ts` (ToolDefinition, ToolResult), `src/extensions/tool-provider.ts` (ToolProvider interface), `src/skill/types.ts` (SkillDefinition), `src/agent/types.ts` (ContextProvider)
- **Used by**: `src/index.ts` (composition root connects servers, registers tools, injects skills, wires shutdown), `src/config/schema.ts` (imports McpConfigSchema into AppConfigSchema)

## Key Decisions
- Namespaced tool names over pass-through: Prevents collisions between servers and with built-in tools
- ToolProvider interface reuse: MCP tools bridge through existing extension interface rather than special-casing
- Prompt-to-skill conversion: MCP prompts become virtual skills with embedding-based retrieval rather than static system prompt injection
- Graceful degradation: Each server connects independently; failures are logged and skipped

## Invariants
- `McpClient.serverName` is immutable after creation
- Tool name map is rebuilt on every `discover()` call (stateless between discoveries)
- Shutdown handler disconnects all connected clients via `Promise.allSettled`

## Key Files
- `types.ts` -- Domain types: `McpClient` interface, `McpToolInfo`, `McpPromptInfo`, `McpPromptResult`
- `schema.ts` -- Zod config schemas with discriminated union for stdio/http transports
- `env.ts` -- Pure `${VAR_NAME}` expansion for config values
- `client.ts` -- `createMcpClient` factory, `buildTransportOptions`, `mapToolResult` (Imperative Shell)
- `provider.ts` -- `createMcpToolProvider` ToolProvider adapter, `namespaceTool` (Functional Core)
- `schema-mapper.ts` -- `mapInputSchemaToParameters`: JSON Schema to ToolParameter conversion (Functional Core)
- `skill-adapter.ts` -- `mcpPromptToSkill`, `mcpPromptsToSkills`: prompt-to-skill conversion (Functional Core)
- `startup.ts` -- `createMcpInstructionsProvider`, `formatMcpStartupSummary`: composition root helpers (Functional Core)
- `index.ts` -- Barrel exports
