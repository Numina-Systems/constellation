// pattern: Imperative Shell

/**
 * Prediction tools for creating, annotating, and listing agent predictions.
 * These tools wrap the PredictionStore and implement the predict, annotate_prediction,
 * and list_predictions tools for agent use.
 */

import type { PredictionStore } from './types.ts';
import type { Tool } from '../tool/types.ts';

type PredictionToolsDeps = {
  readonly store: PredictionStore;
  readonly owner: string;
  readonly conversationId: string;
};

export function createPredictionTools(deps: PredictionToolsDeps): Array<Tool> {
  const predict: Tool = {
    definition: {
      name: 'predict',
      description:
        'Create a prediction about a future outcome. Predictions capture your expected result and are tracked for later evaluation.',
      parameters: [
        {
          name: 'text',
          type: 'string',
          description: 'The prediction text describing what you expect to happen',
          required: true,
        },
        {
          name: 'domain',
          type: 'string',
          description: 'Optional domain or category for the prediction',
          required: false,
        },
        {
          name: 'confidence',
          type: 'number',
          description: 'Optional confidence level between 0 and 1',
          required: false,
        },
      ],
    },
    handler: async (params) => {
      try {
        const text = params['text'] as string;
        const domain = params['domain'] as string | undefined;
        const confidence = params['confidence'] as number | undefined;

        const prediction = await deps.store.createPrediction({
          owner: deps.owner,
          conversationId: deps.conversationId,
          predictionText: text,
          domain: domain ?? null,
          confidence: confidence ?? null,
          contextSnapshot: {},
          status: 'pending',
        });

        return {
          success: true,
          output: JSON.stringify(
            {
              id: prediction.id,
              text: prediction.predictionText,
              domain: prediction.domain,
              confidence: prediction.confidence,
              status: prediction.status,
              created_at: prediction.createdAt.toISOString(),
            },
            null,
            2,
          ),
        };
      } catch (error) {
        return {
          success: false,
          output: '',
          error: `predict failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };

  const annotate_prediction: Tool = {
    definition: {
      name: 'annotate_prediction',
      description:
        'Evaluate a past prediction with its outcome and accuracy. Creates an evaluation record.',
      parameters: [
        {
          name: 'prediction_id',
          type: 'string',
          description: 'The ID of the prediction to evaluate',
          required: true,
        },
        {
          name: 'outcome',
          type: 'string',
          description: 'Description of what actually happened',
          required: true,
        },
        {
          name: 'accurate',
          type: 'boolean',
          description: 'Whether the prediction was accurate',
          required: true,
        },
        {
          name: 'evidence',
          type: 'string',
          description: 'Optional evidence or explanation for the evaluation',
          required: false,
        },
      ],
    },
    handler: async (params) => {
      try {
        const predictionId = params['prediction_id'] as string;
        const outcome = params['outcome'] as string;
        const accurate = params['accurate'] as boolean;
        const evidence = params['evidence'] as string | undefined;

        const evaluation = await deps.store.createEvaluation({
          predictionId,
          owner: deps.owner,
          outcome,
          accurate,
          evidence: evidence ? { text: evidence } : {},
        });

        await deps.store.markEvaluated(predictionId);

        return {
          success: true,
          output: JSON.stringify(
            {
              id: evaluation.id,
              prediction_id: evaluation.predictionId,
              outcome: evaluation.outcome,
              accurate: evaluation.accurate,
              created_at: evaluation.createdAt.toISOString(),
            },
            null,
            2,
          ),
        };
      } catch (error) {
        return {
          success: false,
          output: '',
          error: `annotate_prediction failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };

  const list_predictions: Tool = {
    definition: {
      name: 'list_predictions',
      description: 'List predictions, optionally filtered by status.',
      parameters: [
        {
          name: 'status',
          type: 'string',
          description: 'Filter by prediction status',
          required: false,
          enum_values: ['pending', 'evaluated', 'expired'],
        },
        {
          name: 'limit',
          type: 'number',
          description: 'Maximum number of predictions to return',
          required: false,
        },
      ],
    },
    handler: async (params) => {
      try {
        const status = params['status'] as string | undefined;
        const limit = params['limit'] as number | undefined;

        const predictions = await deps.store.listPredictions(
          deps.owner,
          status as 'pending' | 'evaluated' | 'expired' | undefined,
          limit,
        );

        const formatted = predictions.map((p) => ({
          id: p.id,
          text: p.predictionText,
          domain: p.domain,
          confidence: p.confidence,
          status: p.status,
          created_at: p.createdAt.toISOString(),
          evaluated_at: p.evaluatedAt?.toISOString() ?? null,
        }));

        return {
          success: true,
          output: JSON.stringify(formatted, null, 2),
        };
      } catch (error) {
        return {
          success: false,
          output: '',
          error: `list_predictions failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };

  return [predict, annotate_prediction, list_predictions];
}
