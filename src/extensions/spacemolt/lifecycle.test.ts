import { describe, it, expect, beforeEach } from 'bun:test';
import { createSpaceMoltLifecycle } from './lifecycle.ts';
import type { SpaceMoltLifecycleOptions } from './lifecycle.ts';
import type { SpaceMoltDataSource } from './types.ts';
import type { SpaceMoltToolProvider } from './types.ts';

// Mock implementations
function createMockSource(): SpaceMoltDataSource {
  let connected = false;

  return {
    name: 'spacemolt',
    async connect() {
      connected = true;
    },
    async disconnect() {
      connected = false;
    },
    onMessage() {
      // no-op
    },
    getGameState() {
      return 'DOCKED';
    },
  };
}

function createMockToolProvider(): SpaceMoltToolProvider {
  let discovered = false;

  return {
    name: 'spacemolt',
    async discover() {
      discovered = true;
      return [];
    },
    async execute() {
      return {
        success: false,
        output: '',
        error: 'Not implemented',
      };
    },
    async refreshTools() {
      // no-op
    },
    async close() {
      discovered = false;
    },
  };
}

describe('createSpaceMoltLifecycle', () => {
  let mockSource: SpaceMoltDataSource;
  let mockToolProvider: SpaceMoltToolProvider;
  let options: SpaceMoltLifecycleOptions;

  beforeEach(() => {
    mockSource = createMockSource();
    mockToolProvider = createMockToolProvider();
    options = {
      source: mockSource,
      toolProvider: mockToolProvider,
    };
  });

  it('AC5.1: start() calls source.connect() then toolProvider.discover()', async () => {
    let connectCalled = false;
    let discoverCalled = false;
    let connectCalledFirst = false;

    const trackingSource: SpaceMoltDataSource = {
      ...mockSource,
      async connect() {
        connectCalled = true;
        connectCalledFirst = !discoverCalled;
      },
    };

    const trackingProvider: SpaceMoltToolProvider = {
      ...mockToolProvider,
      async discover() {
        discoverCalled = true;
        return [];
      },
    };

    const lifecycle = createSpaceMoltLifecycle({
      source: trackingSource,
      toolProvider: trackingProvider,
    });

    await lifecycle.start();

    expect(connectCalled).toBe(true);
    expect(discoverCalled).toBe(true);
    expect(connectCalledFirst).toBe(true);
  });

  it('AC5.2: stop() calls source.disconnect() then toolProvider.close()', async () => {
    let disconnectCalled = false;
    let closeCalled = false;
    let disconnectCalledFirst = false;

    const trackingSource: SpaceMoltDataSource = {
      ...mockSource,
      async disconnect() {
        disconnectCalled = true;
        disconnectCalledFirst = !closeCalled;
      },
    };

    const trackingProvider: SpaceMoltToolProvider = {
      ...mockToolProvider,
      async close() {
        closeCalled = true;
      },
    };

    const lifecycle = createSpaceMoltLifecycle({
      source: trackingSource,
      toolProvider: trackingProvider,
    });

    await lifecycle.start();
    await lifecycle.stop();

    expect(disconnectCalled).toBe(true);
    expect(closeCalled).toBe(true);
    expect(disconnectCalledFirst).toBe(true);
  });

  it('isRunning() returns true after start()', async () => {
    const lifecycle = createSpaceMoltLifecycle(options);

    expect(lifecycle.isRunning()).toBe(false);

    await lifecycle.start();

    expect(lifecycle.isRunning()).toBe(true);
  });

  it('isRunning() returns false after stop()', async () => {
    const lifecycle = createSpaceMoltLifecycle(options);

    await lifecycle.start();
    expect(lifecycle.isRunning()).toBe(true);

    await lifecycle.stop();
    expect(lifecycle.isRunning()).toBe(false);
  });

  it('start() is idempotent - multiple calls do not reconnect', async () => {
    let connectCallCount = 0;

    const trackingSource: SpaceMoltDataSource = {
      ...mockSource,
      async connect() {
        connectCallCount++;
      },
    };

    const lifecycle = createSpaceMoltLifecycle({
      source: trackingSource,
      toolProvider: mockToolProvider,
    });

    await lifecycle.start();
    await lifecycle.start();
    await lifecycle.start();

    expect(connectCallCount).toBe(1);
  });

  it('stop() is idempotent - multiple calls do not fail', async () => {
    const lifecycle = createSpaceMoltLifecycle(options);

    await lifecycle.start();
    await lifecycle.stop();
    await lifecycle.stop();

    expect(lifecycle.isRunning()).toBe(false);
  });

  it('AC5.4: start() is only called on wake, stop() on sleep', async () => {
    // This acceptance criterion is enforced at the composition root level
    // The lifecycle coordinator just provides the interface
    const lifecycle = createSpaceMoltLifecycle(options);

    // Initially not running (sleep state)
    expect(lifecycle.isRunning()).toBe(false);

    // Wake: start() is called
    await lifecycle.start();
    expect(lifecycle.isRunning()).toBe(true);

    // Sleep: stop() is called
    await lifecycle.stop();
    expect(lifecycle.isRunning()).toBe(false);
  });

  it('source and toolProvider are called in correct sequence on start', async () => {
    const callSequence: string[] = [];

    const sequencingSource: SpaceMoltDataSource = {
      ...mockSource,
      async connect() {
        callSequence.push('source.connect');
      },
    };

    const sequencingProvider: SpaceMoltToolProvider = {
      ...mockToolProvider,
      async discover() {
        callSequence.push('toolProvider.discover');
        return [];
      },
    };

    const lifecycle = createSpaceMoltLifecycle({
      source: sequencingSource,
      toolProvider: sequencingProvider,
    });

    await lifecycle.start();

    expect(callSequence).toEqual([
      'source.connect',
      'toolProvider.discover',
    ]);
  });

  it('source and toolProvider are called in correct sequence on stop', async () => {
    const callSequence: string[] = [];

    const sequencingSource: SpaceMoltDataSource = {
      ...mockSource,
      async connect() {
        callSequence.push('source.connect');
      },
      async disconnect() {
        callSequence.push('source.disconnect');
      },
    };

    const sequencingProvider: SpaceMoltToolProvider = {
      ...mockToolProvider,
      async discover() {
        callSequence.push('toolProvider.discover');
        return [];
      },
      async close() {
        callSequence.push('toolProvider.close');
      },
    };

    const lifecycle = createSpaceMoltLifecycle({
      source: sequencingSource,
      toolProvider: sequencingProvider,
    });

    await lifecycle.start();
    callSequence.length = 0;
    await lifecycle.stop();

    expect(callSequence).toEqual([
      'source.disconnect',
      'toolProvider.close',
    ]);
  });
});
