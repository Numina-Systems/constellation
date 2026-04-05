// pattern: Imperative Shell

/**
 * Agent event publishing tests.
 * Verifies tui.AC2.1-2.6: Event bus integration and streaming behavior.
 *
 * Tests the stream assembler which is the primary component responsible for
 * event publishing during streaming. The agent loop conditionally calls this
 * assembler when eventBus is present.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import type { StreamEvent } from '../model/types.ts';
import type { AgentEventBus, AgentEvent } from '../tui/types.ts';
import { assembleResponseFromStream } from './stream-assembler.ts';

/**
 * Create an in-memory event bus for testing.
 */
function createTestEventBus(): { bus: AgentEventBus; events: AgentEvent[] } {
  const events: AgentEvent[] = [];

  return {
    bus: {
      publish(event: AgentEvent) {
        events.push(event);
      },
      subscribe() {
        return () => {};
      },
      clear() {
        events.length = 0;
      },
    },
    events,
  };
}

/**
 * Create a simple async iterable from an array.
 */
async function* asyncIterableFromArray<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

describe('Stream Assembler Event Publishing (tui.AC2)', () => {
  describe('tui.AC2.1: Stream events for text response', () => {
    it('should publish stream:start event', async () => {
      const { bus, events } = createTestEventBus();

      const streamEvents: StreamEvent[] = [
        {
          type: 'message_start',
          message: { usage: { input_tokens: 100, output_tokens: 0 } },
        } as StreamEvent,
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text' },
        } as StreamEvent,
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Hello' },
        } as StreamEvent,
        {
          type: 'message_stop',
          message: { stop_reason: 'end_turn' },
        } as StreamEvent,
      ];

      const response = await assembleResponseFromStream(
        asyncIterableFromArray(streamEvents),
        bus,
        1,
        'test-model',
      );

      expect(response.content[0]?.type).toBe('text');
      expect((response.content[0] as any).text).toBe('Hello');

      const streamStartEvent = events.find((e) => e.type === 'stream:start');
      expect(streamStartEvent).toBeDefined();
      if (streamStartEvent && streamStartEvent.type === 'stream:start') {
        expect(streamStartEvent.model).toBe('test-model');
        expect(streamStartEvent.turnIndex).toBe(1);
      }
    });

    it('should publish stream:chunk events for text deltas', async () => {
      const { bus, events } = createTestEventBus();

      const streamEvents: StreamEvent[] = [
        {
          type: 'message_start',
          message: { usage: { input_tokens: 100, output_tokens: 0 } },
        } as StreamEvent,
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text' },
        } as StreamEvent,
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Hello ' },
        } as StreamEvent,
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'world' },
        } as StreamEvent,
        {
          type: 'message_stop',
          message: { stop_reason: 'end_turn' },
        } as StreamEvent,
      ];

      await assembleResponseFromStream(
        asyncIterableFromArray(streamEvents),
        bus,
        1,
        'test-model',
      );

      const chunks = events.filter((e) => e.type === 'stream:chunk');
      expect(chunks.length).toBe(2);
    });

    it('should publish stream:end with usage stats', async () => {
      const { bus, events } = createTestEventBus();

      const streamEvents: StreamEvent[] = [
        {
          type: 'message_start',
          message: { usage: { input_tokens: 100, output_tokens: 50 } },
        } as StreamEvent,
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text' },
        } as StreamEvent,
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Response' },
        } as StreamEvent,
        {
          type: 'message_stop',
          message: { stop_reason: 'end_turn' },
        } as StreamEvent,
      ];

      await assembleResponseFromStream(
        asyncIterableFromArray(streamEvents),
        bus,
        1,
        'test-model',
      );

      const streamEnd = events.find((e) => e.type === 'stream:end');
      expect(streamEnd).toBeDefined();
      if (streamEnd && streamEnd.type === 'stream:end') {
        expect(streamEnd.usage.input_tokens).toBe(100);
        expect(streamEnd.usage.output_tokens).toBe(50);
      }
    });

    it('should publish events in correct order: start, chunks, end', async () => {
      const { bus, events } = createTestEventBus();

      const streamEvents: StreamEvent[] = [
        {
          type: 'message_start',
          message: { usage: { input_tokens: 100, output_tokens: 0 } },
        } as StreamEvent,
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text' },
        } as StreamEvent,
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Hello' },
        } as StreamEvent,
        {
          type: 'message_stop',
          message: { stop_reason: 'end_turn' },
        } as StreamEvent,
      ];

      await assembleResponseFromStream(
        asyncIterableFromArray(streamEvents),
        bus,
        1,
        'test-model',
      );

      const eventTypes = events.map((e) => e.type);
      const streamStartIdx = eventTypes.indexOf('stream:start');
      const streamChunkIdx = eventTypes.indexOf('stream:chunk');
      const streamEndIdx = eventTypes.indexOf('stream:end');

      expect(streamStartIdx).toBeGreaterThanOrEqual(0);
      expect(streamChunkIdx).toBeGreaterThanOrEqual(0);
      expect(streamEndIdx).toBeGreaterThanOrEqual(0);
      expect(streamStartIdx).toBeLessThan(streamChunkIdx);
      expect(streamChunkIdx).toBeLessThan(streamEndIdx);
    });
  });

  describe('tui.AC2.4: Thinking content', () => {
    it('should publish stream:thinking events for thinking deltas', async () => {
      const { bus, events } = createTestEventBus();

      const streamEvents: StreamEvent[] = [
        {
          type: 'message_start',
          message: { usage: { input_tokens: 100, output_tokens: 0 } },
        } as StreamEvent,
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking' },
        } as StreamEvent,
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'Internal reasoning' },
        } as StreamEvent,
        {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'text' },
        } as StreamEvent,
        {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'text_delta', text: 'Final answer' },
        } as StreamEvent,
        {
          type: 'message_stop',
          message: { stop_reason: 'end_turn' },
        } as StreamEvent,
      ];

      const response = await assembleResponseFromStream(
        asyncIterableFromArray(streamEvents),
        bus,
        1,
        'test-model',
      );

      const thinkingEvents = events.filter((e) => e.type === 'stream:thinking');
      expect(thinkingEvents.length).toBeGreaterThan(0);

      if (thinkingEvents[0] && thinkingEvents[0].type === 'stream:thinking') {
        expect((thinkingEvents[0] as any).text).toBe('Internal reasoning');
      }

      expect(response.reasoning_content).toBe('Internal reasoning');
    });

    it('should include thinking in reasoning_content field', async () => {
      const { bus } = createTestEventBus();

      const streamEvents: StreamEvent[] = [
        {
          type: 'message_start',
          message: { usage: { input_tokens: 100, output_tokens: 0 } },
        } as StreamEvent,
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking' },
        } as StreamEvent,
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'Let me think...' },
        } as StreamEvent,
        {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'text' },
        } as StreamEvent,
        {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'text_delta', text: 'Answer' },
        } as StreamEvent,
        {
          type: 'message_stop',
          message: { stop_reason: 'end_turn' },
        } as StreamEvent,
      ];

      const response = await assembleResponseFromStream(
        asyncIterableFromArray(streamEvents),
        bus,
        1,
        'test-model',
      );

      expect(response.reasoning_content).toBe('Let me think...');
    });
  });

  describe('tui.AC2.6: Streaming produces correct response structure', () => {
    it('should assemble text content correctly', async () => {
      const { bus } = createTestEventBus();

      const streamEvents: StreamEvent[] = [
        {
          type: 'message_start',
          message: { usage: { input_tokens: 100, output_tokens: 50 } },
        } as StreamEvent,
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text' },
        } as StreamEvent,
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Hello world' },
        } as StreamEvent,
        {
          type: 'message_stop',
          message: { stop_reason: 'end_turn' },
        } as StreamEvent,
      ];

      const response = await assembleResponseFromStream(
        asyncIterableFromArray(streamEvents),
        bus,
        1,
        'test-model',
      );

      expect(response.content.length).toBeGreaterThan(0);
      expect(response.content[0]?.type).toBe('text');
      expect((response.content[0] as any).text).toBe('Hello world');
      expect(response.stop_reason).toBe('end_turn');
      expect(response.usage.input_tokens).toBe(100);
      expect(response.usage.output_tokens).toBe(50);
    });

    it('should assemble tool use blocks correctly', async () => {
      const { bus } = createTestEventBus();

      const streamEvents: StreamEvent[] = [
        {
          type: 'message_start',
          message: { usage: { input_tokens: 100, output_tokens: 50 } },
        } as StreamEvent,
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'tool-1', name: 'test_tool' },
        } as StreamEvent,
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', input: '{"param":"value"}' },
        } as StreamEvent,
        {
          type: 'message_stop',
          message: { stop_reason: 'tool_use' },
        } as StreamEvent,
      ];

      const response = await assembleResponseFromStream(
        asyncIterableFromArray(streamEvents),
        bus,
        1,
        'test-model',
      );

      expect(response.content.length).toBeGreaterThan(0);
      expect(response.content[0]?.type).toBe('tool_use');
      const toolBlock = response.content[0] as any;
      expect(toolBlock.id).toBe('tool-1');
      expect(toolBlock.name).toBe('test_tool');
      expect(toolBlock.input).toEqual({ param: 'value' });
      expect(response.stop_reason).toBe('tool_use');
    });

    it('should handle mixed text and tool use blocks', async () => {
      const { bus } = createTestEventBus();

      const streamEvents: StreamEvent[] = [
        {
          type: 'message_start',
          message: { usage: { input_tokens: 100, output_tokens: 50 } },
        } as StreamEvent,
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text' },
        } as StreamEvent,
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Let me call a tool' },
        } as StreamEvent,
        {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 'tool-1', name: 'search' },
        } as StreamEvent,
        {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', input: '{"query":"test"}' },
        } as StreamEvent,
        {
          type: 'message_stop',
          message: { stop_reason: 'tool_use' },
        } as StreamEvent,
      ];

      const response = await assembleResponseFromStream(
        asyncIterableFromArray(streamEvents),
        bus,
        1,
        'test-model',
      );

      expect(response.content.length).toBe(2);
      expect(response.content[0]?.type).toBe('text');
      expect(response.content[1]?.type).toBe('tool_use');
    });
  });
});
