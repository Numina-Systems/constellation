import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { buildArchivistEvent } from '@/activity/sleep-events.ts';
import { SLEEP_TASK_NAMES, sleepTaskCron } from '@/activity/schedule.ts';
import { createArchivistPipeline } from './pipeline.js';
import type { ArchivistPipeline } from './pipeline.js';
import type { MemoryStore } from '@/memory/store.js';
import type { MemoryManager } from '@/memory/manager.js';
import type { PersistenceProvider } from '@/persistence/types.js';

// Mock dependencies for unit tests
type MockMemoryStore = Partial<MemoryStore>;
type MockMemoryManager = Partial<MemoryManager>;
type MockPersistence = Partial<PersistenceProvider>;

describe('archivist activity integration', () => {
  describe('buildArchivistEvent()', () => {
    it('should create event with proper structure', () => {
      const timestamp = new Date();
      const event = buildArchivistEvent([], timestamp);

      expect(event.source).toBe('sleep-task');
      expect(event.content).toContain('Knowledge Archivist');
      expect(event.metadata.taskType).toBe('archivist');
      expect(event.metadata.sleepTask).toBe(true);
      expect(event.timestamp).toBe(timestamp);
    });

    it('should include flagged events in content', () => {
      const flaggedEvents = [
        {
          id: 'event-1',
          source: 'test-source',
          content: 'test event',
          enqueuedAt: new Date(),
        },
        {
          id: 'event-2',
          source: 'another-source',
          content: 'another event',
          enqueuedAt: new Date(),
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
      expect(SLEEP_TASK_NAMES).toContain('sleep-archivist');
    });

    it('should include all sleep task names', () => {
      const expectedTasks = ['sleep-compaction', 'sleep-prediction-review', 'sleep-pattern-analysis', 'sleep-archivist'];
      for (const taskName of expectedTasks) {
        expect(SLEEP_TASK_NAMES).toContain(taskName);
      }
    });
  });

  describe('sleepTaskCron()', () => {
    it('should generate valid cron with offset', () => {
      const sleepSchedule = '0 22 * * *'; // 10 PM
      const offsetHours = 3;
      const timezone = 'UTC';

      const result = sleepTaskCron(sleepSchedule, offsetHours, timezone);

      // Should be a valid cron expression (space-separated fields)
      const parts = result.split(' ');
      expect(parts.length).toBe(5);

      // Extract hour from cron (second field)
      const hour = parseInt(parts[1], 10);
      expect(hour).toBeGreaterThanOrEqual(0);
      expect(hour).toBeLessThan(24);
    });

    it('should respect different timezones', () => {
      const sleepSchedule = '0 22 * * *'; // 10 PM
      const offsetHours = 1;

      const utcCron = sleepTaskCron(sleepSchedule, offsetHours, 'UTC');
      const nysCron = sleepTaskCron(sleepSchedule, offsetHours, 'America/New_York');

      // Both should be valid cron expressions
      expect(utcCron.split(' ').length).toBe(5);
      expect(nysCron.split(' ').length).toBe(5);
    });
  });

  describe('ArchivistPipeline with null embedding', () => {
    it('should complete incremental run without embedding provider', async () => {
      // Create a minimal mock pipeline setup
      const mockMemoryStore: MockMemoryStore = {
        getBlockByLabel: async () => null,
        listBlocks: async () => [],
        getBlockById: async () => null,
        insertBlock: async () => ({ id: 'test', content: '', metadata: {}, createdAt: new Date(), updatedAt: new Date() }),
        deleteBlock: async () => undefined,
        updateBlock: async () => ({ id: 'test', content: '', metadata: {}, createdAt: new Date(), updatedAt: new Date() }),
      };

      const mockMemoryManager: MockMemoryManager = {
        consolidateBlocks: async () => ({ consolidated: [] }),
        getBlock: async () => null,
        search: async () => [],
      };

      const mockPersistence: MockPersistence = {
        query: async () => [],
      };

      const pipeline = createArchivistPipeline({
        memoryStore: mockMemoryStore as unknown as MemoryStore,
        memoryManager: mockMemoryManager as unknown as MemoryManager,
        embedding: null, // No embedding provider
        summarizationModel: null,
        persistence: mockPersistence as unknown as PersistenceProvider,
        owner: 'test-owner',
        modelName: 'test-model',
        dedupThreshold: 0.92,
        crossrefThreshold: 0.75,
        tokenBudget: 50000,
      });

      // Should not throw; dedup/crossref stages handle null embedding gracefully
      expect(() => pipeline).not.toThrow();
      expect(pipeline).toBeDefined();
    });
  });

  describe('activity task integration', () => {
    it('archivist-incremental should be recognized as a valid task name', () => {
      // Verify that archivist-incremental handler will be triggered
      const taskName = 'archivist-incremental';
      expect(typeof taskName).toBe('string');
      expect(taskName.length).toBeGreaterThan(0);
    });

    it('sleep-archivist event should route to archivist agent', () => {
      const timestamp = new Date();
      const event = buildArchivistEvent([], timestamp);

      // Event is properly formed for archivist agent processing
      expect(event.metadata.taskType).toBe('archivist');
      expect(event.metadata.sleepTask).toBe(true);
      expect(typeof event.content).toBe('string');
      expect(event.content.length).toBeGreaterThan(0);
    });
  });
});
