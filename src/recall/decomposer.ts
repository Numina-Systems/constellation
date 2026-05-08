// pattern: Imperative Shell

/**
 * Message decomposition orchestrator.
 * Calls the model to decompose messages into semantic queries and named entities,
 * with graceful fallback on parsing or model failures.
 */

import type { ModelProvider, ModelRequest, ModelResponse } from '@/model/types.js';
import type { DecompositionResult } from './types.js';
import { parseDecompositionResponse } from './decompose.js';

const DECOMPOSE_SYSTEM_PROMPT = `You are a message decomposition specialist. Your task is to extract key semantic queries and named entities from user messages.

For semantic queries:
- Extract 1-4 short semantic queries (2-6 words each) that capture the main topics
- Each query should be a self-contained phrase capturing a distinct topic or question
- If the message is too short or unclear, extract fewer queries

For named entities:
- Extract proper nouns (project names, people, tools, organizations, locations)
- Include domain-specific terminology that appears to be a proper noun

Return valid JSON with this exact structure:
{
  "queries": ["query1", "query2"],
  "entities": ["entity1", "entity2"]
}

If there are no proper nouns, return an empty entities array.
Return only the JSON, no other text.`;

/**
 * Calls the model to decompose a message into semantic queries and named entities.
 * Returns parsed result. On model failure (thrown error), returns { queries: [], entities: [] }.
 * Empty queries AND entities is the failure signal that the orchestrator should fall back
 * to using the raw message as a query.
 */
export async function decomposeMessage(
  message: string,
  model: ModelProvider,
  modelName: string,
): Promise<DecompositionResult> {
  try {
    const request: ModelRequest = {
      messages: [
        {
          role: 'user',
          content: message,
        },
      ],
      system: DECOMPOSE_SYSTEM_PROMPT,
      model: modelName,
      max_tokens: 256,
      temperature: 0,
    };

    const response: ModelResponse = await model.complete(request);

    // Extract text content from response
    const textContent = response.content.find((block) => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      return {
        queries: [],
        entities: [],
      };
    }

    return parseDecompositionResponse(textContent.text);
  } catch {
    // Model failure — return empty result as failure signal
    return {
      queries: [],
      entities: [],
    };
  }
}
