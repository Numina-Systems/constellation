// pattern: Functional Core
import {describe, expect, it} from 'bun:test';
import {createToolRegistry} from './registry.ts';
import type {ExecutionOptions} from '@/contracts/execution.ts';

describe('ToolRegistry dispatch execution options', () => {
  it('dispatch_forwards_signal_and_deadline_to_handlers', async () => {
    const registry = createToolRegistry();
    let received: ExecutionOptions | undefined;
    registry.register({
      definition: {name: 'cooperative', description: 'cooperative', parameters: []},
      handler: async (_params, options) => {
        received = options;
        return {success: true, output: 'ok'};
      },
    });

    const controller = new AbortController();
    const deadline = Date.now() + 1000;
    const result = await registry.dispatch('cooperative', {}, {signal: controller.signal, deadline});

    expect(result.success).toBe(true);
    expect(received?.signal).toBe(controller.signal);
    expect(received?.deadline).toBe(deadline);
  });

  it('handlers_without_options_parameters_remain_compatible', async () => {
    const registry = createToolRegistry();
    registry.register({
      definition: {name: 'legacy', description: 'legacy', parameters: []},
      handler: async () => ({success: true, output: 'legacy ok'}),
    });
    const controller = new AbortController();
    await expect(registry.dispatch('legacy', {}, {signal: controller.signal, deadline: Date.now()})).resolves.toMatchObject({success: true});
  });
});
