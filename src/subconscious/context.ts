// pattern: Imperative Shell

/**
 * Subconscious context provider for agent system prompt injection.
 * Provides cached inner life status showing active interests, recent explorations,
 * and dormant interests count.
 */

import type { ContextProvider } from '../agent/types.ts';
import type { InterestRegistry, Interest, ExplorationLogEntry } from './types.ts';

export function createSubconsciousContextProvider(
  registry: InterestRegistry,
  owner: string,
): ContextProvider {
  const CACHE_TTL = 120_000; // 2 minutes — subconscious activity changes less frequently than activity state
  let cached: { result: string | undefined; timestamp: number } | null = null;
  let refreshing = false;

  function refresh(): void {
    if (refreshing) return;
    refreshing = true;
    Promise.all([
      registry.listInterests(owner, { status: 'active' }),
      registry.listExplorationLog(owner, 5),
      registry.listInterests(owner, { status: 'dormant' }),
    ])
      .then(([activeInterests, recentExplorations, dormantInterests]) => {
        // If no activity at all, return undefined
        if (activeInterests.length === 0 && recentExplorations.length === 0) {
          cached = { result: undefined, timestamp: Date.now() };
          return;
        }

        cached = {
          result: formatInnerLife(activeInterests, recentExplorations, dormantInterests),
          timestamp: Date.now(),
        };
      })
      .catch((error) => {
        console.warn('[subconscious] context provider refresh failed:', error);
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

function formatInnerLife(
  activeInterests: ReadonlyArray<Interest>,
  recentExplorations: ReadonlyArray<ExplorationLogEntry>,
  dormantInterests: ReadonlyArray<Interest>,
): string {
  let result = '[Inner Life]\n';

  // Active interests section
  if (activeInterests.length > 0) {
    result += 'Active interests:\n';
    for (const interest of activeInterests) {
      const score = interest.engagementScore.toFixed(1);
      result += `- ${interest.name} (engagement: ${score}): ${interest.description}\n`;
    }
    result += '\n';
  }

  // Recent explorations section
  if (recentExplorations.length > 0) {
    result += 'Recent explorations:\n';
    for (const entry of recentExplorations) {
      const time = entry.createdAt.toISOString();
      const truncatedOutcome = entry.outcome.length > 100 ? entry.outcome.slice(0, 100) + '…' : entry.outcome;
      result += `- [${time}] ${entry.action}: ${truncatedOutcome}\n`;
    }
    result += '\n';
  }

  // Dormant interests section
  if (dormantInterests.length > 0) {
    const dormantNames = dormantInterests.slice(0, 3).map((i) => i.name).join(', ');
    const dormantSuffix = dormantInterests.length > 3 ? `, ...` : '';
    result += `Dormant interests: ${dormantInterests.length} (${dormantNames}${dormantSuffix})\n`;
  }

  return result;
}
