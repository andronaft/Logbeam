/**
 * What the log viewer computes about a log besides filtering it: an incident report from bookmarks,
 * the top values of a field, groups of the same error, columns for a JSON table, local times, and the
 * new part of a log that is still being written.
 */
import { fieldValue, plainFields } from './fields';
import { LogLine, formatGap, signature, splitSource } from './logs';

// ---- bookmarks ---------------------------------------------------------------------------

export interface Bookmark {
  /** Line number. */
  line: number;
  note: string;
}

export interface ReportOptions {
  title: string;
  /** The page's address without #L…, for links to lines; empty when there is none (pasted text). */
  url: string;
  timeMode: TimeMode;
  /** Masks secrets in the quoted lines. */
  mask?: (text: string) => string;
}

/**
 * A Markdown summary of the bookmarked lines, to paste into a ticket or a chat: each line with its
 * time, the pause since the previous bookmark and the note.
 */
export function bookmarkReport(bookmarks: Bookmark[], lines: LogLine[], options: ReportOptions): string {
  const sorted = [...bookmarks].sort((a, b) => a.line - b.line);
  const out = [`### ${options.title}`, ''];
  let previousTime: number | null = null;
  for (const bookmark of sorted) {
    const line = lines[bookmark.line - 1];
    if (!line) continue;
    const time = entryTime(lines, bookmark.line - 1);
    const where = options.url ? `[L${line.number}](${options.url}#L${line.number})` : `L${line.number}`;
    const when = time !== null ? ` · ${formatTime(time, options.timeMode)}` : '';
    const after = time !== null && previousTime !== null ? ` (${formatGap(time - previousTime)})` : '';
    if (time !== null) previousTime = time;
    out.push(`- **${where}**${when}${after}${bookmark.note ? ` — ${bookmark.note}` : ''}`);
    const text = options.mask ? options.mask(line.text) : line.text;
    out.push('  ```', `  ${text.length > 500 ? `${text.slice(0, 500)}…` : text}`, '  ```');
  }
  return out.join('\n');
}

/** The time of the entry a line belongs to (a stack-trace line takes its error's time). */
function entryTime(lines: LogLine[], index: number): number | null {
  for (let i = index; i >= 0; i--) {
    if (lines[i].time !== null) return lines[i].time;
    if (!lines[i].continuation) return null;
  }
  return null;
}

// ---- field statistics --------------------------------------------------------------------

export interface ValueCount {
  value: string;
  count: number;
}

/** The most common values of a field over the given lines (entries only, not stack-trace lines). */
export function fieldStats(lines: LogLine[], key: string, top = 10): { values: ValueCount[]; total: number } {
  const counts = new Map<string, number>();
  let total = 0;
  for (const line of lines) {
    if (line.continuation) continue;
    const value = fieldValue(line, key);
    if (value === undefined) continue;
    total++;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const values = [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, top);
  return { values, total };
}

/** The fields of a line, in the order they appear: JSON keys or key=value pairs. */
export function lineFields(line: LogLine): string[] {
  const keys = line.json ? Object.keys(line.json) : [...plainFields(line.text).keys()];
  if (line.source !== null) keys.push('pod');
  return keys;
}

// ---- grouping errors ---------------------------------------------------------------------

export interface ErrorGroup {
  /** Normalized text of the error and its first stack frames. */
  key: string;
  /** The error line as first seen. */
  sample: string;
  count: number;
  /** Line numbers of each occurrence (the entry's first line). */
  lines: number[];
  sources: string[];
  first: number | null;
  last: number | null;
}

const FRAMES_IN_KEY = 3;

/**
 * Groups ERROR entries that are the same error: the same message once numbers, IDs and times are
 * ignored, and the same first stack frames. Biggest groups first.
 */
export function groupErrors(lines: LogLine[]): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>();
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i];
    if (head.continuation || head.level !== 'ERROR') continue;
    const frames: string[] = [];
    for (let j = i + 1; j < lines.length && lines[j].continuation && frames.length < FRAMES_IN_KEY; j++) {
      frames.push(signature(splitSource(lines[j].text).rest));
    }
    const key = [signature(splitSource(head.text).rest), ...frames].join('\n');
    let group = groups.get(key);
    if (!group) {
      group = { key, sample: splitSource(head.text).rest, count: 0, lines: [], sources: [], first: null, last: null };
      groups.set(key, group);
    }
    group.count++;
    group.lines.push(head.number);
    if (head.source !== null && !group.sources.includes(head.source)) group.sources.push(head.source);
    if (head.time !== null) {
      group.first = group.first === null ? head.time : Math.min(group.first, head.time);
      group.last = group.last === null ? head.time : Math.max(group.last, head.time);
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.lines[0] - b.lines[0]);
}

