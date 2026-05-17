import { describe, it, expect } from 'bun:test';
import { buildArchivistEvent } from '@/activity/sleep-events.ts';
import { SLEEP_TASK_NAMES, sleepTaskCron } from '@/activity/schedule.ts';
import type { QueuedEvent } from '@/activity/types.ts';

describe('archivist activity integration', () => {
  describe('buildArchivistEvent()', () => {
    it('should create event with proper structure', () => {
      const timestamp = new Date();
      const event = buildArchivistEvent([], timestamp);

      expect(event.source).toBe('sleep-task');
      expect(event.content).toContain('Knowledge Archivist');
      expect(event.metadata['taskType']).toBe('archivist');
      expect(event.metadata['sleepTask']).toBe(true);
      expect(event.timestamp).toBe(timestamp);
    });

    it('should include flagged events in content', () => {
      const flaggedEvents: ReadonlyArray<QueuedEvent> = [
        {
          id: 'event-1',
          source: 'test-source',
          payload: {},
          enqueuedAt: new Date(),
          priority: 'normal',
          flagged: false,
        },
        {
          id: 'event-2',
          source: 'another-source',
          payload: {},
          enqueuedAt: new Date(),
          priority: 'normal',
          flagged: false,
        },
      ];
      const event = buildArchivistEvent(flaggedEvents, new Date());

      expect(event.content).toContain('Flagged Events: 2');
      expect(event.content).toContain('[test-source]');
      expect(event.content).toContain('[another-source]');
    });

    it('should not include flagged summary when empty', () => {
      const event = buildArchivistEvent([], new Date());
      expect(event.content).not.toContain('Flagged Events');
    });
  });

  describe('SLEEP_TASK_NAMES', () => {
    it('should include sleep-archivist task name', () => {
      const taskNames = Array.from(SLEEP_TASK_NAMES);
      expect(taskNames).toContain('sleep-archivist');
    });

    it('should include all sleep task names', () => {
      const expectedTasks: Array<'sleep-compaction' | 'sleep-prediction-review' | 'sleep-pattern-analysis' | 'sleep-archivist'> = [
        'sleep-compaction',
        'sleep-prediction-review',
        'sleep-pattern-analysis',
        'sleep-archivist',
      ];
      const taskNames = Array.from(SLEEP_TASK_NAMES);
      for (const taskName of expectedTasks) {
        expect(taskNames).toContain(taskName);
      }
    });
  });

  describe('sleepTaskCron()', () => {
    it('should generate valid cron with offset', () => {
      const sleepSchedule = '0 22 * * *';
      const offsetHours = 3;
      const timezone = 'UTC';

      const result = sleepTaskCron(sleepSchedule, offsetHours, timezone);

      const parts = result.split(' ');
      expect(parts.length).toBe(5);

      const hourStr = parts[1];
      expect(hourStr).toBeDefined();
      if (hourStr) {
        const hour = parseInt(hourStr, 10);
        expect(hour).toBeGreaterThanOrEqual(0);
        expect(hour).toBeLessThan(24);
      }
    });

    it('should respect different timezones', () => {
      const sleepSchedule = '0 22 * * *';
      const offsetHours = 1;

      const utcCron = sleepTaskCron(sleepSchedule, offsetHours, 'UTC');
      const nysCron = sleepTaskCron(sleepSchedule, offsetHours, 'America/New_York');

      expect(utcCron.split(' ').length).toBe(5);
      expect(nysCron.split(' ').length).toBe(5);
    });
  });

  describe('activity task integration', () => {
    it('sleep-archivist event has correct metadata for agent routing', () => {
      const timestamp = new Date();
      const event = buildArchivistEvent([], timestamp);

      expect(event.metadata['taskType']).toBe('archivist');
      expect(event.metadata['sleepTask']).toBe(true);
      expect(typeof event.content).toBe('string');
      expect(event.content.length).toBeGreaterThan(0);
    });
  });
});
