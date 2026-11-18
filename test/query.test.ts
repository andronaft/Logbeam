import { describe, expect, it } from 'vitest';
import { excludeWords, filterByFields, parseQuery } from '../src/lib/fields';
import { filterLines, LEVELS, parseLog } from '../src/lib/logs';

describe('parseQuery', () => {
  it('reads fields, words to leave out and text together', () => {
    expect(parseQuery('service=payments timeout -healthz -"connection reset"')).toEqual({
      conditions: [{ key: 'service', op: '=', value: 'payments' }],
      exclude: ['healthz', 'connection reset'],
      text: 'timeout',
    });
  });

  it('keeps a plain search as typed', () => {
    expect(parseQuery('timeout  after 30s')).toEqual({ conditions: [], exclude: [], text: 'timeout  after 30s' });
  });

  it('takes -5, --verbose and a lone - as text', () => {
    expect(parseQuery('retry -5').exclude).toEqual([]);
    expect(parseQuery('--verbose').text).toBe('--verbose');
    expect(parseQuery('a - b').exclude).toEqual([]);
  });
});

describe('a mixed search in the viewer', () => {
  const lines = parseLog(
    [
      '10:00:01 INFO  service=payments GET /healthz 200',
      '10:00:02 ERROR service=payments charge timeout order=7',
      'java.lang.IllegalStateException: card declined',
      '\tat Payments.charge(Payments.java:42)',
      '10:00:03 ERROR service=orders timeout',
      '10:00:04 WARN  service=payments slow timeout on /healthz',
    ].join('\n'),
  );

  it('narrows by field, leaves out the words and finds the text', () => {
    const query = parseQuery('service=payments timeout -healthz');
    const base = excludeWords(filterByFields(lines, query.conditions), query.exclude, false);
    const shown = filterLines(base, {
      levels: new Set(LEVELS),
      includeUnknown: true,
      query: query.text,
      regex: false,
      caseSensitive: false,
    });
    expect(shown.map((line) => line.number)).toEqual([2]);
  });

  it('leaves out an error with its stack trace', () => {
    expect(excludeWords(lines, ['charge timeout'], false).map((line) => line.number)).toEqual([1, 5, 6]);
  });

  it('follows the case switch', () => {
    expect(excludeWords(lines, ['HEALTHZ'], true)).toHaveLength(6);
    expect(excludeWords(lines, ['HEALTHZ'], false)).toHaveLength(4);
  });
});
