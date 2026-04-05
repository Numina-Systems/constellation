// pattern: Imperative Shell

import type { SpaceMoltDataSource, SpaceMoltToolProvider } from './types.ts';

export type SpaceMoltLifecycleOptions = {
  readonly source: SpaceMoltDataSource;
  readonly toolProvider: SpaceMoltToolProvider;
};

export type SpaceMoltLifecycle = {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
};

export function createSpaceMoltLifecycle(
  options: Readonly<SpaceMoltLifecycleOptions>,
): SpaceMoltLifecycle {
  const { source, toolProvider } = options;
  let running = false;

  async function start(): Promise<void> {
    if (running) {
      return;
    }

    // Connect source
    await source.connect();

    // Discover tools
    await toolProvider.discover();

    running = true;
  }

  async function stop(): Promise<void> {
    if (!running) {
      return;
    }

    // Disconnect source
    await source.disconnect();

    // Close tool provider
    await toolProvider.close();

    running = false;
  }

  function isRunning(): boolean {
    return running;
  }

  return {
    start,
    stop,
    isRunning,
  };
}
