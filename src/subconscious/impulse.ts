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

export function buildImpulseCron(intervalMinutes: number): string {
  return `*/${intervalMinutes} * * * *`;
}

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

export function buildMorningAgendaEvent(context: Readonly<ImpulseContext>): ExternalEvent {
  const lines: Array<string> = [];

  lines.push('[Morning Agenda]');
  lines.push('Good morning. Here\'s what you\'ve been working on and what\'s ahead.');
  lines.push('');
  lines.push('[Active Interests]');
  lines.push(formatInterests(context.interests));
  lines.push('');
  lines.push('[Recent Explorations]');
  lines.push(formatExplorations(context.recentExplorations));
  lines.push('');
  lines.push('[Recent Activity]');
  lines.push(formatTraceSummary(context.recentTraces));
  lines.push('');
  lines.push('Review your interests and explorations. Decide:');
  lines.push('1. Which interests to continue pursuing today');
  lines.push('2. Whether any interests should be parked or abandoned');
  lines.push('3. What new questions have emerged');
  lines.push('');
  lines.push('Use manage_interest and manage_curiosity to plan your day.');

  const prompt = lines.join('\n');

  return {
    source: 'subconscious:morning-agenda',
    content: prompt,
    metadata: {
      taskType: 'morning-agenda',
      impulseType: 'transition',
    },
    timestamp: context.timestamp,
  };
}

export function buildWrapUpEvent(context: Readonly<ImpulseContext>): ExternalEvent {
  const lines: Array<string> = [];

  lines.push('[Wrap Up]');
  lines.push('End of day. Reflect on what happened today and prepare for tomorrow.');
  lines.push('');
  lines.push('[Active Interests]');
  lines.push(formatInterests(context.interests));
  lines.push('');
  lines.push('[Recent Explorations]');
  lines.push(formatExplorations(context.recentExplorations));
  lines.push('');
  lines.push('[Recent Activity]');
  lines.push(formatTraceSummary(context.recentTraces));
  lines.push('');
  lines.push('Reflect on today\'s work:');
  lines.push('1. What did you learn?');
  lines.push('2. What curiosity threads should you pick up tomorrow?');
  lines.push('3. Are there any interests that have run their course?');
  lines.push('4. Write any insights to memory for future reference.');
  lines.push('');
  lines.push('Use manage_interest and manage_curiosity to update your state before sleep.');

  const prompt = lines.join('\n');

  return {
    source: 'subconscious:wrap-up',
    content: prompt,
    metadata: {
      taskType: 'wrap-up',
      impulseType: 'transition',
    },
    timestamp: context.timestamp,
  };
}
