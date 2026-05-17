// pattern: Imperative Shell

import type { ModelProvider } from '@/model/types.js';
import type { PipelineResult, ReflectResult } from '../types.js';

type ReflectDeps = {
  readonly model: ModelProvider | null;
  readonly tokenBudget: number;
  readonly tokensUsedSoFar: number;
};

export async function reflect(
  stats: PipelineResult,
  deps: ReflectDeps,
): Promise<ReflectResult> {
  if (!deps.model) {
    return { reflection: '', tokensUsed: 0, skipped: true };
  }
  if (deps.tokensUsedSoFar >= deps.tokenBudget) {
    return { reflection: '', tokensUsed: 0, skipped: true };
  }

  const prompt = `Memory maintenance pipeline completed (${stats.mode} mode).
Scanned: ${stats.scanned} blocks
Deduplicated: ${stats.deduped} groups merged
Consolidated: ${stats.consolidated} blocks
Cross-referenced: ${stats.crossreffed} blocks
Pruned: ${stats.pruned} empty blocks

Write a brief (2-3 sentence) observation about the health and organization of this memory system. Note any patterns or concerns.`;

  const response = await deps.model.complete({
    system: 'You are a knowledge archivist reflecting on memory health. Be concise and observational.',
    messages: [{ role: 'user', content: prompt }],
    model: '',
    max_tokens: 256,
  });

  // Extract text from response content blocks
  const reflectionText = response.content
    .filter(b => b.type === 'text')
    .map(b => ('text' in b ? b.text : ''))
    .join('');

  return {
    reflection: reflectionText,
    tokensUsed: Math.ceil(prompt.length / 4) + Math.ceil(reflectionText.length / 4),
    skipped: false,
  };
}
