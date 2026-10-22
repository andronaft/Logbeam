/**
 * What the log viewer computes about a log besides filtering it: an incident report from bookmarks,
 * the top values of a field, groups of the same error (and which are new since another log), columns
 * for a JSON table, local times, and the new part of a log that is still being written.
 */
import { fieldValue, numericValue, plainFields } from './fields';
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

export interface NumericStats {
  /** Entries with a number in this field. */
  count: number;
  min: number;
  median: number;
  p95: number;
  p99: number;
  max: number;
  /** Some values had a time unit (250ms, 1.2s): the numbers are milliseconds. */
  duration: boolean;
}

/** Below this share of numeric values a field is treated as text (an ID that is sometimes a number). */
const NUMERIC_SHARE = 0.8;

/**
 * Min, median, p95, p99 and max of a field whose values are numbers or durations (took=154ms,
 * "duration": 950), over the given entries; null for a text field or fewer than 2 numbers.
 */
export function numericStats(lines: LogLine[], key: string): NumericStats | null {
  const numbers: number[] = [];
  let total = 0;
  let duration = false;
  for (const line of lines) {
    if (line.continuation) continue;
    const value = fieldValue(line, key);
    if (value === undefined) continue;
    total++;
    const number = numericValue(value);
    if (Number.isNaN(number)) continue;
    numbers.push(number);
    if (/[a-zµ]$/i.test(value.trim())) duration = true;
  }
  if (numbers.length < 2 || numbers.length < total * NUMERIC_SHARE) return null;
  numbers.sort((a, b) => a - b);
  // nearest rank: p95 is a value that was really seen, at or above 95% of them
  const rank = (p: number) => numbers[Math.min(numbers.length - 1, Math.ceil(p * numbers.length) - 1)];
  return {
    count: numbers.length,
    min: numbers[0],
    median: rank(0.5),
    p95: rank(0.95),
    p99: rank(0.99),
    max: numbers[numbers.length - 1],
    duration,
  };
}

