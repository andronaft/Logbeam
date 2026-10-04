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
  /** The whole line is part of a secret, e.g. the base64 body of a PEM private key. */
  secretBlock: boolean;
  /** Which pod or container wrote the line, from `kubectl logs --prefix` or `docker compose logs`. */
  source: string | null;
}

// kubectl logs --prefix: "[pod/payments-7d9f8-x2k4p/app] …"
const KUBECTL_PREFIX = /^\[pod\/([^/\]\s]+)\/([^\]\s]+)\] /;
// docker compose logs: "payments-1  | …" (the replica number tells it from "INFO | …")
const COMPOSE_PREFIX = /^([a-z0-9][\w.-]*-\d+)\s+\| ?/;

/** Splits off a kubectl or docker compose prefix, so the rest is read like any log line. */
export function splitSource(raw: string): { source: string | null; rest: string } {
  const kubectl = KUBECTL_PREFIX.exec(raw);
  if (kubectl) return { source: `${kubectl[1]}/${kubectl[2]}`, rest: raw.slice(kubectl[0].length) };
  const compose = COMPOSE_PREFIX.exec(raw);
  if (compose) return { source: compose[1], rest: raw.slice(compose[0].length) };
  return { source: null, rest: raw };
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
  DBG: 'DEBUG',
  FINE: 'DEBUG',
  TRACE: 'TRACE',
  FINER: 'TRACE',
  FINEST: 'TRACE',
};

const LEVEL_WORDS = 'ERROR|ERR|FATAL|SEVERE|CRITICAL|PANIC|WARN|WARNING|INFO|NOTICE|DEBUG|DBG|FINE|TRACE|FINER|FINEST';
// An upper-case level word on its own: "ERROR", "[WARN]", "W0301 WARNING:". Case-sensitive, so prose like
// "no error here" doesn't turn a line red.
const LEVEL_UPPER_RE = new RegExp(`(?:^|[\\s[(|:=<])(${LEVEL_WORDS})(?=$|[\\s\\]):|,>])`);
// Lower- or mixed-case levels only where the context says it's a level: "level=info", "[warn]", "<debug>",
// or a line starting with "Error: …"
const LEVEL_CONTEXT_RES = [
  new RegExp(`\\blevel["']?\\s*[=:]\\s*["']?(${LEVEL_WORDS})\\b`, 'i'),
  new RegExp(`[[<(](${LEVEL_WORDS})[\\]>)]`, 'i'),
  new RegExp(`^\\s*(${LEVEL_WORDS})(?=:\\s|\\s*$)`, 'i'),
];
// Android logcat: "E/ActivityManager( 123): …" and threadtime "09-29 10:00:00.123  123  456 W Tag: …"
const ANDROID_RE = /^\s*([VDIWEF])\/[\w.$-]+\s*(?:\(\s*\d+\))?\s*:|^\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}\s+\d+\s+\d+\s+([VDIWEF])\s/;
// Single-letter level in brackets near the start: "[W] disk almost full"
const LETTER_RE = /^.{0,40}?\[([VDIWEF])\]\s/;
const LETTER_LEVELS: Record<string, Level> = { V: 'TRACE', D: 'DEBUG', I: 'INFO', W: 'WARN', E: 'ERROR', F: 'ERROR' };

// Stack trace frames and wrapped exceptions (Java, JS, Python, Go).
const CONTINUATION_RE =
  /^(\s+at\s|\s+\.\.\.\s\d+\s(more|common frames)|Caused by:|Suppressed:|\s+File ".*", line \d+|Traceback \(most recent call last\)|goroutine \d+ \[|\t)/;

// ISO 8601 and the common "yyyy-MM-dd HH:mm:ss,SSS" / "yyyy/MM/dd HH:mm:ss.SSS" forms.
const TIMESTAMP_RE = /(\d{4})[-/](\d{2})[-/](\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,9}))?(Z|[+-]\d{2}:?\d{2})?/;

