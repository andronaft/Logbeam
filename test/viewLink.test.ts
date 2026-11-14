import { describe, expect, it } from 'vitest';
import { EMPTY_VIEW, ViewLink, formatViewLink, parseViewLink } from '../src/lib/viewLink';

const view = (changes: Partial<ViewLink>): ViewLink => ({ ...EMPTY_VIEW, ...changes });

describe('parseViewLink', () => {
  it('reads the #L120 links of older versions', () => {
    expect(parseViewLink('#L120')).toEqual(view({ line: 120 }));
  });

  it('reads a range of lines, in either order and with or without the second L', () => {
    expect(parseViewLink('#L120-L135')).toEqual(view({ line: 120, lineEnd: 135 }));
    expect(parseViewLink('#L135-L120')).toEqual(view({ line: 120, lineEnd: 135 }));
    expect(parseViewLink('#L2-5')).toEqual(view({ line: 2, lineEnd: 5 }));
    expect(parseViewLink('#L7-L7')).toEqual(view({ line: 7 }));
  });

  it('reads a line with filters', () => {
    expect(parseViewLink('#L120&levels=ERROR,WARN&q=payments&re=1&case=1')).toEqual(
      view({ line: 120, levels: ['ERROR', 'WARN'], query: 'payments', regex: true, caseSensitive: true }),
    );
  });

  it('reads filters without a line', () => {
    expect(parseViewLink('#q=level=error%20service=payments')).toEqual(view({ query: 'level=error service=payments' }));
    expect(parseViewLink('#levels=error,other')).toEqual(view({ levels: ['ERROR', 'OTHER'] }));
  });

  it('keeps "no level shown" apart from "all levels shown"', () => {
    expect(parseViewLink('#levels=')?.levels).toEqual([]);
    expect(parseViewLink('#q=x')?.levels).toBeNull();
  });

  it('reads a time range only when both ends are there and in order', () => {
    expect(parseViewLink('#from=1700000000000&to=1700000600000')?.timeRange).toEqual([1700000000000, 1700000600000]);
    expect(parseViewLink('#from=1700000000000')?.timeRange).toBeNull();
    expect(parseViewLink('#from=1700000600000&to=1700000000000')?.timeRange).toBeNull();
    expect(parseViewLink('#from=yesterday&to=1700000600000')?.timeRange).toBeNull();
  });

  it('reads shown and hidden pods, with names that need encoding', () => {
    expect(parseViewLink('#pods=pod/api-6f9c/app,web-1')?.pods).toEqual(['pod/api-6f9c/app', 'web-1']);
    expect(parseViewLink('#hide=a%2Cb,c%20d')?.hiddenPods).toEqual(['a,b', 'c d']);
    expect(parseViewLink('#pods=')?.pods).toEqual([]);
  });

  it("leaves a page's own anchors alone", () => {
    expect(parseViewLink('')).toBeNull();
    expect(parseViewLink('#')).toBeNull();
    expect(parseViewLink('#installation')).toBeNull();
    expect(parseViewLink('#step:5:12')).toBeNull();
    expect(parseViewLink('#L12abc')).toBeNull();
    expect(parseViewLink('#tab=logs')).toBeNull();
    expect(parseViewLink('#L5&nonsense')).toBeNull();
  });

  it('skips keys from a newer version and keeps the rest', () => {
    expect(parseViewLink('#L5&colour=blue&q=x')).toEqual(view({ line: 5, query: 'x' }));
  });

  it('ignores line 0 and survives a broken percent sign', () => {
    expect(parseViewLink('#L0')).toEqual(view({}));
    expect(parseViewLink('#q=100%')?.query).toBe('100%');
  });
});

describe('formatViewLink', () => {
  it('writes nothing when there is nothing to keep', () => {
    expect(formatViewLink(EMPTY_VIEW)).toBe('');
  });

  it('writes lines the way older versions read them', () => {
    expect(formatViewLink(view({ line: 120 }))).toBe('#L120');
    expect(formatViewLink(view({ line: 135, lineEnd: 120 }))).toBe('#L120-L135');
    expect(formatViewLink(view({ line: 7, lineEnd: 7 }))).toBe('#L7');
  });

  it('keeps field filters readable', () => {
    expect(formatViewLink(view({ query: 'level=error service=payments' }))).toBe('#q=level=error%20service=payments');
  });

  it('encodes what would cut the link short in a chat or in Markdown', () => {
    expect(formatViewLink(view({ query: "it's (a+b)*c & d#e!" }))).toBe('#q=it%27s%20%28a%2Bb%29%2Ac%20%26%20d%23e%21');
  });

  it('writes regex and case only with a search', () => {
    expect(formatViewLink(view({ regex: true, caseSensitive: true }))).toBe('');
    expect(formatViewLink(view({ query: 'x', regex: true, caseSensitive: true }))).toBe('#q=x&re=1&case=1');
  });

  it('writes the shown pods, or the hidden ones', () => {
    expect(formatViewLink(view({ pods: ['pod/api-6f9c/app'] }))).toBe('#pods=pod/api-6f9c/app');
    expect(formatViewLink(view({ hiddenPods: ['web-1', 'a,b'] }))).toBe('#hide=web-1,a%2Cb');
    expect(formatViewLink(view({ hiddenPods: [] }))).toBe('');
  });

  it('does not fail on half of an emoji', () => {
    expect(formatViewLink(view({ query: 'a\ud83d' }))).toBe('#q=a%EF%BF%BD');
  });

  it('round-trips a full view', () => {
    const full = view({
      line: 12,
      lineEnd: 40,
      levels: ['ERROR', 'WARN', 'OTHER'],
      query: 'user "anna" <admin> 100% ok, yes=no & більше',
      regex: true,
      caseSensitive: true,
      timeRange: [1700000000000, 1700000600000],
      pods: ['pod/payments-7d9f8-x2k4p/app', 'weird,name & co'],
    });
    const hash = formatViewLink(full);
    expect(hash).not.toMatch(/[\s"<>()']/);
    expect(parseViewLink(hash)).toEqual(full);
    // a browser hands the hash back as it was written
    expect(formatViewLink(parseViewLink(hash)!)).toBe(hash);
  });
});
