// pattern: Imperative Shell

import { describe, it, expect } from 'bun:test';
import { validateMinimumInterval } from './scheduling.ts';

describe('validateMinimumInterval', () => {
  it('should reject cron expression with interval less than minimum (* * * * * — every minute)', () => {
    const result = validateMinimumInterval('* * * * *', 10);
    expect(result).toBe(false);
  });

  it('should accept cron expression with interval greater than minimum (0 */2 * * * — every 2 hours)', () => {
    const result = validateMinimumInterval('0 */2 * * *', 10);
    expect(result).toBe(true);
  });

  it('should accept cron expression at exactly minimum interval (*/10 * * * * — exactly 10 minutes)', () => {
    const result = validateMinimumInterval('*/10 * * * *', 10);
    expect(result).toBe(true);
  });

  it('should reject cron expression below minimum (*/9 * * * * — 9 minutes)', () => {
    const result = validateMinimumInterval('*/9 * * * *', 10);
    expect(result).toBe(false);
  });

  it('should accept ISO 8601 timestamp (fewer than 2 future runs)', () => {
    const futureTime = new Date();
    futureTime.setHours(futureTime.getHours() + 1);
    const isoTimestamp = futureTime.toISOString();
    const result = validateMinimumInterval(isoTimestamp, 10);
    expect(result).toBe(true);
  });
});
