// pattern: Functional Core

/**
 * Default summarization prompt and interpolation utilities.
 * Provides a template for summarizing conversation history while preserving
 * critical context: decisions, constraints, causal chains, and tool outcomes.
 */

export const DEFAULT_SUMMARIZATION_PROMPT = `You are summarizing a conversation history to preserve essential context while compacting it.

Agent Persona:
{persona}

Previous Summary (if any):
{existing_summary}

Messages to Summarize:
{messages}

Your task is to create a concise narrative summary that:
1. Preserves decisions made and tool outcomes (both successes and failures)
2. Preserves user constraints and preferences explicitly stated
3. Preserves causal chains explaining why decisions were made, not just what was done
4. Condenses repetitive exchanges, verbose tool output, and conversational filler
5. Maintains chronological order of events
6. Formats as a flowing narrative, not bullet points

Output only the summary text, nothing else.`;

export type InterpolatePromptOptions = {
  readonly template: string;
  readonly persona: string;
  readonly existingSummary: string;
  readonly messages: string;
};

export function interpolatePrompt(options: InterpolatePromptOptions): string {
  let result = options.template;

  result = result.replaceAll('{persona}', options.persona);

  const summaryReplacement = options.existingSummary
    ? options.existingSummary
    : '(no prior summary)';
  result = result.replaceAll('{existing_summary}', summaryReplacement);

  result = result.replaceAll('{messages}', options.messages);

  return result;
}
