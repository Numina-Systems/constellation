// pattern: Functional Core (barrel export)

export type { McpToolInfo, McpPromptInfo, McpPromptResult } from './types.ts';
export type { McpStdioServerConfig, McpHttpServerConfig, McpServerConfig, McpConfig } from './schema.ts';
export {
  McpStdioServerConfigSchema,
  McpHttpServerConfigSchema,
  McpServerConfigSchema,
  McpConfigSchema,
} from './schema.ts';
export { resolveEnvVars, resolveServerConfigEnv } from './env.ts';
