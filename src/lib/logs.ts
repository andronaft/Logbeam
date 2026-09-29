import { hasSecret } from './secrets';

export type Level = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'TRACE';

export const LEVELS: Level[] = ['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'];

export interface LogLine {
  /** 1-based line number in the original text. */
  number: number;
  text: string;
  /** Level of the entry this line belongs to (continuation lines inherit it), or null if unknown. */
  level: Level | null;
  /** True for lines that continue the previous entry, e.g. "\tat com.foo.Bar.baz(Bar.java:42)". */
  continuation: boolean;
  /** Parsed timestamp in epoch millis, if the line starts an entry and has one. */
  time: number | null;
  /** Millis since the previous timestamped entry. */
  gap: number | null;
  /** Structured fields when the line is a JSON log record. */
  json: Record<string, unknown> | null;
  /** The line shows a credential (key, token, password). */
  secret: boolean;
}

const LEVEL_ALIASES: Record<string, Level> = {
  ERROR: 'ERROR',
  ERR: 'ERROR',
  FATAL: 'ERROR',
  SEVERE: 'ERROR',
  CRITICAL: 'ERROR',
  PANIC: 'ERROR',
  WARN: 'WARN',
  WARNING: 'WARN',
  INFO: 'INFO',
  NOTICE: 'INFO',
  DEBUG: 'DEBUG',
  FINE: 'DEBUG',
  TRACE: 'TRACE',
  FINER: 'TRACE',
  FINEST: 'TRACE',
};

// A level word on its own, optionally in brackets: "ERROR", "[warn]", "level=info" etc.
const LEVEL_RE =
  /(?:^|[\s[(|:=])(ERROR|ERR|FATAL|SEVERE|CRITICAL|PANIC|WARN|WARNING|INFO|NOTICE|DEBUG|FINE|TRACE|FINER|FINEST)(?=$|[\s\]):|,])/i;

// Stack trace frames and wrapped exceptions (Java, JS, Python, Go).
const CONTINUATION_RE =
  /^(\s+at\s|\s+\.\.\.\s\d+\s(more|common frames)|Caused by:|Suppressed:|\s+File ".*", line \d+|Traceback \(most recent call last\)|goroutine \d+ \[|\t)/;

// ISO 8601 and the common "yyyy-MM-dd HH:mm:ss,SSS" / "yyyy/MM/dd HH:mm:ss.SSS" forms.
const TIMESTAMP_RE = /(\d{4})[-/](\d{2})[-/](\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,9}))?(Z|[+-]\d{2}:?\d{2})?/;

export function detectLevel(text: string): Level | null {
  const match = LEVEL_RE.exec(text.slice(0, 200));
  return match ? LEVEL_ALIASES[match[1].toUpperCase()] : null;
}

export function parseTimestamp(text: string): number | null {
  const m = TIMESTAMP_RE.exec(text.slice(0, 80));
  if (!m) {
    return null;
  }
  const [, y, mo, d, h, mi, s, frac = '0', zone] = m;
  const millis = Number(frac.padEnd(3, '0').slice(0, 3));
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}.${String(millis).padStart(3, '0')}${normalizeZone(zone)}`;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : time;
}

function normalizeZone(zone: string | undefined): string {
  if (!zone) {
    return 'Z'; // no zone: compare lines consistently, the absolute value doesn't matter for gaps
  }
  if (zone === 'Z') {
    return zone;
  }
  return zone.includes(':') ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`;
}

/** Parses a JSON log record such as {"@timestamp": "...", "level": "INFO", "message": "..."}. */
export function parseJsonRecord(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return null;
  }
  try {
    const value = JSON.parse(trimmed);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

const JSON_LEVEL_KEYS = ['level', 'severity', 'lvl', 'log.level', 'levelname'];
const JSON_TIME_KEYS = ['@timestamp', 'timestamp', 'time', 'ts', 'datetime'];
const JSON_MESSAGE_KEYS = ['message', 'msg', 'text', 'event'];

function pick(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) {
      return record[key];
    }
  }
  return undefined;
}

/** Renders a JSON record as "time LEVEL message {other fields}" so it reads like a plain log line. */
export function formatJsonRecord(record: Record<string, unknown>): string {
  const time = pick(record, JSON_TIME_KEYS);
  const level = pick(record, JSON_LEVEL_KEYS);
  const message = pick(record, JSON_MESSAGE_KEYS);
  const rest: Record<string, unknown> = {};
  const used = new Set([...JSON_TIME_KEYS, ...JSON_LEVEL_KEYS, ...JSON_MESSAGE_KEYS]);
  for (const [key, value] of Object.entries(record)) {
    if (!used.has(key)) {
      rest[key] = value;
    }
  }
  const parts = [time, level, message].filter((p) => p !== undefined).map(String);
  if (Object.keys(rest).length > 0) {
    parts.push(JSON.stringify(rest));
  }
  return parts.join(' ');
}

function jsonLevel(record: Record<string, unknown>): Level | null {
  const value = pick(record, JSON_LEVEL_KEYS);
  if (typeof value === 'string') {
    return LEVEL_ALIASES[value.toUpperCase()] ?? null;
  }
  // pino/bunyan numeric levels
  if (typeof value === 'number') {
    if (value >= 50) return 'ERROR';
    if (value >= 40) return 'WARN';
    if (value >= 30) return 'INFO';
    if (value >= 20) return 'DEBUG';
    return 'TRACE';
  }
  return null;
}

