import { describe, expect, it } from 'vitest';
import { explainCron } from '../src/lib/cron';
import { changedRange, diffJson } from '../src/lib/diff';
import { filterByFields, parseFieldQuery } from '../src/lib/fields';
import { bookmarkReport, formatDuration } from '../src/lib/insights';
import { collapseRepeats, formatJsonRecord, parseLog, parseTimestamp } from '../src/lib/logs';
import { findRegexRisk } from '../src/lib/regexSafety';
import { maskSecrets } from '../src/lib/secrets';
import { searchRanges } from '../src/lib/segments';
import { describeJwt } from '../src/lib/transforms';

/** Edge cases that were wrong, each found with a real input. */

describe('JSON logs with epoch numbers', () => {
  it('reads nanoseconds and microseconds instead of failing to open the log', () => {
    const [nanos] = parseLog('{"ts":1727604000123456789,"level":"info","msg":"hi"}');
    expect(nanos.time).toBe(Date.UTC(2024, 8, 29, 10, 0, 0, 123));
    expect(nanos.text).toBe('2024-09-29T10:00:00.123Z info hi');
    expect(parseLog('{"ts":1727604000123456,"msg":"hi"}')[0].time).toBe(Date.UTC(2024, 8, 29, 10, 0, 0, 123));
    // seconds and millis as before
    expect(parseLog('{"ts":1727604000.5,"msg":"hi"}')[0].time).toBe(Date.UTC(2024, 8, 29, 10, 0, 0, 500));
    expect(parseLog('{"ts":1727604000123,"msg":"hi"}')[0].time).toBe(Date.UTC(2024, 8, 29, 10, 0, 0, 123));
  });

  it('shows a number too big for a date as it is', () => {
    const [line] = parseLog('{"ts":1e300,"msg":"hi"}');
    expect(line.time).toBeNull();
    expect(line.text).toBe('1e+300 hi');
  });
});

describe('JSON records as text', () => {
  it('keeps an object under a message key as a field, not "[object Object]"', () => {
    expect(formatJsonRecord({ level: 'info', event: { action: 'login' } })).toBe('info {"event":{"action":"login"}}');
  });

  it('keeps the fields that look like a level or a message but are not the one shown', () => {
    expect(formatJsonRecord({ message: 'hi', event: { a: 1 }, severity: 'high', level: 'info' })).toBe(
      'info hi {"event":{"a":1},"severity":"high"}',
    );
  });
});

describe('field filters', () => {
  const lines = parseLog('{"level":50,"msg":"boom"}\n{"level":20,"msg":"details"}\n{"level":30,"msg":"ok"}\n');
  const filter = (query: string) => filterByFields(lines, parseFieldQuery(query)!).map((line) => line.text.split(' ').pop());

  it('reads pino and bunyan numeric levels by their name', () => {
    expect(filter('level=error')).toEqual(['boom']);
    expect(filter('level!=debug')).toEqual(['boom', 'ok']);
  });

  it("doesn't take what every object has for a field", () => {
    expect(filter('constructor=x')).toEqual([]);
    expect(filter('toString=x')).toEqual([]);
  });
});

describe('masking secrets', () => {
  it('masks a quoted password with an escaped quote in it, all of it', () => {
    expect(maskSecrets('{"password":"a\\"bcdefgh"}')).not.toContain('bcdefgh');
    const masked = maskSecrets('{"password":"abcd\\"efgh"}');
    expect(masked).not.toContain('efgh');
    expect(masked.endsWith('"}')).toBe(true);
  });

  it('masks a password that a "," or ";" cuts short', () => {
    expect(maskSecrets('password=Pa;ssw0rd!')).not.toContain('ssw0rd');
    expect(maskSecrets('password=ab,cdefgh')).not.toContain('cdefgh');
  });

  it('still leaves counters alone', () => {
    expect(maskSecrets('tokens=1,234')).toBe('tokens=1,234');
    expect(maskSecrets('tokens_used=1234')).toBe('tokens_used=1234');
  });
});

