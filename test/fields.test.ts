import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { commonFields, filterByFields, numericValue, parseFieldQuery, plainFields } from '../src/lib/fields';
import { displayName, readLogFile } from '../src/lib/files';
import { parseLog, splitSource } from '../src/lib/logs';

describe('parseFieldQuery', () => {
  it('reads conditions', () => {
    expect(parseFieldQuery('level=error service="payment api" duration>500')).toEqual([
      { key: 'level', op: '=', value: 'error' },
      { key: 'service', op: '=', value: 'payment api' },
      { key: 'duration', op: '>', value: '500' },
    ]);
    expect(parseFieldQuery('status!=200 http.status>=500 log.level<=warn')).toHaveLength(3);
  });

  it('leaves ordinary searches alone', () => {
    expect(parseFieldQuery('timeout after 30s')).toBeNull();
    expect(parseFieldQuery('a=b and more')).toBeNull();
    expect(parseFieldQuery('')).toBeNull();
    expect(parseFieldQuery('=5')).toBeNull();
  });
});

describe('field values', () => {
  it('reads key=value pairs from plain lines', () => {
    const fields = plainFields('INFO request method=GET path="/api/orders?id=1" status=500,took=12ms');
    expect(Object.fromEntries(fields)).toEqual({ method: 'GET', path: '/api/orders?id=1', status: '500', took: '12ms' });
  });

  it('understands units', () => {
    expect(numericValue('1.5s')).toBe(1500);
    expect(numericValue('250ms')).toBe(250);
    expect(numericValue('42')).toBe(42);
    expect(numericValue('fast')).toBeNaN();
  });
});

describe('filterByFields', () => {
  const log = [
    '{"level":"info","service":"payments","duration":120,"http":{"status":200},"msg":"ok"}',
    '{"level":"error","service":"payments","duration":950,"http":{"status":502},"msg":"upstream failed"}',
    '{"level":"error","service":"search","duration":40,"http":{"status":500},"msg":"boom"}',
    '2026-10-04 10:00:00 WARN slow request service=payments duration=1.2s status=200',
    '2026-10-04 10:00:01 ERROR failed service=payments duration=30ms status=503',
    '\tat com.example.Pay.charge(Pay.java:42)',
  ].join('\n');
  const lines = parseLog(log);
  const run = (query: string) => filterByFields(lines, parseFieldQuery(query)!).map((line) => line.number);

  it('matches JSON and plain lines the same way', () => {
    expect(run('level=error service=payments')).toEqual([2, 5, 6]);
    expect(run('duration>500')).toEqual([2, 4]);
    expect(run('http.status>=500')).toEqual([2, 3]);
    expect(run('status>=500')).toEqual([5, 6]);
  });

  it('supports != and wildcards', () => {
    expect(run('service!=payments')).toEqual([3]);
    expect(run('service=pay*')).toEqual([1, 2, 4, 5, 6]);
  });

  it('matches levels without a level field and by alias', () => {
    expect(run('level=warning')).toEqual([4]);
    expect(run('level=err')).toEqual([2, 3, 5, 6]);
  });

  it('suggests the common fields', () => {
    expect(commonFields(lines).slice(0, 3)).toEqual(['service', 'duration', 'level']);
  });
});

describe('pods and containers', () => {
  it('reads kubectl and docker compose prefixes', () => {
    expect(splitSource('[pod/payments-7d9f8-x2k4p/app] 2026-10-04 10:00:00 ERROR boom')).toEqual({
      source: 'payments-7d9f8-x2k4p/app',
      rest: '2026-10-04 10:00:00 ERROR boom',
    });
    expect(splitSource('web-1  | GET / 200').source).toBe('web-1');
    expect(splitSource('INFO | not a container').source).toBeNull();
  });

  it('parses the line after the prefix', () => {
    const [line, frame] = parseLog(
      '[pod/api-1/app] 2026-10-04 10:00:00 ERROR boom\n[pod/api-1/app] \tat com.example.Api.run(Api.java:1)',
    );
    expect(line).toMatchObject({ source: 'api-1/app', level: 'ERROR', text: '[pod/api-1/app] 2026-10-04 10:00:00 ERROR boom' });
    expect(line.time).not.toBeNull();
    expect(frame).toMatchObject({ continuation: true, level: 'ERROR' });
  });

  it('filters by pod', () => {
    const lines = parseLog('[pod/a-1/app] INFO one\n[pod/b-1/app] INFO two');
    expect(filterByFields(lines, parseFieldQuery('pod=b-*')!).map((line) => line.number)).toEqual([2]);
  });
});

describe('readLogFile', () => {
  it('reads plain and gzipped files', async () => {
    const text = '2026-10-04 10:00:00 INFO hello ✓\n';
    expect(await readLogFile(new Blob([text]))).toBe(text);
    expect(await readLogFile(new Blob([gzipSync(text)]))).toBe(text);
    expect(displayName('app.log.gz')).toBe('app.log');
  });
});
