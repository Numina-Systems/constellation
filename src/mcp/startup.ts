// pattern: Imperative Shell

import type { ContextProvider } from '@/agent/types.ts';
import type { Tool, ToolDefinition, ToolRegistry } from '@/tool/types.ts';
import {McpDiscoveryError, type McpClient, type McpDiscoveryOptions, type McpToolRegistration} from './types.ts';

export const MCP_SERVER_STARTUP_TIMEOUT_MS = 15_000;

export type McpStartupFailure = Readonly<{readonly name: string; readonly error: string}>;
export type McpStartupResult = Readonly<{
  readonly connected: ReadonlyArray<McpClient>;
  readonly failed: ReadonlyArray<McpStartupFailure>;
  readonly summary: string;
}>;

export function createMcpInstructionsProvider(serverName: string, instructions: string): ContextProvider {
  return () => `[MCP: ${serverName}]\n${instructions}`;
}

export function formatMcpStartupSummary(connected: ReadonlyArray<string>, failed: ReadonlyArray<McpStartupFailure>): string {
  const parts: Array<string> = [`${connected.length} server(s) connected`];
  if (failed.length > 0) parts.push(`${failed.length} failed: ${failed.map((failure) => `${failure.name} (${failure.error.slice(0, 256)})`).join(', ')}`);
  return parts.join(', ');
}

/** Connects configured clients independently and always continues after one server fails. */
export type McpStartupOptions = Readonly<{
  readonly discovery?: McpDiscoveryOptions;
  readonly serverTimeoutMs?: number;
}>;

export async function connectMcpServers(
  clients: ReadonlyArray<McpClient>,
  startupOptions: McpStartupOptions = {},
): Promise<McpStartupResult> {
  const options = startupOptions.discovery;
  const startupTimeoutMs = startupOptions.serverTimeoutMs ?? MCP_SERVER_STARTUP_TIMEOUT_MS;
  const connected: Array<McpClient> = [];
  const failed: Array<McpStartupFailure> = [];
  for (const client of clients) {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        client.connect(options),
        new Promise<never>((_resolve, reject) => {
          timeoutId = setTimeout(() => reject(new McpDiscoveryError(
            'mcp_startup_timeout',
            `MCP ${client.serverName} startup timed out`,
            {server: client.serverName, timeoutMs: startupTimeoutMs},
            {suggestion: 'check server availability and startup configuration'},
          )), Math.max(1, startupTimeoutMs));
        }),
      ]);
      connected.push(client);
    } catch (error) {
      // Do not await disconnect: a hung connect may also leave transport cleanup pending.
      void Promise.resolve().then(() => client.disconnect()).catch(() => undefined);
      const failure = safeFailure(error);
      failed.push({name: client.serverName, error: failure});
      console.error('[mcp] startup server skipped', {
        server: client.serverName,
        code: error instanceof McpDiscoveryError ? error.code : 'mcp_discovery_transport_error',
        error: failure,
        success: false,
      });
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }
  }
  return {connected, failed, summary: formatMcpStartupSummary(connected.map((client) => client.serverName), failed)};
}

/** Publishes all MCP registrations as one validated registry transaction-like swap. */
export function publishMcpRegistrations(registry: ToolRegistry, registrations: ReadonlyArray<McpToolRegistration>): void {
  const names = new Set<string>();
  const existingNames = new Set(registry.getDefinitions().map((definition) => definition.name));
  for (const registration of registrations) {
    const name = registration.definition.name;
    if (names.has(name) || existingNames.has(name)) throw new McpDiscoveryError('mcp_registration_collision', `MCP registration collision before publication: ${name}`, {name}, {suggestion: 'use unique MCP tool names'});
    names.add(name);
  }
  const reserved: Array<string> = [];
  const installed: Array<string> = [];
  try {
    for (const name of names) {
      registry.reserve?.(name);
      reserved.push(name);
    }
    for (const registration of registrations) {
      const tool: Tool = {definition: registration.definition, handler: registration.handler};
      if (registry.replaceReserved) registry.replaceReserved(registration.definition.name, tool);
      else registry.register(tool);
      installed.push(registration.definition.name);
    }
  } catch (error) {
    const reason = `MCP registration publication failed: ${safeFailure(error)}`;
    const cleanupFailures: Array<unknown> = [];
    for (const name of installed) {
      try {
        registry.quarantine?.(name, reason);
      } catch (cleanupError) {
        cleanupFailures.push(cleanupError);
      }
    }
    for (const name of reserved) {
      try {
        registry.release?.(name);
      } catch (cleanupError) {
        cleanupFailures.push(cleanupError);
      }
    }
    if (cleanupFailures.length > 0) {
      throw new AggregateError([error, ...cleanupFailures], 'MCP registration publication rollback failed', {cause: error});
    }
    throw error;
  }
}

export function createMcpToolDefinitions(registrations: ReadonlyArray<McpToolRegistration>): Array<ToolDefinition> {
  return registrations.map((registration) => registration.definition);
}

function safeFailure(error: unknown): string { return error instanceof Error ? error.message.slice(0, 256) : 'server startup failed'; }