export function detectLevel(text: string): Level | null {
  const head = text.slice(0, 200);
  const word = LEVEL_UPPER_RE.exec(head) ?? LEVEL_CONTEXT_RES.map((re) => re.exec(head)).find(Boolean);
  if (word) return LEVEL_ALIASES[word[1].toUpperCase()];
  const letter = ANDROID_RE.exec(head) ?? LETTER_RE.exec(head);
  if (letter) return LETTER_LEVELS[letter[1] ?? letter[2]];
  return null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// nginx / Apache common log format: [29/Sep/2026:10:00:00 +0000]
const CLF_RE = /(\d{2})\/([A-Z][a-z]{2})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})(?: ([+-]\d{4}))?/;
// syslog: "Sep 29 10:00:00" at the start (no year)
const SYSLOG_RE = /^([A-Z][a-z]{2}) {1,2}(\d{1,2}) (\d{2}):(\d{2}):(\d{2})\b/;
// Android logcat threadtime: "09-29 10:00:00.123" at the start (no year)
const MONTH_DAY_RE = /^(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})\b/;
// Unix time at the start of the line, seconds (optionally with a fraction) or millis, 2001–2100
const EPOCH_RE = /^\s*(\d{10}(?:\.\d+)?|\d{13})\b/;

/** Formats without a year are read in the current year; only the gaps between lines matter for those. */
const CURRENT_YEAR = new Date().getUTCFullYear();

function utc(year: number, month: number, day: number, h: number, mi: number, s: number, ms = 0): number | null {
  const time = Date.UTC(year, month, day, h, mi, s, ms);
  return Number.isNaN(time) ? null : time;
}

