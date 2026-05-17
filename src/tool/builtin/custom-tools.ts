// pattern: Imperative Shell

import type { Tool, ToolParameter } from '../types.js';
import type { CustomToolManager } from '@/custom-tool/index.js';

export function createCustomToolTools(manager: CustomToolManager): ReadonlyArray<Tool> {
  const createTool: Tool = {
    definition: {
      name: 'create_tool',
      description: 'Create a new custom tool. The tool becomes immediately callable as a native tool on the next turn. The code receives parameters via a PARAMS constant (e.g., PARAMS.query). The code can call output() to produce results. Secrets are available as TypeScript constants (e.g., MY_API_KEY).',
      parameters: [
        { name: 'name', type: 'string', description: 'Tool name (snake_case, must not conflict with built-in tools)', required: true },
        { name: 'description', type: 'string', description: 'What the tool does (shown to the model)', required: true },
        { name: 'parameters', type: 'array', description: 'Array of parameter definitions: [{name, type, description, required}]', required: true },
        { name: 'code', type: 'string', description: 'TypeScript code to execute. Access params via PARAMS constant. Call output() to produce results.', required: true },
      ],
    },
    handler: async (params) => {
      const name = params['name'] as string;
      const description = params['description'] as string;
      const rawParams = params['parameters'] as Array<Record<string, unknown>>;
      const code = params['code'] as string;

      const toolParams: Array<ToolParameter> = rawParams.map(p => ({
        name: String(p['name']),
        type: String(p['type']) as ToolParameter['type'],
        description: String(p['description']),
        required: Boolean(p['required']),
      }));

      try {
        const def = await manager.create({ name, description, parameters: toolParams, code });
        return { success: true, output: `Custom tool "${def.name}" created successfully. It is now callable.` };
      } catch (error) {
        return { success: false, output: '', error: error instanceof Error ? error.message : String(error) };
      }
    },
  };

  const listTools: Tool = {
    definition: {
      name: 'list_tools',
      description: 'List all custom tools created by this agent.',
      parameters: [],
    },
    handler: async () => {
      const tools = await manager.list();
      if (tools.length === 0) {
        return { success: true, output: 'No custom tools defined.' };
      }
      const lines = tools.map(t =>
        `- ${t.name}: ${t.description} (${t.parameters.length} params, updated ${t.updated_at.toISOString()})`,
      );
      return { success: true, output: `Custom tools:\n${lines.join('\n')}` };
    },
  };

  const updateTool: Tool = {
    definition: {
      name: 'update_tool',
      description: 'Update an existing custom tool. Only provide fields you want to change.',
      parameters: [
        { name: 'name', type: 'string', description: 'Name of the tool to update', required: true },
        { name: 'description', type: 'string', description: 'New description', required: false },
        { name: 'parameters', type: 'array', description: 'New parameter definitions', required: false },
        { name: 'code', type: 'string', description: 'New TypeScript code', required: false },
      ],
    },
    handler: async (params) => {
      const name = params['name'] as string;
      const patch: Record<string, unknown> = {};
      if ('description' in params) patch['description'] = params['description'];
      if ('code' in params) patch['code'] = params['code'];
      if ('parameters' in params) {
        const rawParams = params['parameters'] as Array<Record<string, unknown>>;
        patch['parameters'] = rawParams.map(p => ({
          name: String(p['name']),
          type: String(p['type']),
          description: String(p['description']),
          required: Boolean(p['required']),
        }));
      }

      try {
        const updated = await manager.update(name, patch as Parameters<CustomToolManager['update']>[1]);
        return { success: true, output: `Custom tool "${updated.name}" updated successfully.` };
      } catch (error) {
        return { success: false, output: '', error: error instanceof Error ? error.message : String(error) };
      }
    },
  };

  const deleteTool: Tool = {
    definition: {
      name: 'delete_tool',
      description: 'Delete a custom tool. It will no longer be callable.',
      parameters: [
        { name: 'name', type: 'string', description: 'Name of the tool to delete', required: true },
      ],
    },
    handler: async (params) => {
      const name = params['name'] as string;
      try {
        await manager.delete(name);
        return { success: true, output: `Custom tool "${name}" deleted.` };
      } catch (error) {
        return { success: false, output: '', error: error instanceof Error ? error.message : String(error) };
      }
    },
  };

  return [createTool, listTools, updateTool, deleteTool];
}
