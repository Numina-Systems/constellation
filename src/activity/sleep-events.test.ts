import { describe, it, expect } from 'bun:test';
import type { QueuedEvent } from './types.ts';
import {
  buildCompactionEvent,
  buildPredictionReviewEvent,
  buildPatternAnalysisEvent,
} from './sleep-events.ts';

describe('sleep-events', () => {
  const mockEvent: QueuedEvent = {
    id: 'event-1',
    source: 'test-source',
    payload: { test: true },
    priority: 'high',
    enqueuedAt: new Date('2026-03-04T10:30:00Z'),
    flagged: true,
  };

  const testTimestamp = new Date('2026-03-04T09:00:00Z');

  describe('buildCompactionEvent', () => {
    it('should produce expected structure with zero flagged events', () => {
      const event = buildCompactionEvent([], testTimestamp);

      expect(event.source).toBe('sleep-task');
      expect(event.metadata['taskType']).toBe('compaction');
      expect(event.metadata['sleepTask']).toBe(true);
      expect(event.timestamp).toBe(testTimestamp);
      expect(event.content).toContain('Sleep task: Context Compaction');
      expect(event.content).toContain('compact_context');
      expect(event.content).not.toContain('Flagged Events');
    });

    it('should include flagged events section when events are present', () => {
      const event = buildCompactionEvent([mockEvent], testTimestamp);

      expect(event.content).toContain('[Flagged Events: 1 high-priority items arrived during sleep]');
      expect(event.content).toContain('[test-source]');
      expect(event.content).toContain('2026-03-04T10:30:00.000Z');
    });

    it('should include multiple flagged events with their sources and timestamps', () => {
      const event2: QueuedEvent = {
        ...mockEvent,
        id: 'event-2',
        source: 'another-source',
        enqueuedAt: new Date('2026-03-04T11:45:00Z'),
      };

      const event = buildCompactionEvent([mockEvent, event2], testTimestamp);

      expect(event.content).toContain('[Flagged Events: 2 high-priority items arrived during sleep]');
      expect(event.content).toContain('[test-source]');
      expect(event.content).toContain('[another-source]');
    });
  });

  describe('buildPredictionReviewEvent', () => {
    it('should produce expected structure with zero flagged events', () => {
      const event = buildPredictionReviewEvent([], testTimestamp);

      expect(event.source).toBe('sleep-task');
      expect(event.metadata['taskType']).toBe('prediction-review');
      expect(event.metadata['sleepTask']).toBe(true);
      expect(event.timestamp).toBe(testTimestamp);
      expect(event.content).toContain('Sleep task: Prediction Review');
      expect(event.content).toContain('list_predictions');
      expect(event.content).toContain('self_introspect');
      expect(event.content).not.toContain('Flagged Events');
    });

    it('should include flagged events section when events are present', () => {
      const event = buildPredictionReviewEvent([mockEvent], testTimestamp);

      expect(event.content).toContain('[Flagged Events: 1 high-priority items arrived during sleep]');
      expect(event.content).toContain('[test-source]');
    });
  });

  describe('buildPatternAnalysisEvent', () => {
    it('should produce expected structure with zero flagged events', () => {
      const event = buildPatternAnalysisEvent([], testTimestamp);

      expect(event.source).toBe('sleep-task');
      expect(event.metadata['taskType']).toBe('pattern-analysis');
      expect(event.metadata['sleepTask']).toBe(true);
      expect(event.timestamp).toBe(testTimestamp);
      expect(event.content).toContain('Sleep task: Pattern Analysis');
      expect(event.content).toContain('self_introspect');
      expect(event.content).not.toContain('Flagged Events');
    });

    it('should include flagged events section when events are present', () => {
      const event = buildPatternAnalysisEvent([mockEvent], testTimestamp);

      expect(event.content).toContain('[Flagged Events: 1 high-priority items arrived during sleep]');
      expect(event.content).toContain('[test-source]');
    });
  });

  describe('content structure', () => {
    it('compaction event should have all required instructions', () => {
      const event = buildCompactionEvent([], testTimestamp);

      expect(event.content).toContain('compact_context');
      expect(event.content).toContain('Archive important working memory');
      expect(event.content).toContain('Clean up temporary notes');
    });

    it('prediction review event should have all required instructions', () => {
      const event = buildPredictionReviewEvent([], testTimestamp);

      expect(event.content).toContain('list_predictions');
      expect(event.content).toContain('self_introspect');
      expect(event.content).toContain('Annotate each prediction');
      expect(event.content).toContain('reflection to archival memory');
    });

    it('pattern analysis event should have all required instructions', () => {
      const event = buildPatternAnalysisEvent([], testTimestamp);

      expect(event.content).toContain('self_introspect');
      expect(event.content).toContain('recurring patterns');
      expect(event.content).toContain('insights to archival memory');
    });
  });

  describe('flagged events formatting', () => {
    it('should format each flagged event with source and ISO timestamp', () => {
      const events: QueuedEvent[] = [
        {
          id: '1',
          source: 'source-a',
          payload: {},
          priority: 'high',
          enqueuedAt: new Date('2026-03-04T12:00:00Z'),
          flagged: true,
        },
        {
          id: '2',
          source: 'source-b',
          payload: {},
          priority: 'high',
          enqueuedAt: new Date('2026-03-04T13:00:00Z'),
          flagged: true,
        },
      ];

      const event = buildCompactionEvent(events, testTimestamp);

      expect(event.content).toContain('- [source-a] at 2026-03-04T12:00:00.000Z');
      expect(event.content).toContain('- [source-b] at 2026-03-04T13:00:00.000Z');
    });

    it('should include review prompt at end of flagged section', () => {
      const event = buildCompactionEvent([mockEvent], testTimestamp);

      expect(event.content).toContain('Review these and decide if any require immediate action.');
    });
  });
});
