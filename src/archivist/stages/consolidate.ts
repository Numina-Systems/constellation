// pattern: Imperative Shell

import type { ModelProvider } from '@/model/types.js';
import type { DedupGroup, ConsolidateAction, ConsolidateResult } from '../types.js';

type ConsolidateDeps = {
  readonly model: ModelProvider | null;
  readonly modelName: string;
  readonly tokenBudget: number;
};

export async function consolidate(
  groups: ReadonlyArray<DedupGroup>,
  deps: ConsolidateDeps,
): Promise<ConsolidateResult> {
  if (!deps.model || groups.length === 0) {
    return { actions: [], tokensUsed: 0, skipped: !deps.model };
  }

  const actions: Array<ConsolidateAction> = [];
  let tokensUsed = 0;

  for (const group of groups) {
    const allContents = [group.canonical, ...group.duplicates]
      .map(b => `[${b.label}]\n${b.content}`)
      .join('\n\n---\n\n');

    const estimatedInputTokens = Math.ceil(allContents.length / 4);
    if (tokensUsed + estimatedInputTokens > deps.tokenBudget) break;

    const response = await deps.model.complete({
      system:
        'You are a knowledge consolidation agent. Merge the following duplicate memory blocks into a single coherent block. Preserve all unique information. Be concise.',
      messages: [{ role: 'user', content: allContents }],
      model: deps.modelName,
      max_tokens: 1024,
    });

    // Extract text from response content blocks
    const mergedContent = response.content
      .filter(b => b.type === 'text')
      .map(b => ('text' in b ? b.text : ''))
      .join('');

    tokensUsed += estimatedInputTokens + Math.ceil(mergedContent.length / 4);
    actions.push({ group, mergedContent });
  }

  return { actions, tokensUsed, skipped: false };
}
