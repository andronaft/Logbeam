/**
 * Field filters for structured logs: `level=error service=payments duration>500`. Fields come from
 * JSON records and from key=value pairs in plain lines (logfmt, Spring, nginx), so the same filter
 * works on both.
 */
import { LogLine, eachEntry } from './logs';

export type FieldOp = '=' | '!=' | '>' | '>=' | '<' | '<=';

export interface FieldCondition {
  key: string;
  op: FieldOp;
  value: string;
  /** The value was "quoted": a * in it is a star, not a wildcard. */
  exact?: boolean;
}

const QUOTED = '"(?:[^"\\\\]|\\\\.)*"';
const PLAIN_KEY = /^[A-Za-z_@][\w.@-]*$/;
// key: letters, digits, _ . - @, or "quoted" ("k8s/app"); value: "quoted" or anything up to the next space
const CONDITION = new RegExp(`^(${QUOTED}|[A-Za-z_@][\\w.@-]*)(!=|>=|<=|=|>|<)(${QUOTED}|\\S+)$`);

/** A key as a condition writes it: as it is, or "quoted" when it has other characters (k8s/app, user:id). */
export function conditionKey(key: string): string {
  return PLAIN_KEY.test(key) ? key : JSON.stringify(key);
}

/** A value as a condition writes it to match just that value: quoted when it has a space, a quote or a *. */
export function conditionValue(value: string): string {
  return /[\s"*]/.test(value) || value === '' ? JSON.stringify(value) : value;
}

// Words of a query, split on spaces outside quotes: service="payment api" level=error. One character at a time
// (not [^\s"]+ inside the repeat, which backtracks), and a quote left open runs to the end, so a long query
// with an odd number of quotes (or a backslash at its very end) doesn't make the search box freeze.
const WORDS = /(?:[^\s"]|"(?:[^"\\]|\\.|\\$)*(?:"|$))+/g;

/**
 * Reads a search box query as field conditions. Returns null unless every word is a condition, so
 * an ordinary search like `timeout after 30s` or `a=b c` stays a text search.
 */
export function parseFieldQuery(query: string): FieldCondition[] | null {
  // split on spaces outside quotes: service="payment api" level=error
  const words = query.trim().match(WORDS);
  if (!words) return null;
  const conditions: FieldCondition[] = [];
  for (const word of words) {
    const match = CONDITION.exec(word);
    if (!match) return null;
    const [, key, op, raw] = match;
    const exact = raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"');
    conditions.push({ key: unquote(key), op: op as FieldOp, value: unquote(raw), ...(exact && { exact: true }) });
  }
  return conditions;
}

export interface SearchQuery {
  /** Field conditions: level=error duration>500. */
  conditions: FieldCondition[];
  /** Words to leave out: -healthz, -"connection reset". */
  exclude: string[];
  /** The rest, found as one piece of text like any search: "timeout after 30s". */
  text: string;
}

/**
 * Reads the search box: field conditions, words to leave out and text, in any mix:
 * `service=payments timeout -healthz`. A word like -5 or --verbose is text, not a word to leave out.
 */
export function parseQuery(query: string): SearchQuery {
  const words = query.trim().match(WORDS) ?? [];
  const conditions: FieldCondition[] = [];
  const exclude: string[] = [];
  const text: string[] = [];
  for (const word of words) {
    const condition = parseFieldQuery(word);
    if (condition) conditions.push(...condition);
    else if (/^-[^-\d]/.test(word) && unquote(word.slice(1))) exclude.push(unquote(word.slice(1)));
    else text.push(word);
  }
  // just text: kept as typed, spaces and all
  if (conditions.length === 0 && exclude.length === 0) return { conditions, exclude, text: query };
  return { conditions, exclude, text: text.join(' ') };
}

/**
 * The lines without the ones that have any of the words. A stack trace goes with its entry, so
 * -NullPointerException leaves out the whole error, not just its first line.
 */
export function excludeWords(lines: LogLine[], words: string[], caseSensitive: boolean): LogLine[] {
  if (words.length === 0) return lines;
  const needles = caseSensitive ? words : words.map((word) => word.toLowerCase());
  const has = (text: string) => {
    const haystack = caseSensitive ? text : text.toLowerCase();
    return needles.some((needle) => haystack.includes(needle));
  };
  const kept: LogLine[] = [];
  let entryOut = false;
  eachEntry(lines, (line, starts) => {
    if (starts) entryOut = has(line.text);
    if (!entryOut && !has(line.text)) kept.push(line);
  });
  return kept;
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

// key=value pairs in a plain line; the key must start the line or follow a space, comma, "{" or "("
const PAIR = /(?:^|[\s,{(])([A-Za-z_@][\w.@-]*)=("(?:[^"\\]|\\.)*"|[^\s,)}]*)/g;

/** The key=value pairs of a plain log line, e.g. `status=500 path="/api/orders"`. */
export function plainFields(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const match of text.matchAll(PAIR)) {
    if (!fields.has(match[1])) fields.set(match[1], unquote(match[2]));
  }
  return fields;
}

/** Looks a key up in a JSON record: an exact key first ("log.level"), then a path (http.status). */
function jsonField(record: Record<string, unknown>, key: string): unknown {
  if (Object.hasOwn(record, key)) return record[key];
  let value: unknown = record;
  for (const part of key.split('.')) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

export function fieldValue(line: LogLine, key: string, plain?: ReadonlyMap<string, string>): string | undefined {
  if (line.json) {
    const value = jsonField(line.json, key);
    // pino's {"level": 50}: level=error means the level the line was read as
    if (key === 'level' && typeof value === 'number' && line.level) return line.level;
    if (value !== undefined && value !== null) return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
  const fromText = (plain ?? (line.text.includes(`${key}=`) ? plainFields(line.text) : NO_FIELDS)).get(key);
  if (fromText !== undefined) return fromText;
  // every line has a level, even without a level= field
  if (key === 'level' && line.level) return line.level;
  if (key === 'pod' && line.source) return line.source;
  return undefined;
}

const UNIT_MILLIS: Record<string, number> = { ns: 1e-6, us: 1e-3, µs: 1e-3, ms: 1, s: 1000, m: 60_000, h: 3_600_000 };

/** "500", "1.5", and with a unit "250ms", "2s", "3m" (as milliseconds), or NaN. */
export function numericValue(value: string): number {
  const match = /^(-?\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)?$/.exec(value.trim());
  if (!match) return Number.NaN;
  const number = Number(match[1]);
  const unit = match[2];
  if (!unit) return number;
  return number * UNIT_MILLIS[unit];
}

const LEVEL_NAMES: Record<string, string> = {
  err: 'error',
  fatal: 'error',
  critical: 'error',
  warning: 'warn',
  dbg: 'debug',
};

function sameText(actual: string, expected: string, key: string, exact = false): boolean {
  let a = actual.toLowerCase();
  let e = expected.toLowerCase();
  if (key === 'level') {
    a = LEVEL_NAMES[a] ?? a;
    e = LEVEL_NAMES[e] ?? e;
  }
  if (!exact && e.includes('*')) {
    // glob: service=pay* or path=*/orders/*
    const pattern = e.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${pattern}$`).test(a);
  }
  return a === e;
}

function matchesCondition(actual: string | undefined, condition: FieldCondition): boolean {
  const { op, value, key, exact } = condition;
  if (op === '=' || op === '!=') {
    const equal = actual !== undefined && (sameNumber(actual, value) || sameText(actual, value, key, exact));
    return op === '=' ? equal : !equal;
  }
  if (actual === undefined) return false;
  const a = numericValue(actual);
  const b = numericValue(value);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  if (op === '>') return a > b;
  if (op === '>=') return a >= b;
  if (op === '<') return a < b;
  return a <= b;
}

function sameNumber(actual: string, expected: string): boolean {
  const a = numericValue(actual);
  const b = numericValue(expected);
  return !Number.isNaN(a) && !Number.isNaN(b) && a === b;
}

/** Whether a line meets every condition. */
/** No key=value pairs: what a line has that doesn't mention any of the keys asked for. */
const NO_FIELDS: ReadonlyMap<string, string> = new Map();

export function matchesFields(line: LogLine, conditions: FieldCondition[]): boolean {
  // the key=value regex is the slow part (0.3 s over 600k lines): only lines that have a key= need it
  const plain = line.json
    ? undefined
    : conditions.some((condition) => line.text.includes(`${condition.key}=`))
      ? plainFields(line.text)
      : NO_FIELDS;
  return conditions.every((condition) => matchesCondition(fieldValue(line, condition.key, plain), condition));
}

/**
 * Filters by fields entry by entry: a stack trace or the body of a pretty-printed JSON record is
 * kept or dropped together with the line that starts its entry.
 */
export function filterByFields(lines: LogLine[], conditions: FieldCondition[]): LogLine[] {
  const result: LogLine[] = [];
  let keep = false;
  for (const line of lines) {
    if (!line.continuation) keep = matchesFields(line, conditions);
    if (keep) result.push(line);
  }
  return result;
}

/** Field names seen in the first lines, for the search box's suggestions. */
export function commonFields(lines: LogLine[], sample = 500): string[] {
  const counts = new Map<string, number>();
  for (const line of lines.slice(0, sample)) {
    if (line.continuation) continue;
    const keys = line.json ? Object.keys(line.json) : [...plainFields(line.text).keys()];
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
}
