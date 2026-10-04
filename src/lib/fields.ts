/**
 * Field filters for structured logs: `level=error service=payments duration>500`. Fields come from
 * JSON records and from key=value pairs in plain lines (logfmt, Spring, nginx), so the same filter
 * works on both.
 */
import type { LogLine } from './logs';

export type FieldOp = '=' | '!=' | '>' | '>=' | '<' | '<=';

export interface FieldCondition {
  key: string;
  op: FieldOp;
  value: string;
}

// key: letters, digits, _ . - @ ; value: "quoted" or anything up to the next space
const CONDITION = /^([A-Za-z_@][\w.@-]*)(!=|>=|<=|=|>|<)("(?:[^"\\]|\\.)*"|\S+)$/;

/**
 * Reads a search box query as field conditions. Returns null unless every word is a condition, so
 * an ordinary search like `timeout after 30s` or `a=b c` stays a text search.
 */
export function parseFieldQuery(query: string): FieldCondition[] | null {
  // split on spaces outside quotes: service="payment api" level=error
  const words = query.trim().match(/(?:[^\s"]+|"(?:[^"\\]|\\.)*")+/g);
  if (!words) return null;
  const conditions: FieldCondition[] = [];
  for (const word of words) {
    const match = CONDITION.exec(word);
    if (!match) return null;
    const [, key, op, raw] = match;
    conditions.push({ key, op: op as FieldOp, value: unquote(raw) });
  }
  return conditions;
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
  if (key in record) return record[key];
  let value: unknown = record;
  for (const part of key.split('.')) {
    if (value === null || typeof value !== 'object' || !(part in value)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

export function fieldValue(line: LogLine, key: string, plain?: Map<string, string>): string | undefined {
  if (line.json) {
    const value = jsonField(line.json, key);
    if (value !== undefined && value !== null) return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
  const fromText = (plain ?? plainFields(line.text)).get(key);
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

function sameText(actual: string, expected: string, key: string): boolean {
  let a = actual.toLowerCase();
  let e = expected.toLowerCase();
  if (key === 'level') {
    a = LEVEL_NAMES[a] ?? a;
    e = LEVEL_NAMES[e] ?? e;
  }
  if (e.includes('*')) {
    // glob: service=pay* or path=*/orders/*
    const pattern = e.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${pattern}$`).test(a);
  }
  return a === e;
}

function matchesCondition(actual: string | undefined, condition: FieldCondition): boolean {
  const { op, value, key } = condition;
  if (op === '=' || op === '!=') {
    const equal = actual !== undefined && (sameNumber(actual, value) || sameText(actual, value, key));
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
export function matchesFields(line: LogLine, conditions: FieldCondition[]): boolean {
  const plain = line.json ? undefined : plainFields(line.text);
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