export function parseTimestamp(text: string): number | null {
  const head = text.slice(0, 80);
  const m = TIMESTAMP_RE.exec(head);
  if (!m) {
    return parseOtherTimestamp(head);
  }
  const [, y, mo, d, h, mi, s, frac = '0', zone] = m;
  const millis = Number(frac.padEnd(3, '0').slice(0, 3));
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}.${String(millis).padStart(3, '0')}${normalizeZone(zone)}`;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : time;
}

function parseOtherTimestamp(head: string): number | null {
  const clf = CLF_RE.exec(head);
  if (clf && MONTHS.includes(clf[2])) {
    const [, d, mon, y, h, mi, s, zone] = clf;
    const time = utc(+y, MONTHS.indexOf(mon), +d, +h, +mi, +s);
    if (time === null || !zone) return time;
    const offset = (zone[0] === '-' ? -1 : 1) * (+zone.slice(1, 3) * 60 + +zone.slice(3)) * 60_000;
    return time - offset;
  }
  const syslog = SYSLOG_RE.exec(head);
  if (syslog && MONTHS.includes(syslog[1])) {
    const [, mon, d, h, mi, s] = syslog;
    return utc(CURRENT_YEAR, MONTHS.indexOf(mon), +d, +h, +mi, +s);
  }
  const monthDay = MONTH_DAY_RE.exec(head);
  if (monthDay) {
    const [, mo, d, h, mi, s, ms] = monthDay;
    return utc(CURRENT_YEAR, +mo - 1, +d, +h, +mi, +s, +ms);
  }
  const epoch = EPOCH_RE.exec(head);
  if (epoch) {
    const value = Number(epoch[1]);
    const millis = epoch[1].length === 13 ? value : value * 1000;
    return millis >= 978_307_200_000 && millis < 4_102_444_800_000 ? Math.round(millis) : null;
  }
  return null;
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
  // pino and zap write epoch numbers and numeric levels; show them as a date and a level name
  const rawTime = pick(record, JSON_TIME_KEYS);
  const millis = typeof rawTime === 'number' ? jsonTime(record) : null;
  const time = millis !== null ? new Date(millis).toISOString() : rawTime;
  const rawLevel = pick(record, JSON_LEVEL_KEYS);
  const level = typeof rawLevel === 'number' ? (jsonLevel(record) ?? rawLevel) : rawLevel;
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
    return Math.round(value < 1e12 ? value * 1000 : value); // seconds (zap: with a fraction) or millis
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

const PEM_BEGIN = /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/;
const PEM_END = /-----END (?:[A-Z]+ )*PRIVATE KEY-----/;

/** Where a JSON value is while it's read line by line: bracket depth and whether inside a string. */
interface JsonScan {
  depth: number;
  inString: boolean;
  escaped: boolean;
}

function scanJson(text: string, scan: JsonScan): void {
  for (const char of text) {
    if (scan.inString) {
      if (scan.escaped) scan.escaped = false;
      else if (char === '\\') scan.escaped = true;
      else if (char === '"') scan.inString = false;
    } else if (char === '"') scan.inString = true;
    else if (char === '{' || char === '[') scan.depth++;
    else if (char === '}' || char === ']') scan.depth--;
  }
}

/** A JSON object printed over several lines, e.g. by JSON.stringify(record, null, 2). */
interface JsonBlock {
  head: LogLine;
  /** The JSON starts here in the head line; 0 when the whole entry is the JSON record. */
  start: number;
  body: LogLine[];
  raw: string[];
  scan: JsonScan;
  /** Parser state right after the head, to replay the body as ordinary lines if it isn't JSON. */
  levelAfterHead: Level | null;
  timeBeforeHead: number | null;
  timeAfterHead: number | null;
}

/** A pretty-printed record longer than this is more likely an unbalanced brace than JSON. */
const MAX_JSON_BLOCK_LINES = 5000;

/**
 * Parses lines one chunk at a time. It keeps the state that crosses chunk borders (the
 * level of the current entry, the previous timestamp, an unfinished multi-line JSON record),
 * so a big log can be parsed in a Web Worker or between animation frames with progress updates.
 */
export class LogParser {
  /** Inside a PEM private key: its body lines don't look like secrets on their own. */
  private inPem = false;
  private currentLevel: Level | null = null;
  private lastTime: number | null = null;
  private count = 0;
  private block: JsonBlock | null = null;

  push(rawLines: string[]): LogLine[] {
    return rawLines.map((raw) => this.next(raw));
  }

  private next(raw: string): LogLine {
    if (this.block) {
      const line = this.continueBlock(raw);
      if (line) return line;
    }
    const line = this.parseLine(raw);
    if (!line.continuation && !this.inPem) this.maybeOpenBlock(line, raw);
    return line;
  }

  /**
   * Starts a block when a line opens a JSON object that it doesn't close: a line that is just
   * "{", or an entry ending in "{" like "INFO Request body: {".
   */
  private maybeOpenBlock(head: LogLine, raw: string): void {
    const trimmed = raw.trim();
    const wholeRecord = trimmed.startsWith('{');
    if (!wholeRecord && !trimmed.endsWith('{')) return;
    const start = raw.indexOf('{');
    const scan: JsonScan = { depth: 0, inString: false, escaped: false };
    scanJson(raw.slice(start), scan);
    if (scan.depth <= 0) return;
    this.block = {
      head,
      start: wholeRecord ? 0 : start,
      body: [],
      raw: [raw],
      scan,
      levelAfterHead: this.currentLevel,
      // lastTime already counts the head's own timestamp, if it had one
      timeBeforeHead: head.time === null ? this.lastTime : head.gap === null ? null : head.time - head.gap,
      timeAfterHead: this.lastTime,
    };
  }

  /** Adds a line to the open block, or returns null after giving the block up. */
  private continueBlock(raw: string): LogLine | null {
    const block = this.block!;
    // pretty-printed JSON is indented until its closing bracket; anything else at the start of
    // a line is a new entry, so the "{" wasn't the start of a record after all
    if ((!/^[\s}\]]/.test(raw) && raw !== '') || block.body.length >= MAX_JSON_BLOCK_LINES) {
      this.abandonBlock();
      return null;
    }
    scanJson(raw, block.scan);
    const line: LogLine = {
      number: ++this.count,
      text: raw,
      level: block.head.level,
      continuation: true,
      time: null,
      gap: null,
      json: null,
      secret: hasSecret(raw),
      secretBlock: false,
      source: null,
    };
    block.body.push(line);
    block.raw.push(raw);
    if (block.scan.depth <= 0) this.closeBlock();
    return line;
  }

  private closeBlock(): void {
    const block = this.block!;
    this.block = null;
    const text = block.raw.join('\n').slice(block.start);
    let record: Record<string, unknown> | null = null;
    try {
      const value = JSON.parse(text);
      if (value && typeof value === 'object' && !Array.isArray(value)) record = value;
    } catch {
      // not JSON (e.g. a JavaScript object printed by console.log): still one entry, no fields
    }
    const head = block.head;
    if (record) {
      head.json = record;
      if (block.start === 0) {
        // the record is the whole entry: take its level, time and message like a one-line JSON log
        head.text = formatJsonRecord(record);
        head.secret = hasSecret(head.text);
        head.level = jsonLevel(record) ?? head.level;
        const time = jsonTime(record);
        if (time !== null) {
          head.time = time;
          head.gap = block.timeBeforeHead !== null ? time - block.timeBeforeHead : null;
          this.lastTime = time;
        }
      }
    }
    for (const line of block.body) line.level = head.level;
    this.currentLevel = head.level;
  }

  /** The "{" didn't start a record: parse the lines read since then as ordinary lines. */
  private abandonBlock(): void {
    const block = this.block!;
    this.block = null;
    this.currentLevel = block.levelAfterHead;
    this.lastTime = block.timeAfterHead;
    const count = this.count;
    for (const line of block.body) {
      this.count = line.number - 1;
      Object.assign(line, this.parseLine(line.text));
    }
    this.count = count;
  }

  private parseLine(raw: string): LogLine {
    if (this.inPem) {
      const body = !PEM_END.test(raw);
      this.inPem = body;
      // the key belongs to the entry that printed it
      return {
        number: ++this.count,
        text: raw,
        level: this.currentLevel,
        continuation: true,
        time: null,
        gap: null,
        json: null,
        secret: body,
        secretBlock: body,
        source: null,
      };
    }
    if (PEM_BEGIN.test(raw) && !PEM_END.test(raw)) {
      this.inPem = true;
    }

    // a pod's lines are read without the "[pod/…]" prefix, which stays in the shown text
    const { source, rest } = splitSource(raw);
    const json = parseJsonRecord(rest);
    const continuation = json === null && CONTINUATION_RE.test(rest);

    let level: Level | null;
    let time: number | null = null;
    if (continuation) {
      level = this.currentLevel;
    } else {
      level = json ? jsonLevel(json) : detectLevel(rest);
      time = json ? jsonTime(json) : parseTimestamp(rest);
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

    const formatted = json ? formatJsonRecord(json) : rest;
    const text = source !== null ? raw.slice(0, raw.length - rest.length) + formatted : formatted;
    return {
      number: ++this.count,
      text,
      level,
      continuation,
      time,
      gap,
      json,
      secret: hasSecret(text),
      secretBlock: false,
      source,
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

/**
 * Collapses consecutive repeated entries. An entry is a line plus its continuation lines (a stack
 * trace), so six identical errors with the same trace become one entry marked ×6.
 */
export function collapseRepeats(lines: LogLine[]): CollapsedLine[] {
  const entries: LogLine[][] = [];
  for (const line of lines) {
    const current = entries[entries.length - 1];
    if (line.continuation && current) current.push(line);
    else entries.push([line]);
  }

  const result: CollapsedLine[] = [];
  let previousSignature: string | null = null;
  let previousHead: CollapsedLine | null = null;
  for (const entry of entries) {
    const sig = entry.map((line) => signature(line.text)).join('\n');
    if (previousHead && sig === previousSignature) {
      previousHead.repeat++;
      continue;
    }
    const collapsed = entry.map((line) => ({ ...line, repeat: 1 }));
    result.push(...collapsed);
    previousHead = collapsed[0];
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

/** "+250ms", "+5.5s", "+2m5s", "+1.5h"; an out-of-order log gives a negative gap ("−3.0s"). */
export function formatGap(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  const sign = ms < 0 ? '−' : '+';
  const abs = Math.abs(Math.round(ms));
  if (abs < 1000) return `${sign}${abs}ms`;
  const tenths = Math.floor(abs / 100); // truncate, so 59 999 ms doesn't round up to "60.0s"
  if (tenths < 600) return `${sign}${(tenths / 10).toFixed(1)}s`;
  const seconds = Math.floor(abs / 1000);
  if (seconds < 3600) return `${sign}${Math.floor(seconds / 60)}m${seconds % 60}s`;
  return `${sign}${(Math.floor(abs / 360_000) / 10).toFixed(1)}h`;
}
