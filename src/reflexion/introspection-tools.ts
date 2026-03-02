// pattern: Imperative Shell

/**
 * Introspection tools for self-reflection and trace queries.
 * The self_introspect tool allows agents to examine their recent operation traces.
 */

import type { TraceStore } from './trace-recorder.ts';
import type { PredictionStore } from './types.ts';
import type { Tool } from '../tool/types.ts';

type IntrospectionToolsDeps = {
  readonly traceStore: TraceStore;
  readonly predictionStore: PredictionStore;
  readonly owner: string;
};

export function createIntrospectionTools(deps: IntrospectionToolsDeps): Array<Tool> {
  const self_introspect: Tool = {
    definition: {
      name: 'self_introspect',
      description:
        'Query your recent operation traces for introspection and self-reflection. Returns tool calls, successes, and failures.',
      parameters: [
        {
          name: 'lookback_hours',
          type: 'number',
          description: 'Optional lookback window in hours. If not provided, defaults to since last review.',
          required: false,
        },
        {
          name: 'tool_name',
          type: 'string',
          description: 'Optional tool name to filter by',
          required: false,
        },
        {
          name: 'success_only',
          type: 'boolean',
          description: 'If true, return only successful traces',
          required: false,
        },
        {
          name: 'limit',
          type: 'number',
          description: 'Maximum number of traces to return',
          required: false,
        },
      ],
    },
    handler: async (params) => {
      try {
        let lookbackSince: Date | undefined;

        const lookbackHours = params['lookback_hours'] as number | undefined;

        if (lookbackHours !== undefined) {
          lookbackSince = new Date(Date.now() - lookbackHours * 3600000);
        } else {
          const lastReview = await deps.predictionStore.getLastReviewTimestamp(deps.owner);
          if (lastReview !== null) {
            lookbackSince = lastReview;
          }
        }

        const toolName = params['tool_name'] as string | undefined;
        const successOnly = params['success_only'] as boolean | undefined;
        const limit = params['limit'] as number | undefined;

        const traces = await deps.traceStore.queryTraces({
          owner: deps.owner,
          lookbackSince,
          toolName,
          successOnly,
          limit,
        });

        const formatted = traces.map((t) => ({
          id: t.id,
          tool_name: t.toolName,
          success: t.success,
          duration_ms: t.durationMs,
          error: t.error,
          created_at: t.createdAt.toISOString(),
          output_summary: t.outputSummary,
        }));

        return {
          success: true,
          output: JSON.stringify(formatted, null, 2),
        };
      } catch (error) {
        return {
          success: false,
          output: '',
          error: `self_introspect failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };

  return [self_introspect];
}
