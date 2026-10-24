/** The log viewer's state, options and fixed sizes, shared by its parts. */
import { TimeMode } from '../lib/insights';
import { Level, LogLine, ParseOptions } from '../lib/logs';
import { ViewPrefs } from '../shared/settings';

export const ROW_HEIGHT = 20;
export const OVERSCAN = 30;
/** Pods with their own chip and colour; more than this and the chips would fill the screen. */
export const MAX_SOURCES = 24;
export const MAX_HIGHLIGHTS = 5;
export const LINE_HASH = /^#L(\d+)$/;
/** Highlighting only looks at the start of very long lines (a minified bundle, say); rows don't wrap anyway. */
export const HIGHLIGHT_LIMIT = 5000;

export interface State {
  levels: Set<Level>;
  includeUnknown: boolean;
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  context: number;
  collapse: boolean;
  showGaps: boolean;
  maskSecrets: boolean;
  showTimeline: boolean;
  /** Why the current search can't run (invalid or too slow regex); empty when it's fine. */
  searchError: string;
  selected: number | null;
  /** Only entries in this time range, chosen by dragging across the timeline. */
  timeRange: [number, number] | null;
  /** Pods or containers switched off with their chips. */
  hiddenSources: Set<string>;
  /** Terms pinned with their own colour, independent of the search. */
  highlights: string[];
  /** Bookmarked line numbers and their notes. */
  bookmarks: Map<number, string>;
  timeMode: TimeMode;
  /** Only the entries of this error group (see Groups). */
  group: { key: string; lines: Set<number>; label: string } | null;
  /** JSON records as a table with these columns. */
  table: string[] | null;
}

/** How often Follow reads the page again. */
export const FOLLOW_INTERVAL_MS = 3000;

export interface ViewerOptions {
  text: string;
  title: string;
  gapThreshold: number;
  timeMode: TimeMode;
  view: ViewPrefs;
  parseOptions: ParseOptions;
  signal: AbortSignal;
}

/**
 * The time of the entry each line belongs to: continuation lines and lines without a timestamp
 * take the time of the entry above, so a time range keeps whole stack traces.
 */
export function entryTimes(lines: LogLine[]): Float64Array {
  const times = new Float64Array(lines.length);
  let current = Number.NaN;
  lines.forEach((line, i) => {
    if (line.time !== null) current = line.time;
    times[i] = current;
  });
  return times;
}
