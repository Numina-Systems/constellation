// pattern: Imperative Shell

import type { ContextProvider } from '@/agent/types.ts';
import type { Tool, ToolDefinition, ToolRegistry } from '@/tool/types.ts';
import type { McpClient, McpDiscoveryOptions, McpToolRegistration } from './types.ts';

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
export async function connectMcpServers(
  clients: ReadonlyArray<McpClient>,
  options?: McpDiscoveryOptions,
): Promise<McpStartupResult> {
  const connected: Array<McpClient> = [];
  const failed: Array<McpStartupFailure> = [];
  for (const client of clients) {
    try {
      await client.connect(options);
      connected.push(client);
    } catch (error) {
      await client.disconnect().catch(() => undefined);
      failed.push({name: client.serverName, error: safeFailure(error)});
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
    if (names.has(name) || existingNames.has(name)) throw new Error(`MCP registration collision before publication: ${name}`);
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
