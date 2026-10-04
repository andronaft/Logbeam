import { describe, expect, it } from 'vitest';
import {
  appendedText,
  bookmarkReport,
  defaultColumns,
  fieldStats,
  formatTime,
  groupErrors,
  isMostlyJson,
  lineFields,
  localizeTimestamp,
  tableCells,
} from '../src/lib/insights';
import { parseLog } from '../src/lib/logs';

const LOG = [
  '2026-10-04T10:00:00Z INFO start service=api status=200',
  '2026-10-04T10:00:05Z ERROR request 7781 failed service=api status=502',
  '\tat com.example.Client.call(Client.java:88)',
  '\tat com.example.Api.handle(Api.java:12)',
  '2026-10-04T10:00:09Z ERROR request 7782 failed service=api status=502',
  '\tat com.example.Client.call(Client.java:88)',
  '\tat com.example.Api.handle(Api.java:12)',
  '2026-10-04T10:00:10Z ERROR disk full service=db status=500',
  '2026-10-04T10:00:11Z INFO done service=db status=200',
].join('\n');
const lines = parseLog(LOG);

describe('bookmarkReport', () => {
  it('lists the bookmarked lines with times, pauses and notes', () => {
    const report = bookmarkReport(
      [
        { line: 5, note: 'second failure' },
        { line: 2, note: 'it starts here' },
        { line: 3, note: '' },
      ],
      lines,
      { title: 'app.log', url: 'https://ci.example/run/42/log', timeMode: 'utc' },
    );
    expect(report).toBe(
      [
        '### app.log',
        '',
        '- **[L2](https://ci.example/run/42/log#L2)** · 2026-10-04 10:00:05.000Z — it starts here',
        '  ```',
        '  2026-10-04T10:00:05Z ERROR request 7781 failed service=api status=502',
        '  ```',
        '- **[L3](https://ci.example/run/42/log#L3)** · 2026-10-04 10:00:05.000Z (+0ms)',
        '  ```',
        '  \tat com.example.Client.call(Client.java:88)',
        '  ```',
        '- **[L5](https://ci.example/run/42/log#L5)** · 2026-10-04 10:00:09.000Z (+4.0s) — second failure',
        '  ```',
        '  2026-10-04T10:00:09Z ERROR request 7782 failed service=api status=502',
        '  ```',
      ].join('\n'),
    );
  });

  it('works without links and masks secrets', () => {
    const report = bookmarkReport([{ line: 1, note: '' }], parseLog('INFO password=hunter2hunter2'), {
      title: 'Pasted log',
      url: '',
      timeMode: 'utc',
      mask: (text) => text.replace('hunter2hunter2', '********'),
    });
    expect(report).toContain('- **L1**');
    expect(report).toContain('password=********');
  });
});

describe('fieldStats', () => {
  it('counts the values of a field over entries', () => {
    expect(fieldStats(lines, 'status')).toEqual({
      values: [
        { value: '200', count: 2 },
        { value: '502', count: 2 },
        { value: '500', count: 1 },
      ],
      total: 5,
    });
    expect(fieldStats(lines, 'service', 1).values).toEqual([{ value: 'api', count: 3 }]);
  });

  it('lists a line’s fields', () => {
    expect(lineFields(lines[0])).toEqual(['service', 'status']);
    expect(lineFields(parseLog('[pod/a-1/app] INFO x=1')[0])).toEqual(['x', 'pod']);
  });
});

describe('groupErrors', () => {
  it('groups the same error with the same stack', () => {
    const groups = groupErrors(lines);
    expect(groups.map((g) => [g.count, g.lines])).toEqual([
      [2, [2, 5]],
      [1, [8]],
    ]);
    expect(groups[0].sample).toBe('2026-10-04T10:00:05Z ERROR request 7781 failed service=api status=502');
    expect(groups[0].last! - groups[0].first!).toBe(4000);
  });

  it('keeps errors with different stacks apart and lists their pods', () => {
    const log = parseLog(
      [
        '[pod/a-1/app] ERROR boom',
        '[pod/a-1/app] \tat X.one(X.java:1)',
        '[pod/b-1/app] ERROR boom',
        '[pod/b-1/app] \tat X.one(X.java:1)',
        '[pod/b-1/app] ERROR boom',
        '[pod/b-1/app] \tat Y.two(Y.java:2)',
      ].join('\n'),
    );
    const groups = groupErrors(log);
    expect(groups.map((g) => g.count)).toEqual([2, 1]);
    expect(groups[0].sources).toEqual(['a-1/app', 'b-1/app']);
  });
});

describe('time zones', () => {
  it('formats in UTC or local time', () => {
    const ms = Date.UTC(2026, 9, 4, 10, 0, 5, 120);
    expect(formatTime(ms, 'utc')).toBe('2026-10-04 10:00:05.120Z');
    // the tests run in UTC (see vitest.config), where local equals UTC with a +00:00 offset
    expect(formatTime(ms, 'local')).toMatch(/^2026-10-04 \d\d:00:05\.120[+-]\d\d:\d\d$/);
  });

  it('shows zoned timestamps in local time and leaves the rest', () => {
    const local = localizeTimestamp('2026-10-04T10:00:05.123456Z INFO x', 'local');
    expect(local).toMatch(/^2026-10-04 \d\d:00:05\.123[+-]\d\d:\d\d INFO x$/);
    expect(localizeTimestamp('2026-10-04 10:00:05 INFO no zone', 'local')).toBe('2026-10-04 10:00:05 INFO no zone');
    expect(localizeTimestamp('2026-10-04T10:00:05Z INFO x', 'utc')).toBe('2026-10-04T10:00:05Z INFO x');
    expect(localizeTimestamp('at 2026-10-04T12:00:00+0200 ok', 'local')).toMatch(/^at 2026-10-04 \d\d:00:00\.000/);
  });
});

describe('JSON table', () => {
  const json = parseLog(
    [
      '{"@timestamp":"2026-10-04T10:00:00Z","level":"INFO","logger":"api","message":"ok","traceId":"abc"}',
      '{"@timestamp":"2026-10-04T10:00:01Z","level":"ERROR","logger":"db","message":"down","retries":3}',
    ].join('\n'),
  );

  it('picks time, level, service and message columns', () => {
    expect(isMostlyJson(json)).toBe(true);
    expect(isMostlyJson(lines)).toBe(false);
    expect(defaultColumns(json)).toEqual(['@timestamp', 'level', 'logger', 'message']);
  });

  it('puts the other fields into the last cell', () => {
    expect(tableCells(json[1], ['level', 'message'])).toEqual({
      cells: ['ERROR', 'down'],
      rest: '@timestamp=2026-10-04T10:00:01Z logger=db retries=3',
    });
  });
});

describe('appendedText', () => {
  it('returns whole new lines and keeps a partial one for later', () => {
    expect(appendedText('a\n', 'a\nb\nc')).toEqual({ added: 'b\n', consumed: 4 });
    expect(appendedText('a\n', 'a\n')).toEqual({ added: '', consumed: 2 });
    expect(appendedText('a\nb\n', 'x\n')).toBeNull();
  });
});
