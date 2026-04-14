// pattern: Imperative Shell

import { buildImpulseEvent } from './impulse';
import type { ExternalEvent } from '@/agent/types';
import type { InterestRegistry } from './types';
import type { TraceStore } from '@/reflexion';
import type { MemoryManager } from '@/memory/manager';

type ImpulseAssemblerDeps = {
  readonly interestRegistry: InterestRegistry;
  readonly traceStore: TraceStore;
  readonly memory: MemoryManager;
  readonly owner: string;
};

export type ImpulseAssembler = {
  assembleImpulse(): Promise<ExternalEvent>;
  assembleMorningAgenda(): Promise<ExternalEvent>;
  assembleWrapUp(): Promise<ExternalEvent>;
};

export function createImpulseAssembler(deps: Readonly<ImpulseAssemblerDeps>): ImpulseAssembler {
  async function assembleImpulse(): Promise<ExternalEvent> {
    const [interests, explorations, traces, memories] = await Promise.all([
      deps.interestRegistry.listInterests(deps.owner, { status: 'active' }),
      deps.interestRegistry.listExplorationLog(deps.owner, 10),
      deps.traceStore.queryTraces({
        owner: deps.owner,
        lookbackSince: new Date(Date.now() - 2 * 3600_000),
        limit: 20,
      }),
      fetchRecentMemories(),
    ]);

    return buildImpulseEvent({
      interests,
      recentExplorations: explorations,
      recentTraces: traces,
      recentMemories: memories,
      timestamp: new Date(),
    });
  }

  async function fetchRecentMemories(): Promise<ReadonlyArray<string>> {
    const results = await deps.memory.read(
      'recent thoughts conversations discoveries interests',
      5,
      'working',
    );
    return results.map((result) => result.block.content);
  }

  function assembleMorningAgenda(): Promise<ExternalEvent> {
    return Promise.reject(
      new Error('Morning agenda not implemented yet — see Phase 6'),
    );
  }

  function assembleWrapUp(): Promise<ExternalEvent> {
    return Promise.reject(
      new Error('Wrap-up not implemented yet — see Phase 6'),
    );
  }

  return {
    assembleImpulse,
    assembleMorningAgenda,
    assembleWrapUp,
  };
}
