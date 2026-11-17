import { describe, expect, it } from 'vitest';
import { parseLog, splitLines, splitSource } from '../src/lib/logs';
import { MergeInput, fileLabels, mergeByTime } from '../src/lib/merge';

/** A file as the viewer reads it before merging: its lines and when each entry starts. */
const file = (name: string, text: string): MergeInput => ({
  name,
  lines: splitLines(text),
  times: parseLog(text).map((line) => (line.continuation ? null : line.time)),
});

const api = file(
  'api.log',
  '2026-10-04 10:00:00 INFO  POST /orders\n2026-10-04 10:00:02 INFO  200 OK\n2026-10-04 10:00:05 WARN  slow\n',
);
const worker = file(
  'worker.log',
  [
    '2026-10-04 10:00:01 INFO  charging order 7',
    '2026-10-04 10:00:03 ERROR charge failed',
    'java.lang.IllegalStateException: card declined',
    '\tat Payments.charge(Payments.java:42)',
    '2026-10-04 10:00:04 INFO  retry scheduled',
  ].join('\n'),
);

describe('mergeByTime', () => {
  it('puts the entries of several files in order of time, each line with its file in front', () => {
    expect(mergeByTime([api, worker]).text.split('\n')).toEqual([
      'api.log    | 2026-10-04 10:00:00 INFO  POST /orders',
      'worker.log | 2026-10-04 10:00:01 INFO  charging order 7',
      'api.log    | 2026-10-04 10:00:02 INFO  200 OK',
      'worker.log | 2026-10-04 10:00:03 ERROR charge failed',
      'worker.log | java.lang.IllegalStateException: card declined',
      'worker.log | \tat Payments.charge(Payments.java:42)',
      'worker.log | 2026-10-04 10:00:04 INFO  retry scheduled',
      'api.log    | 2026-10-04 10:00:05 WARN  slow',
      '',
    ]);
  });

  it('is read back as one log, with each file as a source and the stack trace kept with its error', () => {
    const lines = parseLog(mergeByTime([api, worker]).text);
    expect(lines.map((line) => line.source)).toEqual([
      'api.log',
      'worker.log',
      'api.log',
      'worker.log',
      'worker.log',
      'worker.log',
      'worker.log',
      'api.log',
    ]);
    expect(lines.map((line) => line.level)).toEqual(['INFO', 'INFO', 'INFO', 'ERROR', 'ERROR', 'ERROR', 'INFO', 'WARN']);
    expect(lines[5].continuation).toBe(true);
    // the gaps are between the files' entries now: one second each
    expect(lines.filter((line) => line.gap !== null).map((line) => line.gap)).toEqual([1000, 1000, 1000, 1000, 1000]);
  });

  it("keeps each file's own order, even where its time goes back", () => {
    const late = file('a.log', '2026-10-04 10:00:00 INFO one\n2026-10-04 10:00:09 INFO two\n2026-10-04 10:00:01 INFO three\n');
    const other = file('b.log', '2026-10-04 10:00:05 INFO other\n');
    expect(mergeByTime([late, other]).text).toBe(
      [
        'a.log | 2026-10-04 10:00:00 INFO one',
        'b.log | 2026-10-04 10:00:05 INFO other',
        'a.log | 2026-10-04 10:00:09 INFO two',
        'a.log | 2026-10-04 10:00:01 INFO three',
        '',
      ].join('\n'),
    );
  });

  it('puts the first file first on equal times, and a header right before its first entry', () => {
    const a = file('a.log', '2026-10-04 10:00:05 INFO a\n');
    const b = file('b.log', 'Started by user admin\n2026-10-04 10:00:05 INFO b\n');
    expect(mergeByTime([b, a]).text.split('\n').slice(0, 3)).toEqual([
      'b.log | Started by user admin',
      'b.log | 2026-10-04 10:00:05 INFO b',
      'a.log | 2026-10-04 10:00:05 INFO a',
    ]);
  });

  it('puts a file without timestamps at the end and says so', () => {
    const notes = file('notes.txt', 'just some text\nmore text\n');
    const merged = mergeByTime([notes, api]);
    expect(merged.untimed).toEqual(['notes.txt']);
    expect(merged.text.split('\n').slice(-3)).toEqual(['notes.txt | just some text', 'notes.txt | more text', '']);
    expect(mergeByTime([api, worker]).untimed).toEqual([]);
  });

  it('merges JSON logs with plain ones', () => {
    const json = file('app.json', '{"ts":"2026-10-04T10:00:01Z","level":"error","msg":"boom"}\n');
    const plain = file('web.log', '2026-10-04T10:00:00Z INFO start\n2026-10-04T10:00:02Z INFO end\n');
    const lines = parseLog(mergeByTime([json, plain]).text);
    expect(lines.map((line) => [line.source, line.level])).toEqual([
      ['web.log', 'INFO'],
      ['app.json', 'ERROR'],
      ['web.log', 'INFO'],
    ]);
    expect(lines[1].text).toContain('boom');
  });

  it('keeps a pretty-printed JSON record in one piece', () => {
    const pretty = file('a.log', '{\n  "time": "2026-10-04T10:00:03Z",\n  "level": "warn",\n  "msg": "late"\n}\n');
    const other = file('b.log', '2026-10-04T10:00:01Z INFO first\n2026-10-04T10:00:05Z INFO last\n');
    expect(
      mergeByTime([pretty, other])
        .text.split('\n')
        .map((line) => line.slice(0, 1)),
    ).toEqual(['b', 'a', 'a', 'a', 'a', 'a', 'b', '']);
  });

  it('gives nothing for empty files', () => {
    expect(mergeByTime([file('a.log', ''), file('b.log', '')])).toEqual({ text: '', untimed: ['a.log', 'b.log'] });
  });
});

describe('fileLabels', () => {
  it('names each file the way the viewer reads it back', () => {
    expect(fileLabels(['api.log', 'build', 'my app (prod).txt', 'app.log.gz', '.hidden'])).toEqual([
      'api.log',
      'build.log',
      'my_app_prod_.txt',
      'app.log',
      'hidden.log',
    ]);
  });

  it('tells apart two files of the same name', () => {
    expect(fileLabels(['app.log', 'app.log', 'App.log', 'app-2.log'])).toEqual([
      'app.log',
      'app-2.log',
      'App-3.log',
      'app-2-2.log',
    ]);
  });

  it('reads every label back as the source of its lines', () => {
    for (const label of fileLabels(['api.log', 'build', 'my app (prod).txt', 'x.JSONL', 'svc.ndjson', 'e.err'])) {
      expect(splitSource(`${label} | 2026-10-04 10:00:00 INFO ok`)).toEqual({
        source: label,
        rest: '2026-10-04 10:00:00 INFO ok',
      });
    }
  });
});

describe('the file prefix', () => {
  it('is not found in ordinary lines', () => {
    expect(splitSource('INFO | started').source).toBeNull();
    expect(splitSource('see app.log | grep error').source).toBeNull();
    expect(splitSource('app.log| no space').source).toBeNull();
    expect(splitSource('payments-1  | started').source).toBe('payments-1');
  });
});
