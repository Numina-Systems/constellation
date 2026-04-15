// pattern: Functional Core

import type { ExternalEvent } from '@/agent/types';
import type { Interest } from './types';

export type IntrospectionContext = {
  readonly messages: ReadonlyArray<{
    readonly role: 'user' | 'assistant' | 'system';
    readonly content: string;
    readonly created_at: Date;
  }>;
  readonly interests: ReadonlyArray<Interest>;
  readonly currentDigest: string | null;
  readonly timestamp: Date;
};

export function buildIntrospectionCron(
  impulseIntervalMinutes: number,
  offsetMinutes: number,
): string {
  const offset = offsetMinutes % impulseIntervalMinutes;
  const minutes: Array<number> = [];
  for (let m = offset; m < 60; m += impulseIntervalMinutes) {
    minutes.push(m);
  }
  return `${minutes.join(',')} * * * *`;
}

export function buildIntrospectionEvent(
  context: Readonly<IntrospectionContext>,
): ExternalEvent {
  const lines: Array<string> = [];

  // Section 1: Review — recent conversation messages
  lines.push('[Review]');
  lines.push('Review your recent observations and conversation. What stands out?');
  lines.push('');
  lines.push(formatMessages(context.messages));

  // Section 2: Current State — active interests and last digest
  lines.push('');
  lines.push('[Current State]');
  lines.push(formatInterests(context.interests));
  lines.push('');
  if (context.currentDigest) {
    lines.push('[Last Digest]');
    lines.push(context.currentDigest);
  } else {
    lines.push('[Last Digest]');
    lines.push('No previous digest. This is your first introspection.');
  }

  // Section 3: Act — instructions for formalization and digest update
  lines.push('');
  lines.push('[Act]');
  lines.push('Based on your review:');
  lines.push(
    '1. Formalize any observations worth tracking as interests or curiosity threads (use manage_interest, manage_curiosity)',
  );
  lines.push(
    '2. Update your digest with remaining unformalised observations (use memory_write with label "introspection-digest")',
  );
  lines.push(
    '3. The digest should capture half-formed thoughts that haven\'t risen to the level of formal interests yet',
  );

  const prompt = lines.join('\n');

  return {
    source: 'subconscious:introspection',
    content: prompt,
    metadata: {
      taskType: 'introspection',
      messageCount: context.messages.length,
      interestCount: context.interests.length,
      hasExistingDigest: context.currentDigest !== null,
    },
    timestamp: context.timestamp,
  };
}

function formatMessages(
  messages: ReadonlyArray<{
    readonly role: string;
    readonly content: string;
    readonly created_at: Date;
  }>,
): string {
  if (messages.length === 0) {
    return 'No recent conversation to review.';
  }

  return messages
    .map((msg) => {
      const time = msg.created_at.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      return `[${time}] (${msg.role}) ${msg.content.length > 500 ? msg.content.slice(0, 500) + '...' : msg.content}`;
    })
    .join('\n');
}

function formatInterests(interests: ReadonlyArray<Interest>): string {
  if (interests.length === 0) {
    return 'No active interests.';
  }

  return interests
    .map(
      (interest) =>
        `- ${interest.name} (score: ${interest.engagementScore.toFixed(2)}): ${interest.description}`,
    )
    .join('\n');
}
