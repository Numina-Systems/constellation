// pattern: Functional Core

import { formatTraceSummary } from '@/scheduled-context';
import type { OperationTrace } from '@/reflexion/types';
import type { Interest } from './types';

export type ContinuationDecision = {
  readonly shouldContinue: boolean;
  readonly reason: string;
};

export type ContinuationJudgeContext = {
  readonly agentResponse: string;
  readonly traces: ReadonlyArray<OperationTrace>;
  readonly interests: ReadonlyArray<Interest>;
  readonly eventType: 'impulse' | 'introspection';
};

export type ContinuationJudge = {
  readonly evaluate: (context: Readonly<ContinuationJudgeContext>) => Promise<ContinuationDecision>;
};

export function buildContinuationPrompt(context: Readonly<ContinuationJudgeContext>): string {
  const lines: Array<string> = [];

  lines.push('[Continuation Decision]');
  lines.push('Based on the following context, decide whether to continue with this impulse or introspection.');
  lines.push('');

  // Agent response
  lines.push('[Agent Response]');
  lines.push(context.agentResponse || '(no response)');
  lines.push('');

  // Trace summaries
  lines.push(formatTraceSummary(context.traces));
  lines.push('');

  // Active interests
  lines.push('[Active Interests]');
  if (context.interests.length === 0) {
    lines.push('No active interests.');
  } else {
    for (const interest of context.interests) {
      lines.push(`- ${interest.name} (score: ${interest.engagementScore.toFixed(2)})`);
    }
  }
  lines.push('');

  // Event type
  lines.push('[Event Type]');
  lines.push(context.eventType);
  lines.push('');

  // Instructions
  lines.push('[Decision Instructions]');
  lines.push('Return a JSON response with the following structure:');
  lines.push('{"continue": true|false, "reason": "explanation"}');
  lines.push('');
  lines.push('Consider:');
  lines.push('- Is the agent making meaningful progress?');
  lines.push('- Are there active interests being meaningfully pursued?');
  lines.push('- Should the impulse be continued or concluded?');

  return lines.join('\n');
}

export function parseContinuationResponse(text: string): ContinuationDecision {
  if (!text || text.trim().length === 0) {
    return {
      shouldContinue: false,
      reason: 'Failed to parse continuation response',
    };
  }

  let jsonStr = text;

  // Try to extract JSON from markdown code blocks
  const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonMatch && jsonMatch[1]) {
    jsonStr = jsonMatch[1];
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed: any = JSON.parse(jsonStr);

    // Validate required fields
    if (typeof parsed.continue !== 'boolean' || typeof parsed.reason !== 'string') {
      return {
        shouldContinue: false,
        reason: 'Failed to parse continuation response',
      };
    }

    return {
      shouldContinue: parsed.continue,
      reason: parsed.reason,
    };
  } catch {
    return {
      shouldContinue: false,
      reason: 'Failed to parse continuation response',
    };
  }
}
