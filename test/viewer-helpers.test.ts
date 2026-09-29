import { describe, expect, it } from 'vitest';
import { parseLog } from '../src/lib/logs';
import { searchRanges, toSegments } from '../src/lib/segments';
import { buildTimeline } from '../src/lib/timeline';

describe('toSegments', () => {
  it('returns the plain text without ranges', () => {
    expect(toSegments('hello', [])).toEqual([{ text: 'hello', classes: [] }]);
    expect(toSegments('', [])).toEqual([]);
  });

  it('splits overlapping highlights into segments with all their classes', () => {
    const segments = toSegments('password=hunter22 ok', [
      { start: 9, end: 17, cls: 'secret' },
      { start: 0, end: 12, cls: 'match' },
    ]);
    expect(segments).toEqual([
      { text: 'password=', classes: ['match'] },
      { text: 'hun', classes: ['secret', 'match'] },
      { text: 'ter22', classes: ['secret'] },
      { text: ' ok', classes: [] },
    ]);
  });

  it('ignores empty and out-of-range ranges', () => {
    expect(
      toSegments('abc', [
        { start: 1, end: 1, cls: 'x' },
        { start: 10, end: 12, cls: 'y' },
      ]),
    ).toEqual([{ text: 'abc', classes: [] }]);
  });
});

describe('searchRanges', () => {
  it('finds plain-text and regex matches', () => {
    expect(searchRanges('a.b a.b', 'a.b', false, false)).toHaveLength(2);
    expect(searchRanges('axb a.b', 'a.b', false, false)).toEqual([{ start: 4, end: 7, cls: 'match' }]);
    expect(searchRanges('Error error', 'error', false, true)).toEqual([{ start: 6, end: 11, cls: 'match' }]);
    expect(searchRanges('id=12 id=345', 'id=\\d+', true, false)).toHaveLength(2);
  });

  it('survives invalid and empty-matching regexes', () => {
    expect(searchRanges('abc', '([', true, false)).toEqual([]);
    expect(searchRanges('abc', 'x*', true, false)).toEqual([]);
  });
});

describe('buildTimeline', () => {
  it('counts entries, errors and warnings per time slice', () => {
    const lines = parseLog(
      [
        '2024-03-01 10:00:00 INFO start',
        '2024-03-01 10:00:01 ERROR boom',
        '\tat com.example.Foo.bar(Foo.java:1)',
        '2024-03-01 10:00:09 WARN slow',
        '2024-03-01 10:00:10 ERROR boom again',
      ].join('\n'),
    );
    const timeline = buildTimeline(lines, 2)!;
    expect(timeline.buckets.map((b) => [b.total, b.errors, b.warnings])).toEqual([
      [2, 1, 0],
      [2, 1, 1],
    ]);
    expect(timeline.max).toBe(2);
  });

  it('needs at least two distinct timestamps', () => {
    expect(buildTimeline(parseLog('no times here\nat all'))).toBeNull();
    expect(buildTimeline(parseLog('2024-03-01 10:00:00 INFO a\n2024-03-01 10:00:00 INFO b'))).toBeNull();
  });
});
