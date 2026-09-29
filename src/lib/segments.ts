export interface Range {
  start: number;
  end: number;
  cls: string;
}

export interface Segment {
  text: string;
  classes: string[];
}

/**
 * Splits text into segments so overlapping highlights (a search match inside a secret, say)
 * can each be rendered as a span carrying every class that covers it.
 */
export function toSegments(text: string, ranges: Range[]): Segment[] {
  const valid = ranges.filter((r) => r.end > r.start && r.start < text.length);
  if (valid.length === 0) {
    return text ? [{ text, classes: [] }] : [];
  }
  const points = new Set<number>([0, text.length]);
  for (const r of valid) {
    points.add(Math.max(0, r.start));
    points.add(Math.min(text.length, r.end));
  }
  const sorted = [...points].sort((a, b) => a - b);
  const segments: Segment[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i];
    const to = sorted[i + 1];
    if (from === to) continue;
    const classes = valid.filter((r) => r.start <= from && r.end >= to).map((r) => r.cls);
    const last = segments[segments.length - 1];
    if (last && last.classes.join() === classes.join()) {
      last.text += text.slice(from, to);
    } else {
      segments.push({ text: text.slice(from, to), classes: [...new Set(classes)] });
    }
  }
  return segments;
}

/** Ranges of search matches; an invalid regex or empty query gives none. */
export function searchRanges(text: string, query: string, regex: boolean, caseSensitive: boolean, cls = 'match'): Range[] {
  if (!query) return [];
  let re: RegExp;
  try {
    const source = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(source, caseSensitive ? 'g' : 'gi');
  } catch {
    return [];
  }
  const ranges: Range[] = [];
  for (const match of text.matchAll(re)) {
    if (match[0].length === 0) break; // /x*/ would otherwise loop forever
    const start = match.index ?? 0;
    ranges.push({ start, end: start + match[0].length, cls });
  }
  return ranges;
}
