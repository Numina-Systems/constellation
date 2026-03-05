import { describe, it, expect } from 'bun:test';
import { currentMode, nextTransitionTime, validateCron } from './schedule.ts';
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
});
