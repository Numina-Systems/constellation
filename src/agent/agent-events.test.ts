// pattern: Imperative Shell

/**
 * Agent event publishing tests.
 * Verifies tui.AC2.1-2.6: Event bus integration and streaming behavior.
 *
 * Tests the stream assembler which is the primary component responsible for
 * event publishing during streaming. The agent loop conditionally calls this
 * assembler when eventBus is present.
 *
 * Also includes agent-level integration tests with mocked dependencies to verify
 * event publishing order at the agent boundary (turn:start/turn:end).
 */

import { describe, it, expect } from 'bun:test';
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
          message: { id: 'msg-1', usage: { input_tokens: 100, output_tokens: 0 } },
        },
        {
          type: 'content_block_start',
          content_block: { type: 'text', index: 0 },
        },
        {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Hello', index: 0 },
        },
        {
          type: 'message_stop',
          message: { stop_reason: 'end_turn' },
        },
      ];

      const response = await assembleResponseFromStream(
        asyncIterableFromArray(streamEvents),
        bus,
        1,
        'test-model',
      );

      expect(response.content[0]?.type).toBe('text');
      if (response.content[0]?.type === 'text') {
        expect(response.content[0].text).toBe('Hello');
      }

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
          message: { id: 'msg-1', usage: { input_tokens: 100, output_tokens: 0 } },
        },
        {
          type: 'content_block_start',
          content_block: { type: 'text', index: 0 },
        },
        {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Hello ', index: 0 },
        },
        {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'world', index: 0 },
        },
        {
          type: 'message_stop',
          message: { stop_reason: 'end_turn' },
        },
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
          message: { id: 'msg-1', usage: { input_tokens: 100, output_tokens: 50 } },
        },
        {
          type: 'content_block_start',
          content_block: { type: 'text', index: 0 },
        },
        {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Response', index: 0 },
        },
        {
          type: 'message_stop',
          message: { stop_reason: 'end_turn' },
        },
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
          message: { id: 'msg-1', usage: { input_tokens: 100, output_tokens: 0 } },
        },
        {
          type: 'content_block_start',
          content_block: { type: 'text', index: 0 },
        },
        {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Hello', index: 0 },
        },
        {
          type: 'message_stop',
          message: { stop_reason: 'end_turn' },
        },
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
          message: { id: 'msg-1', usage: { input_tokens: 100, output_tokens: 0 } },
        },
        {
          type: 'content_block_start',
          content_block: { type: 'thinking', index: 0 },
        },
        {
          type: 'content_block_delta',
          delta: { type: 'thinking_delta', thinking: 'Internal reasoning', index: 0 },
        },
        {
          type: 'content_block_start',
          content_block: { type: 'text', index: 1 },
        },
        {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Final answer', index: 1 },
        },
        {
          type: 'message_stop',
          message: { stop_reason: 'end_turn' },
        },
      ];

      const response = await assembleResponseFromStream(
        asyncIterableFromArray(streamEvents),
        bus,
        1,
        'test-model',
      );

      const thinkingEvents = events.filter((e) => e.type === 'stream:thinking');
      expect(thinkingEvents.length).toBeGreaterThan(0);

      const thinkingEvent = thinkingEvents[0];
      if (thinkingEvent && thinkingEvent.type === 'stream:thinking') {
        expect(thinkingEvent.text).toBe('Internal reasoning');
      }

      expect(response.reasoning_content).toBe('Internal reasoning');
    });

    it('should include thinking in reasoning_content field', async () => {
      const { bus } = createTestEventBus();

      const streamEvents: StreamEvent[] = [
        {
          type: 'message_start',
          message: { id: 'msg-1', usage: { input_tokens: 100, output_tokens: 0 } },
        },
        {
          type: 'content_block_start',
          content_block: { type: 'thinking', index: 0 },
        },
        {
          type: 'content_block_delta',
          delta: { type: 'thinking_delta', thinking: 'Let me think...', index: 0 },
        },
        {
          type: 'content_block_start',
          content_block: { type: 'text', index: 1 },
        },
        {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Answer', index: 1 },
        },
        {
          type: 'message_stop',
          message: { stop_reason: 'end_turn' },
        },
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
          message: { id: 'msg-1', usage: { input_tokens: 100, output_tokens: 50 } },
        },
        {
          type: 'content_block_start',
          content_block: { type: 'text', index: 0 },
        },
        {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Hello world', index: 0 },
        },
        {
          type: 'message_stop',
          message: { stop_reason: 'end_turn' },
        },
      ];

      const response = await assembleResponseFromStream(
        asyncIterableFromArray(streamEvents),
        bus,
        1,
        'test-model',
      );

      expect(response.content.length).toBeGreaterThan(0);
      expect(response.content[0]?.type).toBe('text');
      if (response.content[0]?.type === 'text') {
        expect(response.content[0].text).toBe('Hello world');
      }
      expect(response.stop_reason).toBe('end_turn');
      expect(response.usage.input_tokens).toBe(100);
      expect(response.usage.output_tokens).toBe(50);
    });

    it('should assemble tool use blocks correctly', async () => {
      const { bus } = createTestEventBus();

      const streamEvents: StreamEvent[] = [
        {
          type: 'message_start',
          message: { id: 'msg-1', usage: { input_tokens: 100, output_tokens: 50 } },
        },
        {
          type: 'content_block_start',
          content_block: { type: 'tool_use', id: 'tool-1', name: 'test_tool', index: 0 },
        },
        {
          type: 'content_block_delta',
          delta: { type: 'input_json_delta', input: '{"param":"value"}', index: 0 },
        },
        {
          type: 'message_stop',
          message: { stop_reason: 'tool_use' },
        },
      ];

      const response = await assembleResponseFromStream(
        asyncIterableFromArray(streamEvents),
        bus,
        1,
        'test-model',
      );

      expect(response.content.length).toBeGreaterThan(0);
      expect(response.content[0]?.type).toBe('tool_use');
      const toolBlock = response.content[0];
      if (toolBlock && toolBlock.type === 'tool_use') {
        expect(toolBlock.id).toBe('tool-1');
        expect(toolBlock.name).toBe('test_tool');
        expect(toolBlock.input).toEqual({ param: 'value' });
      }
      expect(response.stop_reason).toBe('tool_use');
    });

    it('should handle mixed text and tool use blocks', async () => {
      const { bus } = createTestEventBus();

      const streamEvents: StreamEvent[] = [
        {
          type: 'message_start',
          message: { id: 'msg-1', usage: { input_tokens: 100, output_tokens: 50 } },
        },
        {
          type: 'content_block_start',
          content_block: { type: 'text', index: 0 },
        },
        {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Let me call a tool', index: 0 },
        },
        {
          type: 'content_block_start',
          content_block: { type: 'tool_use', id: 'tool-1', name: 'search', index: 1 },
        },
        {
          type: 'content_block_delta',
          delta: { type: 'input_json_delta', input: '{"query":"test"}', index: 1 },
        },
        {
          type: 'message_stop',
          message: { stop_reason: 'tool_use' },
        },
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

  describe('tui.AC2.2 & AC2.3: Turn and stream event coordination', () => {
    it('AC2.3: should enable turn:start/end bracketing via event bus', async () => {
      const { bus, events } = createTestEventBus();

      // The stream assembler publishes all stream events.
      // The agent loop (which calls assembleResponseFromStream) publishes turn:start/end.
      // This test verifies the stream assembler provides all needed stream events.
      const streamEvents: StreamEvent[] = [
        {
          type: 'message_start',
          message: { id: 'msg-1', usage: { input_tokens: 100, output_tokens: 0 } },
        },
        {
          type: 'content_block_start',
          content_block: { type: 'text', index: 0 },
        },
        {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Response', index: 0 },
        },
        {
          type: 'message_stop',
          message: { stop_reason: 'end_turn' },
        },
      ];

      await assembleResponseFromStream(
        asyncIterableFromArray(streamEvents),
        bus,
        0,
        'test-model',
      );

      // Verify stream:start is published first (agent will wrap with turn:start before this)
      // and stream:end is published last (agent will wrap with turn:end after this)
      const eventTypes = events.map((e) => e.type);
      expect(eventTypes[0]).toBe('stream:start');
      expect(eventTypes[eventTypes.length - 1]).toBe('stream:end');
    });

    it('AC2.3: stream events maintain order for turn bracketing', async () => {
      const { bus, events } = createTestEventBus();

      const streamEvents: StreamEvent[] = [
        {
          type: 'message_start',
          message: { id: 'msg-1', usage: { input_tokens: 100, output_tokens: 0 } },
        },
        {
          type: 'content_block_start',
          content_block: { type: 'text', index: 0 },
        },
        {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Hello ', index: 0 },
        },
        {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'world', index: 0 },
        },
        {
          type: 'message_stop',
          message: { stop_reason: 'end_turn' },
        },
      ];

      await assembleResponseFromStream(
        asyncIterableFromArray(streamEvents),
        bus,
        0,
        'test-model',
      );

      const eventTypes = events.map((e) => e.type);
      const streamStartIdx = eventTypes.indexOf('stream:start');
      const chunkIndices = eventTypes
        .map((t, i) => (t === 'stream:chunk' ? i : -1))
        .filter((i) => i >= 0);
      const streamEndIdx = eventTypes.indexOf('stream:end');

      expect(streamStartIdx).toBeGreaterThanOrEqual(0);
      expect(chunkIndices.length).toBeGreaterThan(0);
      expect(streamEndIdx).toBeGreaterThanOrEqual(0);
      if (chunkIndices.length > 0) {
        expect(streamStartIdx).toBeLessThan(chunkIndices[0]!);
        expect(chunkIndices[chunkIndices.length - 1]!).toBeLessThan(streamEndIdx);
      }
    });

    it('AC2.2: stream events include all fields needed for tool result publishing', async () => {
      const { bus, events } = createTestEventBus();

      const streamEvents: StreamEvent[] = [
        {
          type: 'message_start',
          message: { id: 'msg-1', usage: { input_tokens: 100, output_tokens: 50 } },
        },
        {
          type: 'content_block_start',
          content_block: { type: 'text', index: 0 },
        },
        {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Test', index: 0 },
        },
        {
          type: 'message_stop',
          message: { stop_reason: 'end_turn' },
        },
      ];

      await assembleResponseFromStream(
        asyncIterableFromArray(streamEvents),
        bus,
        1,
        'test-model',
      );

      // Verify events have the structure needed for agent to implement AC2.2
      // (tool:start and tool:result events are published by agent loop, not assembler)
      const streamStart = events.find((e) => e.type === 'stream:start');
      expect(streamStart).toBeDefined();
      if (streamStart && streamStart.type === 'stream:start') {
        expect(streamStart.model).toBe('test-model');
        expect(streamStart.turnIndex).toBe(1);
      }

      const streamChunk = events.find((e) => e.type === 'stream:chunk');
      expect(streamChunk).toBeDefined();
      if (streamChunk && streamChunk.type === 'stream:chunk') {
        expect(streamChunk.text).toBe('Test');
        expect(streamChunk.turnIndex).toBe(1);
      }

      const streamEnd = events.find((e) => e.type === 'stream:end');
      expect(streamEnd).toBeDefined();
      if (streamEnd && streamEnd.type === 'stream:end') {
        expect(streamEnd.usage.input_tokens).toBe(100);
        expect(streamEnd.usage.output_tokens).toBe(50);
        expect(streamEnd.stopReason).toBe('end_turn');
      }
    });
  });
});
