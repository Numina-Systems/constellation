// pattern: Functional Core (barrel export)

export type { McpClient, McpToolInfo, McpPromptInfo, McpPromptResult } from './types.ts';
export type { McpStdioServerConfig, McpHttpServerConfig, McpServerConfig, McpConfig } from './schema.ts';
export {
  McpStdioServerConfigSchema,
  McpHttpServerConfigSchema,
  McpServerConfigSchema,
  McpConfigSchema,
} from './schema.ts';
export { resolveEnvVars, resolveServerConfigEnv } from './env.ts';
export { createMcpClient, buildTransportOptions } from './client.ts';
export { mapInputSchemaToParameters } from './schema-mapper.ts';