/** A duration in milliseconds as people write it in logs: 0.4ms, 120ms, 1.2s, 3.5m. */
export function formatDuration(ms: number): string {
  const round = (n: number) => String(Math.round(n * 10) / 10);
  if (Math.abs(ms) < 1) return `${Math.round(ms * 1000) / 1000}ms`;
  if (Math.abs(ms) < 1000) return `${round(ms)}ms`;
  if (Math.abs(ms) < 60_000) return `${round(ms / 1000)}s`;
  if (Math.abs(ms) < 3_600_000) return `${round(ms / 60_000)}m`;
  return `${round(ms / 3_600_000)}h`;
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

export interface ErrorDiff {
  /** Errors in the second log that the first one doesn't have. */
  added: ErrorGroup[];
  /** Errors of the first log that are gone in the second. */
  gone: ErrorGroup[];
  /** Kinds of error in the second log that the first one had too. */
  same: number;
}

/**
 * What went wrong this time that didn't before: the error groups of two logs, e.g. the last green
 * CI run and the failing one, matched by message and first stack frames with numbers, IDs and times
 * ignored, so two runs of the same job give the same groups.
 */
export function diffErrors(before: LogLine[], after: LogLine[]): ErrorDiff {
  const beforeGroups = groupErrors(before);
  const afterGroups = groupErrors(after);
  const beforeKeys = new Set(beforeGroups.map((g) => g.key));
  const afterKeys = new Set(afterGroups.map((g) => g.key));
  const added = afterGroups.filter((g) => !beforeKeys.has(g.key));
  return {
    added,
    gone: beforeGroups.filter((g) => !afterKeys.has(g.key)),
    same: afterGroups.length - added.length,
  };
}

// ---- following one request ---------------------------------------------------------------

export interface LineId {
  /** The field it came from (traceId, request_id), or "id" for one found in the text. */
  key: string;
  value: string;
}

// fields that name one request, job or user across services: traceId, request_id, x-request-id, orderId…
const ID_KEY = /^(?:x[_.-]?)?(?:trace|span|request|req|correlation|transaction|txn|session|order|job|user|tenant)[_.-]?id$/i;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
// W3C trace IDs (32 hex) and the trace part of a traceparent header
const TRACE_HEX = /\b(?=[0-9a-f]*[a-f])[0-9a-f]{32}\b/gi;
const MAX_IDS = 6;

/** The IDs in a line that other lines of the same request would carry: ID fields, UUIDs, trace IDs. */
export function lineIds(line: LogLine): LineId[] {
  const ids: LineId[] = [];
  const add = (key: string, value: string | undefined) => {
    const v = value?.trim();
    if (!v || v.length < 2 || v.length > 100 || ids.some((id) => id.value === v)) return;
    ids.push({ key, value: v });
  };
  for (const key of lineFields(line)) if (ID_KEY.test(key)) add(key, fieldValue(line, key));
  const text = splitSource(line.text).rest;
  for (const match of text.matchAll(UUID)) add('id', match[0]);
  for (const match of text.matchAll(TRACE_HEX)) add('trace', match[0]);
  return ids.slice(0, MAX_IDS);
}

export interface IdTrace {
  /** Entries that mention the ID (stack-trace lines go with their entry). */
  entries: number;
  sources: string[];
  first: number | null;
  last: number | null;
}

/** Where an ID appears in the whole log: how many entries, in which pods, over how long. */
export function traceId(lines: LogLine[], value: string): IdTrace {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // whole tokens only: user 42 shouldn't find 1420
  const re = new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`);
  const trace: IdTrace = { entries: 0, sources: [], first: null, last: null };
  for (const line of lines) {
    if (line.continuation || !line.text.includes(value) || !re.test(line.text)) continue;
    trace.entries++;
    if (line.source !== null && !trace.sources.includes(line.source)) trace.sources.push(line.source);
    if (line.time !== null) {
      trace.first = trace.first === null ? line.time : Math.min(trace.first, line.time);
      trace.last = trace.last === null ? line.time : Math.max(trace.last, line.time);
    }
  }
  return trace;
}

// ---- GitHub Actions groups ---------------------------------------------------------------

export interface LogGroup {
  /** The text after ##[group]: "Run npm test", "Fetching the repository". */
  title: string;
  /** Line number of the ##[group] line. */
  start: number;
  /** Line number of its ##[endgroup], or of the line before the next group or the log's last line. */
  end: number;
  /** ERROR entries inside the group. */
  errors: number;
}

// GitHub Actions raw logs: "2026-10-04T10:00:00.1234567Z ##[group]Run npm test"; ::group:: as written in a
// workflow, or printed by tools that run locally (act)
const GROUP_START = /^(?:\d{4}-\d{2}-\d{2}T[\d:.]+Z\s)?(?:##\[group\]|::group::)(.*)$/;
const GROUP_END = /^(?:\d{4}-\d{2}-\d{2}T[\d:.]+Z\s)?(?:##\[endgroup\]|::endgroup::)\s*$/;

/**
 * The ##[group] … ##[endgroup] sections of a GitHub Actions log, which the GitHub UI folds. Groups don't
 * nest there, so a new group ends the one before it.
 */
export function findGroups(lines: LogLine[]): LogGroup[] {
  const groups: LogGroup[] = [];
  let open: LogGroup | null = null;
  for (const line of lines) {
    const rest = splitSource(line.text).rest;
    const start = GROUP_START.exec(rest);
    if (start) {
      if (open) open.end = line.number - 1;
      open = { title: start[1].trim(), start: line.number, end: line.number, errors: 0 };
      groups.push(open);
    } else if (open) {
      open.end = line.number;
      if (line.level === 'ERROR' && !line.continuation) open.errors++;
      if (GROUP_END.test(rest)) open = null;
    }
  }
  return groups;
}

/** Leaves out the lines inside closed groups; their ##[group] line stays as the group's header. */
export function foldGroups<T extends LogLine>(lines: T[], groups: LogGroup[], open: Set<number>): T[] {
  const closed = groups.filter((g) => !open.has(g.start) && g.end > g.start);
  if (closed.length === 0) return lines;
  let i = 0;
  return lines.filter((line) => {
    while (i < closed.length && closed[i].end < line.number) i++;
    const group = closed[i];
    return !group || line.number <= group.start || line.number > group.end;
  });
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

/**
 * Quotes a single CSV field value per RFC 4180.
 * Fields containing double-quotes, commas, or line breaks are wrapped in double-quotes,
 * with any existing double-quotes escaped as `""`.
 */
export function quoteCsv(value: string): string {
  // a log is untrusted text: =HYPERLINK(…), +cmd|… or @SUM(…) would run as a formula in a spreadsheet,
  // so such cells start with ' (OWASP's advice); plain numbers like -5 or +1.5 stay numbers
  if (/^[=+\-@\t\r]/.test(value) && !/^[+-]?\d+(?:\.\d+)?$/.test(value)) value = `'${value}`;
  if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export interface CsvOptions {
  /** Masks secrets in the cell values. */
  mask?: (text: string) => string;
}

/**
 * Converts log rows to a CSV formatted string per RFC 4180.
 * Includes a header row of column names, followed by each row's cells.
 */
export function toCsv(rows: LogLine[], columns: string[], options?: CsvOptions): string {
  const header = columns.map(quoteCsv).join(',');
  const lines = [header];
  for (const row of rows) {
    // stack-trace lines have no fields, so they would only be empty rows
    if (row.continuation) continue;
    const { cells } = tableCells(row, columns);
    const formatted = cells.map((cell) => {
      const masked = options?.mask ? options.mask(cell) : cell;
      return quoteCsv(masked);
    });
    lines.push(formatted.join(','));
  }
  return lines.join('\r\n') + '\r\n';
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
