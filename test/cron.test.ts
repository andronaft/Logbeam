import { describe, expect, it } from 'vitest';
import { explainCron } from '../src/lib/cron';

describe('explainCron', () => {
  it('explains fixed times', () => {
    expect(explainCron('30 9 * * *')).toBe('At 09:30');
    expect(explainCron('0 0 1 1 *')).toBe('At 00:00, on day 1 of the month, in January');
    expect(explainCron('0 18 * * MON-FRI')).toBe('At 18:00, on Monday through Friday');
  });

  it('explains intervals', () => {
    expect(explainCron('*/15 * * * *')).toBe('Every 15 minutes');
    expect(explainCron('* * * * *')).toBe('Every minute');
    expect(explainCron('0 */2 * * *')).toBe('At minute 0, every 2 hours');
    expect(explainCron('*/5 9-17 * * *')).toBe('Every 5 minutes, past hour 9 through 17');
  });

  it('supports 6-field Spring expressions with seconds', () => {
    expect(explainCron('0 */15 * * * *')).toBe('Every 15 minutes');
    expect(explainCron('0 0 9 * * MON')).toBe('At 09:00, on Monday');
    expect(explainCron('*/10 * * * * *')).toBe('Every 10 seconds');
    expect(explainCron('30 * * * * *')).toBe('At second 30');
  });

  it('catches a step larger than the field allows', () => {
    // the bug from a real Spring @Scheduled: meant "every 15 minutes", fired once a minute
    expect(() => explainCron('*/900 * * * * *')).toThrow(/larger than the second range/);
  });

  it('supports macros, lists and month names', () => {
    expect(explainCron('@daily')).toBe('At 00:00');
    expect(explainCron('0 8,20 * * *')).toBe('At minute 0, past hour 8 and 20');
    expect(explainCron('0 12 * JAN,JUL *')).toBe('At 12:00, in January and July');
  });

  it('warns about the day-of-month OR weekday rule', () => {
    expect(explainCron('0 0 13 * FRI')).toContain('EITHER');
  });

  it('rejects malformed expressions', () => {
    expect(() => explainCron('* * *')).toThrow(/5 fields/);
    expect(() => explainCron('61 * * * *')).toThrow(/out of range/);
  });
});
