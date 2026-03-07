// pattern: Functional Core (tests only)

import { describe, it, expect } from 'bun:test';
import { createDataSourceRegistry } from './data-source-registry.ts';
import type { DataSource, IncomingMessage, DataSourceRegistration } from './data-source.ts';
import type { ActivityManager } from '../activity/types.ts';

/**
 * Mock DataSource for testing.
 * Stores the handler so we can trigger it manually in tests.
 */
function createMockDataSource(name: string): DataSource & { handler?: (msg: IncomingMessage) => void } {
  const source: any = {
    name,
    connect: async () => {},
    disconnect: async () => {},
    onMessage(handler: (message: IncomingMessage) => void) {
      source.handler = handler;
    },
  };
  return source;
}

/**
 * Mock ActivityManager for testing.
 */
function createMockActivityManager(): ActivityManager {
  return {
    getState: async () => ({
      mode: 'active',
      transitionedAt: new Date(),
      nextTransitionAt: new Date(),
      queuedEventCount: 0,
      flaggedEventCount: 0,
    }),
    isActive: async () => true,
    transitionTo: async () => {},
    queueEvent: async () => {},
    flagEvent: async () => {},
    drainQueue: async function* () {},
    getFlaggedEvents: async () => [],
  };
}

describe('createDataSourceRegistry (efficient-agent-loop.AC2)', () => {
  describe('efficient-agent-loop.AC2.3: event routing', () => {
    it('should route messages from registered DataSources to the event sink', async () => {
      const events: Array<IncomingMessage> = [];
      const eventSink = {
        push(event: IncomingMessage) {
          events.push(event);
        },
      };

      let processEventsCalled = false;
      const processEvents = async () => {
        processEventsCalled = true;
      };

      const mockSource = createMockDataSource('test-source');
      const registrations: Array<DataSourceRegistration> = [
        { source: mockSource },
      ];

      const registry = createDataSourceRegistry({
        registrations,
        eventSink,
        processEvents,
      });

      // registry is used in the verification below
      // Verify the source is registered
      expect(registry.sources.length).toBe(1);
      expect(registry.sources[0]?.name).toBe('test-source');

      // Emit a message through the mock source
      const testMessage: IncomingMessage = {
        source: 'test-source',
        content: 'test message',
        metadata: { foo: 'bar' },
        timestamp: new Date(),
      };

      mockSource.handler?.(testMessage);

      // Verify message arrived in sink and processEvents was called
      expect(events.length).toBe(1);
      expect(events[0]).toEqual(testMessage);
      expect(processEventsCalled).toBe(true);
    });

    it('should route messages from multiple DataSources to the same sink', async () => {
      const events: Array<IncomingMessage> = [];
      const eventSink = {
        push(event: IncomingMessage) {
          events.push(event);
        },
      };

      const processEvents = async () => {};

      const source1 = createMockDataSource('source1');
      const source2 = createMockDataSource('source2');

      const registrations: Array<DataSourceRegistration> = [
        { source: source1 },
        { source: source2 },
      ];

      createDataSourceRegistry({
        registrations,
        eventSink,
        processEvents,
      });

      // Emit messages from both sources
      const msg1: IncomingMessage = {
        source: 'source1',
        content: 'from source 1',
        metadata: {},
        timestamp: new Date(),
      };

      const msg2: IncomingMessage = {
        source: 'source2',
        content: 'from source 2',
        metadata: {},
        timestamp: new Date(),
      };

      source1.handler?.(msg1);
      source2.handler?.(msg2);

      // Both messages should be in the sink
      expect(events.length).toBe(2);
      expect(events[0]?.source).toBe('source1');
      expect(events[1]?.source).toBe('source2');
    });

    it('should call processEvents after pushing each message', async () => {
      const eventSink = {
        push() {},
      };

      let processEventCallCount = 0;
      const processEvents = async () => {
        processEventCallCount++;
      };

      const mockSource = createMockDataSource('test');
      const registrations: Array<DataSourceRegistration> = [
        { source: mockSource },
      ];

      createDataSourceRegistry({
        registrations,
        eventSink,
        processEvents,
      });

      const msg: IncomingMessage = {
        source: 'test',
        content: 'msg',
        metadata: {},
        timestamp: new Date(),
      };

      mockSource.handler?.(msg);
      mockSource.handler?.(msg);

      expect(processEventCallCount).toBe(2);
    });
  });

  describe('efficient-agent-loop.AC2.5: unified shutdown', () => {
    it('should disconnect all registered sources on shutdown', async () => {
      const source1 = createMockDataSource('source1');
      const source2 = createMockDataSource('source2');

      let source1Disconnected = false;
      let source2Disconnected = false;

      source1.disconnect = async () => {
        source1Disconnected = true;
      };

      source2.disconnect = async () => {
        source2Disconnected = true;
      };

      const registrations: Array<DataSourceRegistration> = [
        { source: source1 },
        { source: source2 },
      ];

      const registry = createDataSourceRegistry({
        registrations,
        eventSink: { push() {} },
        processEvents: async () => {},
      });

      await registry.shutdown();

      expect(source1Disconnected).toBe(true);
      expect(source2Disconnected).toBe(true);
    });

    it('should continue disconnecting even if one source fails', async () => {
      const source1 = createMockDataSource('source1');
      const source2 = createMockDataSource('source2');
      const source3 = createMockDataSource('source3');

      let source1Disconnected = false;
      let source2Attempted = false;
      let source3Disconnected = false;

      source1.disconnect = async () => {
        source1Disconnected = true;
      };

      source2.disconnect = async () => {
        source2Attempted = true;
        throw new Error('source2 disconnect failed');
      };

      source3.disconnect = async () => {
        source3Disconnected = true;
      };

      const registrations: Array<DataSourceRegistration> = [
        { source: source1 },
        { source: source2 },
        { source: source3 },
      ];

      const registry = createDataSourceRegistry({
        registrations,
        eventSink: { push() {} },
        processEvents: async () => {},
      });

      // Should not throw even though source2 fails
      await expect(registry.shutdown()).resolves.toBeUndefined();

      expect(source1Disconnected).toBe(true);
      expect(source2Attempted).toBe(true);
      expect(source3Disconnected).toBe(true);
    });
  });

  describe('activity interceptor wrapping', () => {
    it('should wrap handler with activity interceptor when activityManager is provided', async () => {
      const events: Array<IncomingMessage> = [];
      const eventSink = {
        push(event: IncomingMessage) {
          events.push(event);
        },
      };

      const mockSource = createMockDataSource('test');
      const activityManager = createMockActivityManager();

      const registrations: Array<DataSourceRegistration> = [
        { source: mockSource },
      ];

      createDataSourceRegistry({
        registrations,
        eventSink,
        processEvents: async () => {},
        activityManager,
      });

      // Handler should be wrapped
      expect(mockSource.handler).toBeDefined();

      // When activity is active, message should pass through
      const msg: IncomingMessage = {
        source: 'test',
        content: 'test',
        metadata: {},
        timestamp: new Date(),
      };

      mockSource.handler?.(msg);

      // Due to async nature of the interceptor, use a condition-based wait
      // to verify the message arrives in the event sink
      await new Promise(resolve => setTimeout(resolve, 10));

      // With mocked isActive returning true, message should be pushed to event sink
      // (the interceptor calls originalHandler when isActive is true)
      expect(events.length).toBe(1);
      expect(events[0]).toEqual(msg);
    });

    it('should call handler directly when activityManager is not provided', async () => {
      let handlerCalled = false;
      const eventSink = {
        push() {
          handlerCalled = true;
        },
      };

      const mockSource = createMockDataSource('test');

      const registrations: Array<DataSourceRegistration> = [
        { source: mockSource },
      ];

      createDataSourceRegistry({
        registrations,
        eventSink,
        processEvents: async () => {},
        // no activityManager
      });

      const msg: IncomingMessage = {
        source: 'test',
        content: 'test',
        metadata: {},
        timestamp: new Date(),
      };

      mockSource.handler?.(msg);

      expect(handlerCalled).toBe(true);
    });
  });
});
