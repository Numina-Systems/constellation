// pattern: Functional Core

import {
  MCP_DEFAULT_DISCOVERY_TIMEOUT_MS,
  MCP_DEFAULT_MAX_PAGES,
  McpDiscoveryError,
  type McpDiscoveryOptions,
} from './types.ts';

export type McpPage<T> = Readonly<{readonly items: ReadonlyArray<T>; readonly nextCursor?: string}>;
export type McpPageFetcher<T> = (cursor: string | undefined, timeoutMs: number, signal: AbortSignal | undefined) => Promise<McpPage<T>>;

/** Collects paginated results with one absolute budget and cursor/page guards. */
export async function collectMcpPages<T>(
  fetchPage: McpPageFetcher<T>,
  options: McpDiscoveryOptions = {},
): Promise<Array<T>> {
  const now = options.now ?? (() => Date.now());
  const deadline = options.deadline ?? now() + MCP_DEFAULT_DISCOVERY_TIMEOUT_MS;
  const maxPages = options.maxPages ?? MCP_DEFAULT_MAX_PAGES;
  if (!Number.isInteger(maxPages) || maxPages <= 0) throw new McpDiscoveryError('mcp_discovery_page_limit_exceeded', 'MCP discovery maxPages must be a positive integer', {maxPages});
  const values: Array<T> = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let pageNumber = 0; ; pageNumber += 1) {
    if (options.signal?.aborted) throw new McpDiscoveryError('mcp_discovery_aborted', 'MCP discovery was aborted');
    const remaining = deadline - now();
    if (remaining <= 0) throw new McpDiscoveryError('mcp_discovery_deadline_exceeded', 'MCP discovery deadline exceeded', {page: pageNumber});
    if (pageNumber >= maxPages) throw new McpDiscoveryError('mcp_discovery_page_limit_exceeded', 'MCP discovery page limit exceeded', {maxPages});
    if (cursor !== undefined) {
      if (cursors.has(cursor)) throw new McpDiscoveryError('mcp_discovery_repeated_cursor', 'MCP discovery returned a repeated cursor', {cursor: `${cursor.slice(0, 128)}…`, cursorLength: cursor.length});
      cursors.add(cursor);
    }
    let page: McpPage<T>;
    try {
      page = await fetchPage(cursor, Math.max(1, Math.ceil(remaining)), options.signal);
    } catch (error) {
      if (options.signal?.aborted) throw new McpDiscoveryError('mcp_discovery_aborted', 'MCP discovery was aborted', {}, {cause: error});
      throw new McpDiscoveryError('mcp_discovery_transport_error', 'MCP discovery request failed', {}, {cause: error});
    }
    values.push(...page.items);
    cursor = page.nextCursor;
    if (cursor === undefined) return values;
  }
}
