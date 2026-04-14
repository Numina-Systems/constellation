// pattern: Imperative Shell (tool handlers have side effects; validation is pure but co-located)

import type { Tool, ToolResult } from '../types.ts';
import type { InterestRegistry, InterestStatus, InterestSource, CuriosityStatus } from '../../subconscious/types.ts';

type SubconsciousToolDeps = {
  readonly registry: InterestRegistry;
  readonly owner: string;
};

export function createSubconsciousTools(deps: SubconsciousToolDeps): Array<Tool> {
  const manage_interest: Tool = {
    definition: {
      name: 'manage_interest',
      description: 'Create, update, or transition interests in the registry.',
      parameters: [
        {
          name: 'action',
          type: 'string',
          description: 'Action to perform: create, update, or transition',
          required: true,
          enum_values: ['create', 'update', 'transition'],
        },
        {
          name: 'id',
          type: 'string',
          description: 'Interest ID (required for update/transition)',
          required: false,
        },
        {
          name: 'name',
          type: 'string',
          description: 'Interest name (required for create, optional for update)',
          required: false,
        },
        {
          name: 'description',
          type: 'string',
          description: 'Interest description (optional)',
          required: false,
        },
        {
          name: 'source',
          type: 'string',
          description: 'Interest source: emergent, seeded, or external (for create)',
          required: false,
          enum_values: ['emergent', 'seeded', 'external'],
        },
        {
          name: 'status',
          type: 'string',
          description: 'Interest status: active, dormant, or abandoned (for transition)',
          required: false,
          enum_values: ['active', 'dormant', 'abandoned'],
        },
        {
          name: 'engagement_score',
          type: 'number',
          description: 'Engagement score (optional for update)',
          required: false,
        },
      ],
    },
    handler: async (params): Promise<ToolResult> => {
      try {
        const action = params['action'] as string;

        if (action === 'create') {
          const name = params['name'] as string | undefined;
          const description = (params['description'] as string | undefined) || '';
          const source = (params['source'] as InterestSource | undefined) || 'emergent';

          if (!name) {
            return {
              success: false,
              output: '',
              error: 'create requires name parameter',
            };
          }

          const interest = await deps.registry.createInterest({
            owner: deps.owner,
            name,
            description,
            source,
            engagementScore: 1.0,
            status: 'active',
          });

          return {
            success: true,
            output: JSON.stringify(interest, null, 2),
          };
        }

        if (action === 'update') {
          const id = params['id'] as string | undefined;
          if (!id) {
            return {
              success: false,
              output: '',
              error: 'update requires id parameter',
            };
          }

          const updates: Record<string, unknown> = {};
          if (params['name'] !== undefined) {
            updates['name'] = params['name'];
          }
          if (params['description'] !== undefined) {
            updates['description'] = params['description'];
          }
          if (params['engagement_score'] !== undefined) {
            updates['engagementScore'] = params['engagement_score'];
          }

          const interest = await deps.registry.updateInterest(id, updates as Parameters<typeof deps.registry.updateInterest>[1]);
          if (!interest) {
            return {
              success: false,
              output: '',
              error: `interest not found: ${id}`,
            };
          }

          return {
            success: true,
            output: JSON.stringify(interest, null, 2),
          };
        }

        if (action === 'transition') {
          const id = params['id'] as string | undefined;
          const status = params['status'] as InterestStatus | undefined;

          if (!id) {
            return {
              success: false,
              output: '',
              error: 'transition requires id parameter',
            };
          }

          if (!status) {
            return {
              success: false,
              output: '',
              error: 'transition requires status parameter',
            };
          }

          const interest = await deps.registry.updateInterest(id, { status });
          if (!interest) {
            return {
              success: false,
              output: '',
              error: `interest not found: ${id}`,
            };
          }

          return {
            success: true,
            output: JSON.stringify(interest, null, 2),
          };
        }

        return {
          success: false,
          output: '',
          error: `unknown action: ${action}`,
        };
      } catch (error) {
        return {
          success: false,
          output: '',
          error: `manage_interest failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };

  const manage_curiosity: Tool = {
    definition: {
      name: 'manage_curiosity',
      description: 'Create, explore, resolve, or park curiosity threads.',
      parameters: [
        {
          name: 'action',
          type: 'string',
          description: 'Action to perform: create, explore, resolve, or park',
          required: true,
          enum_values: ['create', 'explore', 'resolve', 'park'],
        },
        {
          name: 'id',
          type: 'string',
          description: 'Curiosity thread ID (required for explore/resolve/park)',
          required: false,
        },
        {
          name: 'interest_id',
          type: 'string',
          description: 'Interest ID (required for create)',
          required: false,
        },
        {
          name: 'question',
          type: 'string',
          description: 'Curiosity question (required for create)',
          required: false,
        },
        {
          name: 'resolution',
          type: 'string',
          description: 'Resolution text (optional for resolve)',
          required: false,
        },
      ],
    },
    handler: async (params): Promise<ToolResult> => {
      try {
        const action = params['action'] as string;

        if (action === 'create') {
          const interestId = params['interest_id'] as string | undefined;
          const question = params['question'] as string | undefined;

          if (!interestId) {
            return {
              success: false,
              output: '',
              error: 'create requires interest_id parameter',
            };
          }

          if (!question) {
            return {
              success: false,
              output: '',
              error: 'create requires question parameter',
            };
          }

          // Check for duplicate
          const duplicate = await deps.registry.findDuplicateCuriosityThread(interestId, question);
          if (duplicate) {
            return {
              success: true,
              output: JSON.stringify(
                {
                  ...duplicate,
                  resumed: true,
                  message: 'existing curiosity thread resumed',
                },
                null,
                2,
              ),
            };
          }

          // Create new thread
          const thread = await deps.registry.createCuriosityThread({
            interestId,
            owner: deps.owner,
            question,
            status: 'open',
            resolution: null,
          });

          // Bump engagement
          await deps.registry.bumpEngagement(interestId, 0.5);

          return {
            success: true,
            output: JSON.stringify(thread, null, 2),
          };
        }

        if (action === 'explore') {
          const id = params['id'] as string | undefined;

          if (!id) {
            return {
              success: false,
              output: '',
              error: 'explore requires id parameter',
            };
          }

          const thread = await deps.registry.getCuriosityThread(id);
          if (!thread) {
            return {
              success: false,
              output: '',
              error: `curiosity thread not found: ${id}`,
            };
          }

          const updated = await deps.registry.updateCuriosityThread(id, { status: 'exploring' });
          if (!updated) {
            return {
              success: false,
              output: '',
              error: `failed to update curiosity thread: ${id}`,
            };
          }

          // Bump engagement
          await deps.registry.bumpEngagement(thread.interestId, 0.3);

          return {
            success: true,
            output: JSON.stringify(updated, null, 2),
          };
        }

        if (action === 'resolve') {
          const id = params['id'] as string | undefined;
          const resolution = (params['resolution'] as string | undefined) || '';

          if (!id) {
            return {
              success: false,
              output: '',
              error: 'resolve requires id parameter',
            };
          }

          const thread = await deps.registry.getCuriosityThread(id);
          if (!thread) {
            return {
              success: false,
              output: '',
              error: `curiosity thread not found: ${id}`,
            };
          }

          const updated = await deps.registry.updateCuriosityThread(id, { status: 'resolved', resolution });
          if (!updated) {
            return {
              success: false,
              output: '',
              error: `failed to update curiosity thread: ${id}`,
            };
          }

          // Bump engagement
          await deps.registry.bumpEngagement(thread.interestId, 1.0);

          return {
            success: true,
            output: JSON.stringify(updated, null, 2),
          };
        }

        if (action === 'park') {
          const id = params['id'] as string | undefined;

          if (!id) {
            return {
              success: false,
              output: '',
              error: 'park requires id parameter',
            };
          }

          const updated = await deps.registry.updateCuriosityThread(id, { status: 'parked' });
          if (!updated) {
            return {
              success: false,
              output: '',
              error: `curiosity thread not found or failed to update: ${id}`,
            };
          }

          return {
            success: true,
            output: JSON.stringify(updated, null, 2),
          };
        }

        return {
          success: false,
          output: '',
          error: `unknown action: ${action}`,
        };
      } catch (error) {
        return {
          success: false,
          output: '',
          error: `manage_curiosity failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };

  const list_interests: Tool = {
    definition: {
      name: 'list_interests',
      description: 'List interests with optional filters by status, source, or minimum engagement score.',
      parameters: [
        {
          name: 'status',
          type: 'string',
          description: 'Filter by status: active, dormant, or abandoned',
          required: false,
          enum_values: ['active', 'dormant', 'abandoned'],
        },
        {
          name: 'source',
          type: 'string',
          description: 'Filter by source: emergent, seeded, or external',
          required: false,
          enum_values: ['emergent', 'seeded', 'external'],
        },
        {
          name: 'min_score',
          type: 'number',
          description: 'Filter by minimum engagement score',
          required: false,
        },
      ],
    },
    handler: async (params): Promise<ToolResult> => {
      try {
        const status = params['status'] as InterestStatus | undefined;
        const source = params['source'] as InterestSource | undefined;
        const minScore = params['min_score'] as number | undefined;

        const interests = await deps.registry.listInterests(deps.owner, {
          status,
          source,
          minScore,
        });

        return {
          success: true,
          output: JSON.stringify(
            {
              count: interests.length,
              interests,
            },
            null,
            2,
          ),
        };
      } catch (error) {
        return {
          success: false,
          output: '',
          error: `list_interests failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };

  const list_curiosities: Tool = {
    definition: {
      name: 'list_curiosities',
      description: 'List curiosity threads for an interest with optional status filter.',
      parameters: [
        {
          name: 'interest_id',
          type: 'string',
          description: 'Interest ID (required)',
          required: true,
        },
        {
          name: 'status',
          type: 'string',
          description: 'Filter by status: open, exploring, resolved, or parked',
          required: false,
          enum_values: ['open', 'exploring', 'resolved', 'parked'],
        },
      ],
    },
    handler: async (params): Promise<ToolResult> => {
      try {
        const interestId = params['interest_id'] as string;
        const status = params['status'] as CuriosityStatus | undefined;

        const threads = await deps.registry.listCuriosityThreads(interestId, { status });

        return {
          success: true,
          output: JSON.stringify(
            {
              count: threads.length,
              threads,
            },
            null,
            2,
          ),
        };
      } catch (error) {
        return {
          success: false,
          output: '',
          error: `list_curiosities failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };

  return [manage_interest, manage_curiosity, list_interests, list_curiosities];
}
