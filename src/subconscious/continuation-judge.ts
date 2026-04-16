// pattern: Imperative Shell

import { buildContinuationPrompt, parseContinuationResponse } from './continuation';
import type { ContinuationJudge, ContinuationJudgeContext } from './continuation';
import type { ModelProvider } from '@/model/types';
import type { TextBlock } from '@/model/types';

export type ContinuationJudgeDeps = {
  readonly model: ModelProvider;
  readonly modelName: string;
};

export function createContinuationJudge(deps: Readonly<ContinuationJudgeDeps>): ContinuationJudge {
  async function evaluate(context: Readonly<ContinuationJudgeContext>) {
    try {
      const prompt = buildContinuationPrompt(context);

      const request = {
        messages: [{ role: 'user' as const, content: prompt }],
        model: deps.modelName,
        max_tokens: 256,
        temperature: 0,
      };

      const response = await deps.model.complete(request);

      const text = response.content
        .filter((b): b is TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');

      return parseContinuationResponse(text);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        shouldContinue: false,
        reason: `Judge evaluation failed: ${errorMessage}`,
      };
    }
  }

  return {
    evaluate,
  };
}
