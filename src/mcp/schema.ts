// pattern: Functional Core

import { z } from 'zod';

export const McpStdioServerConfigSchema = z.object({
  transport: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
});

export const McpHttpServerConfigSchema = z.object({
  transport: z.literal('http'),
  url: z.string().url(),
});

export const McpServerConfigSchema = z.discriminatedUnion('transport', [
  McpStdioServerConfigSchema,
  McpHttpServerConfigSchema,
]);

export const McpConfigSchema = z.object({
  enabled: z.boolean().default(false),
  servers: z.record(z.string(), McpServerConfigSchema).default({}),
});

export type McpStdioServerConfig = z.infer<typeof McpStdioServerConfigSchema>;
export type McpHttpServerConfig = z.infer<typeof McpHttpServerConfigSchema>;
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
export type McpConfig = z.infer<typeof McpConfigSchema>;