describe('cron', () => {
  it('counts Quartz weekdays from Sunday = 1', () => {
    expect(explainCron('0 0 12 ? * 2 *')).toContain('Monday');
    expect(explainCron('0 0 12 ? * 1 *')).toContain('Sunday');
    expect(explainCron('0 0 12 ? * MON *')).toContain('Monday');
    expect(() => explainCron('0 0 12 ? * 0 *')).toThrow(/1-7/);
  });

  it('turns down fields that are not numbers', () => {
    for (const cron of ['-5 * * * *', ',5 * * * *', '0 0 0x1F * *', '1e1 * * * *']) {
      expect(() => explainCron(cron), cron).toThrow();
    }
  });
});

describe('formatDuration', () => {
  it("doesn't round up to 60s, 1000ms or 60m", () => {
    expect(formatDuration(59_999)).toBe('1m');
    expect(formatDuration(999.96)).toBe('1s');
    expect(formatDuration(3_599_999)).toBe('1h');
    expect(formatDuration(1200)).toBe('1.2s');
    expect(formatDuration(120)).toBe('120ms');
  });
});

describe('search highlights', () => {
  it('keeps going past an empty match', () => {
    expect(searchRanges('a xx b', 'x*', true, false)).toEqual([{ start: 2, end: 4, cls: 'match' }]);
    expect(searchRanges('the color', 'colou?r|', true, false)).toEqual([{ start: 4, end: 9, cls: 'match' }]);
  });
});

describe('diffJson', () => {
  it('compares keys that every object has like any other key', () => {
    expect(diffJson({}, { constructor: 1 })).toEqual([{ path: '$.constructor', kind: 'added', after: 1 }]);
    expect(diffJson({ toString: 1 }, {})).toEqual([{ path: '$.toString', kind: 'removed', before: 1 }]);
  });
});

describe('changedRange', () => {
  it("doesn't cut an emoji in half", () => {
    const { before, after } = changedRange('a😀b', 'a😃b');
    expect('a😀b'.slice(...before)).toBe('😀');
    expect('a😃b'.slice(...after)).toBe('😃');
  });
});

describe('findRegexRisk', () => {
  it('catches a group with a variable part repeated an exact number of times', () => {
    expect(findRegexRisk('^(.*a){12}$')).not.toBeNull();
    // fixed counts are fine
    expect(findRegexRisk('(\\d{2}:){2}\\d{2}')).toBeNull();
    expect(findRegexRisk('(ab){3}')).toBeNull();
  });
});

describe('parseTimestamp', () => {
  it("doesn't roll a day that doesn't exist over to the next month", () => {
    expect(parseTimestamp('2026-02-30T10:00:00Z')).toBeNull();
    expect(parseTimestamp('2028-02-29T10:00:00Z')).toBe(Date.UTC(2028, 1, 29, 10));
  });
});

describe('bookmark report', () => {
  it('fences a line that has backticks in it', () => {
    const lines = parseLog('INFO run ```rm -rf``` now\n');
    const report = bookmarkReport([{ line: 1, note: '' }], lines, { title: 'x', url: '', timeMode: 'utc' });
    expect(report).toContain('  ````\n  INFO run ```rm -rf``` now\n  ````');
  });
});

describe('describeJwt', () => {
  it('says a date is not valid instead of failing', () => {
    const part = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, '');
    const jwt = `${part({ alg: 'HS256' })}.${part({ exp: 1e17 })}.sig`;
    expect(describeJwt(jwt, 0)).toContain('not a valid date');
  });
});

describe('big logs', () => {
  it('collapses an entry of 200k lines without running out of call stack', () => {
    const text = ['ERROR dump follows', ...Array.from({ length: 200_000 }, (_, i) => `\tframe ${i}`)].join('\n');
    const lines = parseLog(text);
    expect(collapseRepeats(lines)).toHaveLength(200_001);
  });

  it('collapses with signatures worked out by the caller', () => {
    const lines = parseLog('INFO retry 1\nINFO retry 2\nINFO done\n');
    let calls = 0;
    const collapsed = collapseRepeats(lines, (line) => {
      calls++;
      return line.text.replace(/\d+/g, '#');
    });
    expect(collapsed.map((line) => line.repeat)).toEqual([2, 1]);
    expect(calls).toBe(3);
  });
});
