// pattern: Imperative Shell

/**
 * Introspection context provider for agent system prompt injection.
 * Surfaces unformalised observations from the introspection-digest memory block
 * as [Unformalised Observations] section in the system prompt.
 */

import type { ContextProvider } from '@/agent/types';
import type { MemoryStore } from '@/memory/store';

export function createIntrospectionContextProvider(
  memoryStore: MemoryStore,
  owner: string,
): ContextProvider {
  const CACHE_TTL = 120_000; // 2 minutes
  let cached: { result: string | undefined; timestamp: number } | null = null;
  let refreshing = false;

  function refresh(): void {
    if (refreshing) return;
    refreshing = true;
    memoryStore
      .getBlockByLabel(owner, 'introspection-digest')
      .then((block) => {
        if (!block || !block.content.trim()) {
          cached = { result: undefined, timestamp: Date.now() };
          return;
        }
        cached = {
          result: `[Unformalised Observations]\n${block.content}`,
          timestamp: Date.now(),
        };
      })
      .catch((error) => {
        console.warn('[introspection] context provider refresh failed:', error);
      })
      .finally(() => {
        refreshing = false;
      });
  }

  return () => {
    if (!cached || Date.now() - cached.timestamp >= CACHE_TTL) {
      refresh();
    }
    return cached?.result;
  };
}
