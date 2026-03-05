import { describe, it, expect } from 'bun:test';
import { currentMode, nextTransitionTime, validateCron, sleepTaskCron, isSleepTask, isTransitionTask, SLEEP_TASK_NAMES, TRANSITION_TASK_NAMES } from './schedule.ts';
import type { ScheduleConfig } from './schedule.ts';

describe('schedule helpers', () => {
  describe('currentMode()', () => {
    it('should return active when both crons have never fired', () => {
      const config: ScheduleConfig = {
        sleepSchedule: '0 2 31 2 *',
        wakeSchedule: '0 3 31 2 *',
        timezone: 'UTC',
      };
      expect(currentMode(config)).toBe('active');
    });

    it('should compute current mode from cron expressions', () => {
      const config: ScheduleConfig = {
        sleepSchedule: '0 22 * * *',
        wakeSchedule: '0 6 * * *',
        timezone: 'UTC',
      };
      const mode = currentMode(config);
      // Time-dependent: we can't predict the mode, so we verify the function doesn't throw and returns a valid mode
      expect(['active', 'sleeping']).toContain(mode);
    });

    it('should respect timezone parameter', () => {
      const config: ScheduleConfig = {
        sleepSchedule: '0 22 * * *',
        wakeSchedule: '0 6 * * *',
        timezone: 'America/New_York',
      };
      expect(() => currentMode(config)).not.toThrow();
    });

    it('should handle UTC timezone', () => {
      const config: ScheduleConfig = {
        sleepSchedule: '0 22 * * *',
        wakeSchedule: '0 6 * * *',
        timezone: 'UTC',
      };
      const mode = currentMode(config);
      // Time-dependent: we can't predict the mode, so we verify the function doesn't throw and returns a valid mode
      expect(['active', 'sleeping']).toContain(mode);
    });
  });

  describe('nextTransitionTime()', () => {
    it('should return next wake time when currently sleeping', () => {
      const config: ScheduleConfig = {
        sleepSchedule: '0 22 * * *',
        wakeSchedule: '0 6 * * *',
        timezone: 'UTC',
      };
      const nextTime = nextTransitionTime('sleeping', config);
      expect(nextTime).not.toBeNull();
      expect(nextTime instanceof Date).toBe(true);
    });

    it('should return next sleep time when currently active', () => {
      const config: ScheduleConfig = {
        sleepSchedule: '0 22 * * *',
        wakeSchedule: '0 6 * * *',
        timezone: 'UTC',
      };
      const nextTime = nextTransitionTime('active', config);
      expect(nextTime).not.toBeNull();
      expect(nextTime instanceof Date).toBe(true);
    });

    it('should use different schedules for active vs sleeping', () => {
      const config: ScheduleConfig = {
        sleepSchedule: '0 22 * * *',
        wakeSchedule: '0 6 * * *',
        timezone: 'UTC',
      };
      const sleepingNext = nextTransitionTime('sleeping', config);
      const activeNext = nextTransitionTime('active', config);
      expect(sleepingNext).toBeDefined();
      expect(activeNext).toBeDefined();
      expect(sleepingNext).not.toEqual(activeNext);
    });

    it('should return null if target schedule has no valid future occurrence', () => {
      const config: ScheduleConfig = {
        sleepSchedule: '0 22 * * *',
        wakeSchedule: '0 2 31 2 *',
        timezone: 'UTC',
      };
      const nextTime = nextTransitionTime('sleeping', config);
      expect(nextTime).toBeNull();
    });

    it('should return valid Date for active mode with standard schedule', () => {
      const config: ScheduleConfig = {
        sleepSchedule: '0 22 * * *',
        wakeSchedule: '0 6 * * *',
        timezone: 'UTC',
      };
      const nextTime = nextTransitionTime('active', config);
      expect(nextTime instanceof Date).toBe(true);
      expect(nextTime !== null).toBe(true);
    });
  });

  describe('validateCron()', () => {
    it('should return null for valid cron expression', () => {
      const result = validateCron('0 22 * * *');
      expect(result).toBeNull();
    });

    it('should return null for valid complex cron expression', () => {
      const result = validateCron('*/15 * * * *');
      expect(result).toBeNull();
    });

    it('should return error message for invalid cron expression', () => {
      const result = validateCron('invalid cron');
      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
    });

    it('should return error message for out-of-range values', () => {
      const result = validateCron('60 * * * *');
      expect(result).not.toBeNull();
    });

    it('should validate valid Croner expressions', () => {
      const result = validateCron('0 22 * * *');
      expect(result).toBeNull();
    });
  });

  describe('sleepTaskCron()', () => {
    it('should compute cron for 2-hour offset from 10 PM sleep', () => {
      const cron = sleepTaskCron('0 22 * * *', 2, 'America/Toronto');
      // 10 PM + 2 hours = midnight (0 0)
      expect(cron).toBe('0 0 * * *');
    });

    it('should compute cron for 4-hour offset from 10 PM sleep', () => {
      const cron = sleepTaskCron('0 22 * * *', 4, 'America/Toronto');
      // 10 PM + 4 hours = 2 AM (0 2)
      expect(cron).toBe('0 2 * * *');
    });

    it('should compute cron for 6-hour offset from 10 PM sleep', () => {
      const cron = sleepTaskCron('0 22 * * *', 6, 'America/Toronto');
      // 10 PM + 6 hours = 4 AM (0 4)
      expect(cron).toBe('0 4 * * *');
    });

    it('should throw when sleep schedule has no future occurrence', () => {
      expect(() => sleepTaskCron('0 22 31 2 *', 2, 'UTC')).toThrow();
    });

    it('should produce valid cron expressions', () => {
      const cron = sleepTaskCron('0 22 * * *', 2, 'America/Toronto');
      expect(validateCron(cron)).toBeNull();
    });
  });

  describe('isSleepTask()', () => {
    it('should return true for sleep-compaction', () => {
      expect(isSleepTask('sleep-compaction')).toBe(true);
    });

    it('should return true for sleep-prediction-review', () => {
      expect(isSleepTask('sleep-prediction-review')).toBe(true);
    });

    it('should return true for sleep-pattern-analysis', () => {
      expect(isSleepTask('sleep-pattern-analysis')).toBe(true);
    });

    it('should return false for unrelated task name', () => {
      expect(isSleepTask('review-predictions')).toBe(false);
    });

    it('should return false for transition task names', () => {
      expect(isSleepTask('transition-to-sleep')).toBe(false);
      expect(isSleepTask('transition-to-wake')).toBe(false);
    });
  });

  describe('isTransitionTask()', () => {
    it('should return true for transition-to-sleep', () => {
      expect(isTransitionTask('transition-to-sleep')).toBe(true);
    });

    it('should return true for transition-to-wake', () => {
      expect(isTransitionTask('transition-to-wake')).toBe(true);
    });

    it('should return false for sleep task names', () => {
      expect(isTransitionTask('sleep-compaction')).toBe(false);
      expect(isTransitionTask('sleep-prediction-review')).toBe(false);
      expect(isTransitionTask('sleep-pattern-analysis')).toBe(false);
    });

    it('should return false for unrelated task names', () => {
      expect(isTransitionTask('some-other-task')).toBe(false);
    });
  });

  describe('task name constants', () => {
    it('should have all sleep task names in SLEEP_TASK_NAMES', () => {
      expect(SLEEP_TASK_NAMES).toContain('sleep-compaction');
      expect(SLEEP_TASK_NAMES).toContain('sleep-prediction-review');
      expect(SLEEP_TASK_NAMES).toContain('sleep-pattern-analysis');
      expect(SLEEP_TASK_NAMES.length).toBe(3);
    });

    it('should have all transition task names in TRANSITION_TASK_NAMES', () => {
      expect(TRANSITION_TASK_NAMES).toContain('transition-to-sleep');
      expect(TRANSITION_TASK_NAMES).toContain('transition-to-wake');
      expect(TRANSITION_TASK_NAMES.length).toBe(2);
    });
  });
});