function jsonTime(record: Record<string, unknown>): number | null {
  const value = pick(record, JSON_TIME_KEYS);
  if (typeof value === 'number') {
    return value < 1e12 ? value * 1000 : value; // seconds or millis
  }
  return typeof value === 'string' ? parseTimestamp(value) : null;
}

export function splitLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

/**
 * Parses lines one chunk at a time. It keeps the state that crosses chunk borders (the
 * level of the current entry, the previous timestamp), so a big log can be parsed in a
 * Web Worker or between animation frames with progress updates.
 */
export class LogParser {
  private currentLevel: Level | null = null;
  private lastTime: number | null = null;
  private count = 0;

  push(rawLines: string[]): LogLine[] {
    return rawLines.map((raw) => this.parseLine(raw));
  }

  private parseLine(raw: string): LogLine {
    const json = parseJsonRecord(raw);
    const continuation = json === null && CONTINUATION_RE.test(raw);

    let level: Level | null;
    let time: number | null = null;
    if (continuation) {
      level = this.currentLevel;
    } else {
      level = json ? jsonLevel(json) : detectLevel(raw);
      time = json ? jsonTime(json) : parseTimestamp(raw);
      // a line without its own level but with a timestamp starts a new, unknown-level entry
      if (level !== null || time !== null) {
        this.currentLevel = level;
      } else {
        level = this.currentLevel;
      }
    }

    const gap = time !== null && this.lastTime !== null ? time - this.lastTime : null;
    if (time !== null) {
      this.lastTime = time;
    }

    const text = json ? formatJsonRecord(json) : raw;
    return {
      number: ++this.count,
      text,
      level,
      continuation,
      time,
      gap,
      json,
      secret: hasSecret(text),
    };
  }
}

export function parseLog(text: string): LogLine[] {
  return new LogParser().push(splitLines(text));
}

/** Heuristic used to decide whether a plain-text page is a log worth opening in the viewer. */
export function looksLikeLog(text: string): boolean {
  const sample = text.slice(0, 50_000).split('\n').slice(0, 300);
  if (sample.length < 3) {
    return false;
  }
  let hits = 0;
  for (const line of sample) {
    if (detectLevel(line) || parseTimestamp(line) || parseJsonRecord(line)) {
      hits++;
    }
  }
  return hits / sample.length >= 0.3;
}

export interface FilterOptions {
  levels: Set<Level>;
  /** Show lines whose level couldn't be detected. */
  includeUnknown: boolean;
  query: string;
  regex: boolean;
  caseSensitive: boolean;
}

/** Builds the search predicate; throws SyntaxError for an invalid regex so the UI can show it. */
export function buildMatcher(
  options: Pick<FilterOptions, 'query' | 'regex' | 'caseSensitive'>,
): ((text: string) => boolean) | null {
  if (!options.query) {
    return null;
  }
  if (options.regex) {
    const re = new RegExp(options.query, options.caseSensitive ? '' : 'i');
    return (text) => re.test(text);
  }
  const needle = options.caseSensitive ? options.query : options.query.toLowerCase();
  return (text) => (options.caseSensitive ? text : text.toLowerCase()).includes(needle);
}

export function filterLines(lines: LogLine[], options: FilterOptions): LogLine[] {
  const matches = buildMatcher(options);
  return lines.filter((line) => {
    const levelOk = line.level === null ? options.includeUnknown : options.levels.has(line.level);
    return levelOk && (matches === null || matches(line.text));
  });
}

export interface CollapsedLine extends LogLine {
  /** How many identical consecutive lines (ignoring timestamps and numbers) this row stands for. */
  repeat: number;
}

/**
 * Normalizes a line so repeats that differ only in timestamps, thread names ("[main]",
 * "[http-nio-8080-exec-2]"), ids or counters are treated as equal.
 */
export function signature(text: string): string {
  return text
    .replace(TIMESTAMP_RE, '')
    .replace(/\[[^\]]*\]/g, '[]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\d+/g, '#')
    .trim();
}

export function collapseRepeats(lines: LogLine[]): CollapsedLine[] {
  const result: CollapsedLine[] = [];
  let previousSignature: string | null = null;
  for (const line of lines) {
    const sig = signature(line.text);
    const last = result[result.length - 1];
    if (last && sig === previousSignature) {
      last.repeat++;
      continue;
    }
    result.push({ ...line, repeat: 1 });
    previousSignature = sig;
  }
  return result;
}

export function countByLevel(lines: LogLine[]): Record<Level | 'UNKNOWN', number> {
  const counts = { ERROR: 0, WARN: 0, INFO: 0, DEBUG: 0, TRACE: 0, UNKNOWN: 0 };
  for (const line of lines) {
    counts[line.level ?? 'UNKNOWN']++;
  }
  return counts;
}

export function formatGap(ms: number): string {
  if (ms < 1000) return `+${ms}ms`;
  if (ms < 60_000) return `+${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `+${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
  return `+${(ms / 3_600_000).toFixed(1)}h`;
}
