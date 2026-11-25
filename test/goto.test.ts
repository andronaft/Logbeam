import { describe, expect, it } from 'vitest';
import { indexAtTime, parseGotoTime } from '../src/lib/goto';

const first = Date.UTC(2026, 9, 4, 9, 58, 0);
const last = Date.UTC(2026, 9, 4, 11, 30, 0);

describe('parseGotoTime', () => {
  it('reads a time of day on the log’s day, in UTC', () => {
    expect(parseGotoTime('10:05', first, last, 'utc')).toBe(Date.UTC(2026, 9, 4, 10, 5));
    expect(parseGotoTime('10:05:30.25', first, last, 'utc')).toBe(Date.UTC(2026, 9, 4, 10, 5, 30, 250));
    expect(parseGotoTime(' 9:59:01 ', first, last, 'utc')).toBe(Date.UTC(2026, 9, 4, 9, 59, 1));
  });

  it('reads a full date and time, with or without a zone', () => {
    expect(parseGotoTime('2026-10-04 10:05:30', first, last, 'utc')).toBe(Date.UTC(2026, 9, 4, 10, 5, 30));
    expect(parseGotoTime('2026-10-04T13:05:30+03:00', first, last, 'utc')).toBe(Date.UTC(2026, 9, 4, 10, 5, 30));
    expect(parseGotoTime('2026-10-04T10:05:30Z', first, last, 'local')).toBe(Date.UTC(2026, 9, 4, 10, 5, 30));
  });

  it('reads a time of day in the browser’s zone in local mode', () => {
    const local = new Date(first);
    const expected = new Date(local.getFullYear(), local.getMonth(), local.getDate(), 12, 0, 0).getTime();
    // a log of one local day, from its midnight
    const midnight = new Date(local.getFullYear(), local.getMonth(), local.getDate()).getTime();
    expect(parseGotoTime('12:00', midnight, midnight + 86_399_000, 'local')).toBe(expected);
  });

  it('finds the right day in a log that goes past midnight', () => {
    const night = Date.UTC(2026, 9, 4, 23, 0);
    expect(parseGotoTime('00:30', night, night + 3 * 3_600_000, 'utc')).toBe(Date.UTC(2026, 9, 5, 0, 30));
    expect(parseGotoTime('23:30', night, night + 3 * 3_600_000, 'utc')).toBe(Date.UTC(2026, 9, 4, 23, 30));
  });

  it('gives the log’s first day for a time outside the log', () => {
    expect(parseGotoTime('08:00', first, last, 'utc')).toBe(Date.UTC(2026, 9, 4, 8, 0));
  });

  it('turns down what isn’t a time', () => {
    for (const input of ['', 'soon', '25:00', '10:61', '10', '2026-10-04']) {
      expect(parseGotoTime(input, first, last, 'utc'), input).toBeNull();
    }
  });
});

describe('indexAtTime', () => {
  const times = [NaN, 1000, 1000, NaN, 2000, 3000];

  it('gives the first entry at or after the moment', () => {
    expect(indexAtTime(times, 1500)).toBe(4);
    expect(indexAtTime(times, 1000)).toBe(1);
    expect(indexAtTime(times, 0)).toBe(1);
  });

  it('gives the last timed entry after the end, and -1 without times', () => {
    expect(indexAtTime(times, 9999)).toBe(5);
    expect(indexAtTime([NaN, NaN], 5)).toBe(-1);
  });
});