// ---- time zones --------------------------------------------------------------------------

export type TimeMode = 'utc' | 'local';

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** "2026-10-04 13:00:05.120" in UTC (with a Z) or in the browser's time zone (with its offset). */
export function formatTime(ms: number, mode: TimeMode): string {
  const d = new Date(ms);
  if (mode === 'utc')
    return d
      .toISOString()
      .replace('T', ' ')
      .replace(/\.(\d{3})Z$/, '.$1Z');
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const zone = `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}${zone}`
  );
}

// an ISO timestamp with a zone, so its instant is known: 2026-10-04T10:00:05.120Z, …+02:00
const ZONED_TIMESTAMP = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})(?![\d:])/;

/**
 * Shows the first zoned timestamp of a line in the browser's time zone. Timestamps without a zone
 * are left alone: which zone they were written in isn't known.
 */
export function localizeTimestamp(text: string, mode: TimeMode): string {
  if (mode === 'utc') return text;
  const match = ZONED_TIMESTAMP.exec(text.slice(0, 120));
  if (!match) return text;
  const iso = match[0]
    .replace(' ', 'T')
    .replace(',', '.')
    .replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const ms = Date.parse(iso.replace(/(\.\d{3})\d+/, '$1'));
  if (Number.isNaN(ms)) return text;
  return text.slice(0, match.index) + formatTime(ms, 'local') + text.slice(match.index + match[0].length);
}

// ---- JSON table --------------------------------------------------------------------------

const PREFERRED_COLUMNS = [
  ['@timestamp', 'timestamp', 'time', 'ts'],
  ['level', 'severity', 'lvl'],
  ['service', 'logger', 'app', 'component'],
  ['message', 'msg', 'event'],
];

/** Whether enough of a log is JSON for a table to make sense. */
export function isMostlyJson(lines: LogLine[]): boolean {
  const heads = lines.filter((line) => !line.continuation);
  return heads.length > 0 && heads.filter((line) => line.json).length / heads.length >= 0.5;
}

/** Sensible first columns: time, level, service and message, under whichever names the log uses. */
export function defaultColumns(lines: LogLine[]): string[] {
  const keys = new Set<string>();
  for (const line of lines.slice(0, 200)) if (line.json) for (const key of Object.keys(line.json)) keys.add(key);
  return PREFERRED_COLUMNS.map((names) => names.find((name) => keys.has(name))).filter((k): k is string => !!k);
}

/** The cells of a row; the fields not shown in columns go into the last cell as key=value. */
export function tableCells(line: LogLine, columns: string[]): { cells: string[]; rest: string } {
  const cells = columns.map((column) => fieldValue(line, column) ?? '');
  const rest = line.json
    ? Object.entries(line.json)
        .filter(([key]) => !columns.includes(key))
        .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
        .join(' ')
    : line.text;
  return { cells, rest };
}

// ---- following a growing log -------------------------------------------------------------

/**
 * The part added to a log since it was last read, or null if the log was replaced rather than
 * appended to (rotated, or a different page). A trailing partial line waits for the next read.
 */
export function appendedText(before: string, after: string): { added: string; consumed: number } | null {
  if (after.length < before.length || !after.startsWith(before)) return null;
  const tail = after.slice(before.length);
  const lastNewline = tail.lastIndexOf('\n');
  if (lastNewline < 0) return { added: '', consumed: before.length };
  return { added: tail.slice(0, lastNewline + 1), consumed: before.length + lastNewline + 1 };
}
