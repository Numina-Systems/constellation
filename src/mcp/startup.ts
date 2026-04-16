// pattern: Functional Core

/**
 * Composition root helpers for MCP client integration.
 * Pure functions for building context providers and formatting startup summaries.
 */

import type { ContextProvider } from '@/agent/types.ts';

/**
 * Create a context provider function for MCP server instructions.
 * Formats instructions as `[MCP: ${serverName}]\n${instructions}`.
 *
 * AC7.1: Server instructions from getInstructions() are appended to system prompt.
 * AC7.2: Server with no instructions contributes nothing (provider only created for non-null instructions).
 */
export function createMcpInstructionsProvider(
  serverName: string,
  instructions: string,
): ContextProvider {
  return () => `[MCP: ${serverName}]\n${instructions}`;
}

/**
 * Format a startup summary string for MCP connection results.
 * Summarizes successful connections and failures for logging.
 *
 * AC6.1: Success path - all servers connected.
 * AC6.3: Failure path - some servers failed, others succeeded.
 * AC6.4: Failure path - all servers failed, startup continues.
 */
export function formatMcpStartupSummary(
  connected: ReadonlyArray<string>,
  failed: ReadonlyArray<{readonly name: string; readonly error: string}>,
): string {
  const parts: Array<string> = [];

  // Connected servers
  parts.push(`${connected.length} server(s) connected`);

  // Failed servers with details
  if (failed.length > 0) {
    const failureDetails = failed.map(f => `${f.name} (${f.error})`).join(', ');
    parts.push(`${failed.length} failed: ${failureDetails}`);
  }

  return parts.join(', ');
}
