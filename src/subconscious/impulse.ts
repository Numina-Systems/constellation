// pattern: Functional Core

import { formatTraceSummary } from '@/scheduled-context';
import type { ExternalEvent } from '@/agent/types';
import type { Interest, ExplorationLogEntry } from './types';
import type { OperationTrace } from '@/reflexion/types';

export type ImpulseContext = {
  readonly interests: ReadonlyArray<Interest>;
  readonly recentExplorations: ReadonlyArray<ExplorationLogEntry>;
  readonly recentTraces: ReadonlyArray<OperationTrace>;
  readonly recentMemories: ReadonlyArray<string>;
  readonly timestamp: Date;
};

export function buildImpulseEvent(context: Readonly<ImpulseContext>): ExternalEvent {
  const lines: Array<string> = [];

  // Section 1: Reflect
  lines.push('[Reflect]');
  lines.push('Here\'s what\'s happened recently. What patterns or insights do you notice?');
  lines.push('');
  lines.push(formatTraceSummary(context.recentTraces));
  lines.push('');
  lines.push('[Recent Memories]');
  lines.push(formatMemories(context.recentMemories));
  lines.push('');
  lines.push('[Recent Explorations]');
  lines.push(formatExplorations(context.recentExplorations));

  // Section 2: Generate
  lines.push('');
  lines.push('[Generate]');
  lines.push('Given what you know and what you\'ve been exploring, what\'s interesting right now?');
  lines.push('');
  lines.push('[Active Interests]');
  lines.push(formatInterests(context.interests));

  // Section 3: Act
  lines.push('');
  lines.push('[Act]');
  lines.push('Pursue your chosen curiosity. You have access to all tools — web search, code execution, memory writes, scheduling.');
  lines.push('');
  lines.push('Use manage_interest and manage_curiosity to track what you\'re doing. Log your exploration.');

  const prompt = lines.join('\n');

  return {
    source: 'subconscious:impulse',
    content: prompt,
    metadata: {
      taskType: 'impulse',
      interestCount: context.interests.length,
      traceCount: context.recentTraces.length,
    },
    timestamp: context.timestamp,
  };
}

function formatInterests(interests: ReadonlyArray<Interest>): string {
  if (interests.length === 0) {
    return 'You have no interests yet. What are you curious about?';
  }

  return interests
    .map(
      (interest) =>
        `- ${interest.name} (score: ${interest.engagementScore.toFixed(2)}, source: ${interest.source}): ${interest.description}`,
    )
    .join('\n');
}

function formatExplorations(entries: ReadonlyArray<ExplorationLogEntry>): string {
  if (entries.length === 0) {
    return 'No recent explorations.';
  }

  return entries
    .map((entry) => {
      const time = entry.createdAt.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      return `- [${time}] ${entry.action} → ${entry.outcome}`;
    })
    .join('\n');
}

function formatMemories(memories: ReadonlyArray<string>): string {
  if (memories.length === 0) {
    return 'No recent memories.';
  }

  return memories.map((memory) => `- ${memory}`).join('\n');
}
