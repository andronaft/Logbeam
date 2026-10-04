import { describe, expect, it } from 'vitest';
import {
  RawNumber,
  canonicalJson,
  changedRange,
  changedSpans,
  diffJson,
  diffLines,
  normalizeLogLine,
  parseJsonDocument,
  previewJson,
} from '../src/lib/diff';

/** Renders a diff the way `diff -u` would, without headers. */
function unified(left: string[], right: string[]): string[] {
  return diffLines(left, right).ops.map((op) =>
    op.kind === 'same' ? ` ${left[op.left!]}` : op.kind === 'del' ? `-${left[op.left!]}` : `+${right[op.right!]}`,
  );
}

describe('diffLines', () => {
  it('finds the smallest set of changes', () => {
    expect(unified(['a', 'b', 'c', 'a', 'b', 'b', 'a'], ['c', 'b', 'a', 'b', 'a', 'c'])).toHaveLength(9);
    const result = diffLines(['a', 'b', 'c', 'a', 'b', 'b', 'a'], ['c', 'b', 'a', 'b', 'a', 'c']);
    expect(result.added + result.removed).toBe(5);
  });

  it('keeps unchanged lines and marks added and removed ones', () => {
    expect(unified(['one', 'two', 'three'], ['one', 'TWO', 'three', 'four'])).toEqual([
      ' one',
      '-two',
      '+TWO',
      ' three',
      '+four',
    ]);
  });

  it('handles empty sides', () => {
    expect(unified([], ['a'])).toEqual(['+a']);
    expect(unified(['a'], [])).toEqual(['-a']);
    expect(diffLines([], []).ops).toEqual([]);
  });

  it('every line of both sides appears exactly once, in order', () => {
    const left = Array.from({ length: 300 }, (_, i) => `line ${i % 37}`);
    const right = Array.from({ length: 280 }, (_, i) => `line ${(i * 7) % 41}`);
    const { ops } = diffLines(left, right);
    expect(ops.filter((op) => op.left !== undefined).map((op) => op.left)).toEqual(left.map((_, i) => i));
    expect(ops.filter((op) => op.right !== undefined).map((op) => op.right)).toEqual(right.map((_, i) => i));
    for (const op of ops) if (op.kind === 'same') expect(left[op.left!]).toBe(right[op.right!]);
  });

  it('falls back to replacing the middle when the texts are too different', () => {
    const left = Array.from({ length: 50 }, (_, i) => `a${i}`);
    const right = Array.from({ length: 50 }, (_, i) => `b${i}`);
    const result = diffLines(['head', ...left, 'tail'], ['head', ...right, 'tail'], 10);
    expect(result.approximate).toBe(true);
    expect(result.removed).toBe(50);
    expect(result.added).toBe(50);
    expect(result.ops[0]).toEqual({ kind: 'same', left: 0, right: 0 });
  });

  it('is fast on big logs with few changes', () => {
    const left = Array.from({ length: 100_000 }, (_, i) => `INFO processed job ${i}`);
    const right = [...left];
    right[50_000] = 'ERROR job 50000 failed';
    right.splice(70_000, 0, 'WARN retrying');
    const started = Date.now();
    const result = diffLines(left, right);
    expect(Date.now() - started).toBeLessThan(1000);
    expect([result.added, result.removed]).toEqual([2, 1]);
  });
});

describe('changedRange', () => {
  it('finds the part of a line that changed', () => {
    expect(changedRange('timeout after 30s', 'timeout after 45s')).toEqual({ before: [14, 16], after: [14, 16] });
    expect(changedRange('abc', 'abXc')).toEqual({ before: [2, 2], after: [2, 3] });
  });
});

describe('changedSpans', () => {
  it('marks the words that changed', () => {
    expect(changedSpans('Tests: 120 passed', 'Tests: 119 passed, 1 failed')).toEqual({
      before: [[7, 10]],
      after: [
        [7, 10],
        [17, 27],
      ],
    });
  });

  it('skips words that only differ by what the key hides', () => {
    const spans = changedSpans(
      '2026-10-03T09:00:20.000Z Tests: 120 passed',
      '2026-10-04T11:30:20.000Z Tests: 121 passed',
      normalizeLogLine,
    );
    expect(spans).toEqual({ before: [[32, 35]], after: [[32, 35]] });
  });
});

describe('normalizeLogLine', () => {
  it('hides timestamps, IDs and durations', () => {
    expect(normalizeLogLine('2026-10-04T10:00:00.1234567Z Step finished in 3.2s (run 9f8e7d6c5b4a3f2e)')).toBe(
      '<time> Step finished in <duration> (run <id>)',
    );
    expect(normalizeLogLine('12:00:01 request 550e8400-e29b-41d4-a716-446655440000 took 120ms')).toBe(
      '<time> request <id> took <duration>',
    );
    expect(normalizeLogLine('1727000000 started')).toBe('<time> started');
  });

  it('keeps numbers that matter', () => {
    expect(normalizeLogLine('exit code 137, 3 tests failed')).toBe('exit code 137, 3 tests failed');
  });
});

describe('diffJson', () => {
  it('lists changes by path and ignores key order', () => {
    const before = { service: 'payments', replicas: 3, env: { LOG_LEVEL: 'info', REGION: 'eu' }, ports: [80, 443] };
    const after = { ports: [80, 8443, 9090], env: { REGION: 'eu', LOG_LEVEL: 'debug' }, service: 'payments', debug: true };
    expect(diffJson(before, after)).toEqual([
      { path: '$.replicas', kind: 'removed', before: 3 },
      { path: '$.env.LOG_LEVEL', kind: 'changed', before: 'info', after: 'debug' },
      { path: '$.ports[1]', kind: 'changed', before: 443, after: 8443 },
      { path: '$.ports[2]', kind: 'added', after: 9090 },
      { path: '$.debug', kind: 'added', after: true },
    ]);
    expect(diffJson({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toEqual([]);
  });

  it('quotes keys that are not identifiers', () => {
    expect(diffJson({ 'log.level': 'info' }, { 'log.level': 'warn' })[0].path).toBe('$["log.level"]');
  });

  it('notices a change in a number too big for a double', () => {
    const before = parseJsonDocument('{"id": 12345678901234567890}');
    const after = parseJsonDocument('{"id": 12345678901234567891}');
    const supported = (before as { id: unknown }).id instanceof RawNumber;
    // engines without JSON.parse source access (older Node and Chrome) can't tell them apart
    expect(diffJson(before, after)).toHaveLength(supported ? 1 : 0);
  });
});

describe('JSON helpers', () => {
  it('parses only objects and arrays', () => {
    expect(parseJsonDocument(' {"a": 1} ')).toEqual({ a: 1 });
    expect(parseJsonDocument('[1, 2]')).toEqual([1, 2]);
    expect(parseJsonDocument('42')).toBeNull();
    expect(parseJsonDocument('{oops}')).toBeNull();
  });

  it('pretty-prints with sorted keys', () => {
    expect(canonicalJson({ b: [1, { d: null, c: 'x' }], a: {} })).toBe(
      '{\n  "a": {},\n  "b": [\n    1,\n    {\n      "c": "x",\n      "d": null\n    }\n  ]\n}',
    );
    expect(canonicalJson(new RawNumber('12345678901234567890'))).toBe('12345678901234567890');
  });

  it('previews values on one line', () => {
    expect(previewJson({ b: 1, a: [1, 2] })).toBe('{ "a": [ 1, 2 ], "b": 1 }');
    expect(previewJson('x'.repeat(100), 10)).toBe('"xxxxxxxx…');
  });
});
