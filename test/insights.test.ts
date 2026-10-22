import { describe, expect, it } from 'vitest';
import {
  appendedText,
  bookmarkReport,
  defaultColumns,
  diffErrors,
  findGroups,
  foldGroups,
  fieldStats,
  formatDuration,
  formatTime,
  groupErrors,
  isMostlyJson,
  lineIds,
  lineFields,
  localizeTimestamp,
  numericStats,
  tableCells,
  traceId,
  quoteCsv,
  toCsv,
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

describe('numericStats', () => {
  const timed = parseLog(
    [
      '{"level":"info","duration":120}',
      '{"level":"info","duration":950}',
      'INFO slow request duration=1.2s',
      'ERROR failed duration=30ms',
      '\tat com.example.Pay.charge(Pay.java:42) duration=99999ms',
      'INFO done duration=5ms',
      'INFO cached duration=40',
    ].join('\n'),
  );

  it('gives min, median, p95, p99 and max of durations in milliseconds', () => {
    expect(numericStats(timed, 'duration')).toEqual({
      count: 6,
      min: 5,
      median: 40,
      p95: 1200,
      p99: 1200,
      max: 1200,
      duration: true,
    });
  });

  it('uses the nearest rank, a value that was really seen', () => {
    const many = parseLog(Array.from({ length: 100 }, (_, i) => `INFO took=${i + 1}`).join('\n'));
    const stats = numericStats(many, 'took')!;
    expect([stats.median, stats.p95, stats.p99, stats.duration]).toEqual([50, 95, 99, false]);
  });

  it('is null for text fields and for a single number', () => {
    expect(numericStats(lines, 'service')).toBeNull();
    expect(numericStats(parseLog('INFO a took=5ms'), 'took')).toBeNull();
    // mostly IDs that look like words: not a number field
    const ids = parseLog(['INFO id=abc', 'INFO id=def', 'INFO id=12', 'INFO id=13', 'INFO id=xyz'].join('\n'));
    expect(numericStats(ids, 'id')).toBeNull();
  });

  it('formats durations the way logs write them', () => {
    expect([0.4, 120, 1200, 1250, 90_000, 7_200_000].map(formatDuration)).toEqual([
      '0.4ms',
      '120ms',
      '1.2s',
      '1.3s',
      '1.5m',
      '2h',
    ]);
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

describe('diffErrors', () => {
  const green = parseLog(
    [
      '2026-10-03T09:00:01Z INFO build 101 started',
      '2026-10-03T09:00:02Z ERROR cache miss for key 9f2c',
      '2026-10-03T09:00:03Z ERROR flaky probe timed out after 3012ms',
      '\tat Probe.check(Probe.java:20)',
      '2026-10-03T09:00:09Z INFO build 101 passed',
    ].join('\n'),
  );
  const red = parseLog(
    [
      '2026-10-04T10:00:01Z INFO build 102 started',
      '2026-10-04T10:00:02Z ERROR cache miss for key 41aa',
      '2026-10-04T10:00:05Z ERROR connection refused to db:5432',
      '\tat Db.connect(Db.java:88)',
      '2026-10-04T10:00:06Z ERROR connection refused to db:5432',
      '\tat Db.connect(Db.java:88)',
      '2026-10-04T10:00:09Z ERROR build 102 failed',
    ].join('\n'),
  );

  it('finds the errors that are new, ignoring times, IDs and numbers', () => {
    const diff = diffErrors(green, red);
    expect(diff.added.map((g) => [g.count, g.lines[0], g.sample])).toEqual([
      [2, 3, '2026-10-04T10:00:05Z ERROR connection refused to db:5432'],
      [1, 7, '2026-10-04T10:00:09Z ERROR build 102 failed'],
    ]);
    expect(diff.same).toBe(1);
  });

  it('lists the errors that are gone', () => {
    expect(diffErrors(green, red).gone.map((g) => g.sample)).toEqual([
      '2026-10-03T09:00:03Z ERROR flaky probe timed out after 3012ms',
    ]);
    expect(diffErrors(red, red)).toEqual({ added: [], gone: [], same: 3 });
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

  it('quotes fields containing commas, double quotes and newlines per RFC 4180', () => {
    expect(quoteCsv('simple')).toBe('simple');
    expect(quoteCsv('a,b')).toBe('"a,b"');
    expect(quoteCsv('he said "ok"')).toBe('"he said ""ok"""');
    expect(quoteCsv('line1\nline2')).toBe('"line1\nline2"');
    expect(quoteCsv('line1\r\nline2')).toBe('"line1\r\nline2"');
    expect(quoteCsv('a, "b"\nc')).toBe('"a, ""b""\nc"');
  });

  it('neutralizes cells a spreadsheet would run as formulas, but keeps numbers', () => {
    expect(quoteCsv('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(['+cmd|calc', '-2+3', '@SUM(A1)', '\tx'].map(quoteCsv)).toEqual(["'+cmd|calc", "'-2+3", "'@SUM(A1)", "'\tx"]);
    expect(['-5', '+1.5', '200', '-'].map(quoteCsv)).toEqual(['-5', '+1.5', '200', "'-"]);
  });

  it('leaves stack-trace lines out of the CSV', () => {
    const logs = parseLog(['{"level":"ERROR","msg":"boom"}', '\tat X.y(X.java:1)'].join('\n'));
    expect(toCsv(logs, ['level', 'msg'])).toBe('level,msg\r\nERROR,boom\r\n');
  });

  it('exports chosen columns as CSV with header', () => {
    const csv = toCsv(json, ['level', 'message']);
    expect(csv).toBe('level,message\r\nINFO,ok\r\nERROR,down\r\n');
  });

  it('masks secrets in CSV values when mask option is provided', () => {
    const logs = parseLog(['{"level":"INFO","key":"secret123456"}'].join('\n'));
    const csv = toCsv(logs, ['level', 'key'], {
      mask: (val) => val.replace('secret123456', '***'),
    });
    expect(csv).toBe('level,key\r\nINFO,***\r\n');
  });
});

describe('appendedText', () => {
  it('returns whole new lines and keeps a partial one for later', () => {
    expect(appendedText('a\n', 'a\nb\nc')).toEqual({ added: 'b\n', consumed: 4 });
    expect(appendedText('a\n', 'a\n')).toEqual({ added: '', consumed: 2 });
    expect(appendedText('a\nb\n', 'x\n')).toBeNull();
  });
});

describe('GitHub Actions groups', () => {
  const log = parseLog(
    [
      '2026-10-04T10:00:00.1000000Z ##[group]Run actions/checkout@v4',
      '2026-10-04T10:00:00.2000000Z with:',
      '2026-10-04T10:00:00.3000000Z   repository: andronaft/Logbeam',
      '2026-10-04T10:00:00.4000000Z ##[endgroup]',
      '2026-10-04T10:00:01.0000000Z Syncing repository: andronaft/Logbeam',
      '2026-10-04T10:00:02.0000000Z ##[group]Run npm test',
      '2026-10-04T10:00:03.0000000Z ERROR 1 test failed',
      '2026-10-04T10:00:04.0000000Z ##[group]Post job cleanup.',
      '2026-10-04T10:00:05.0000000Z ##[error]Process completed with exit code 1.',
      '::group::Local run',
      'output',
    ].join('\n'),
  );

  it('finds the groups, their ends and their errors; a new group ends an unclosed one', () => {
    expect(findGroups(log).map((g) => [g.title, g.start, g.end, g.errors])).toEqual([
      ['Run actions/checkout@v4', 1, 4, 0],
      ['Run npm test', 6, 7, 1],
      ['Post job cleanup.', 8, 9, 1],
      ['Local run', 10, 11, 0],
    ]);
  });

  it('folds closed groups down to their header line', () => {
    const groups = findGroups(log);
    const shown = foldGroups(log, groups, new Set([6])).map((l) => l.number);
    expect(shown).toEqual([1, 5, 6, 7, 8, 10]);
    expect(foldGroups(log, groups, new Set(groups.map((g) => g.start)))).toHaveLength(log.length);
    expect(foldGroups(log, [], new Set())).toBe(log);
  });
});

describe('following one request', () => {
  const log = parseLog(
    [
      '[pod/api-1/app] 2026-10-04T10:00:00Z INFO GET /orders/7781 traceId=4bf92f3577b34da6a3ce929d0e0e4736 userId=42',
      '[pod/payments-2/app] 2026-10-04T10:00:01Z WARN charge slow trace_id=4bf92f3577b34da6a3ce929d0e0e4736 took=900ms',
      '[pod/payments-2/app] 2026-10-04T10:00:03Z ERROR charge failed for 4bf92f3577b34da6a3ce929d0e0e4736',
      '\tat Pay.charge(Pay.java:42)',
      '[pod/api-1/app] 2026-10-04T10:00:04Z INFO GET /orders/1420 traceId=00f067aa0ba902b7aaaaaaaaaaaaaaaa userId=1420',
      '{"time":"2026-10-04T10:00:05Z","level":"info","msg":"done","request_id":"550e8400-e29b-41d4-a716-446655440000"}',
    ].join('\n'),
  );

  it('finds ID fields, UUIDs and trace IDs in a line', () => {
    expect(lineIds(log[0])).toEqual([
      { key: 'traceId', value: '4bf92f3577b34da6a3ce929d0e0e4736' },
      { key: 'userId', value: '42' },
    ]);
    expect(lineIds(log[2])).toEqual([{ key: 'trace', value: '4bf92f3577b34da6a3ce929d0e0e4736' }]);
    expect(lineIds(log[5])).toEqual([{ key: 'request_id', value: '550e8400-e29b-41d4-a716-446655440000' }]);
    expect(lineIds(log[3])).toEqual([]);
  });

  it('traces an ID across pods, as whole tokens only', () => {
    expect(traceId(log, '4bf92f3577b34da6a3ce929d0e0e4736')).toEqual({
      entries: 3,
      sources: ['api-1/app', 'payments-2/app'],
      first: Date.UTC(2026, 9, 4, 10, 0, 0),
      last: Date.UTC(2026, 9, 4, 10, 0, 3),
    });
    // userId=42 must not match /orders/1420 or Pay.java:42 in a stack frame
    expect(traceId(log, '42').entries).toBe(1);
  });
});
