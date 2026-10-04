/**
 * Comparing two texts: a line diff (Myers' algorithm), a structural diff for JSON, and the
 * normalization that lets two runs of the same job be compared without every timestamp
 * showing up as a change.
 */

export type DiffKind = 'same' | 'add' | 'del';

export interface DiffOp {
  kind: DiffKind;
  /** 0-based index in the left lines, for 'same' and 'del'. */
  left?: number;
  /** 0-based index in the right lines, for 'same' and 'add'. */
  right?: number;
}

export interface LineDiff {
  ops: DiffOp[];
  added: number;
  removed: number;
  /** The texts differ too much for an exact diff: the changed middle is shown as replaced. */
  approximate: boolean;
}

/** Above this many changed lines the exact diff gets slow; the middle is then shown as replaced. */
const MAX_EDITS = 1000;

/** Diffs two lists of lines, comparing the keys (e.g. normalized lines) and indexing the originals. */
export function diffLines(left: string[], right: string[], maxEdits = MAX_EDITS): LineDiff {
  // common prefix and suffix are free and make the Myers part small
  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start++;
  let endLeft = left.length;
  let endRight = right.length;
  while (endLeft > start && endRight > start && left[endLeft - 1] === right[endRight - 1]) {
    endLeft--;
    endRight--;
  }

  const ops: DiffOp[] = [];
  for (let i = 0; i < start; i++) ops.push({ kind: 'same', left: i, right: i });
  const a = left.slice(start, endLeft);
  const b = right.slice(start, endRight);
  let middle = myers(a, b, maxEdits);
  const approximate = middle === null;
  middle ??= [...a.map((_, i): DiffOp => ({ kind: 'del', left: i })), ...b.map((_, i): DiffOp => ({ kind: 'add', right: i }))];
  for (const op of middle) {
    ops.push({
      kind: op.kind,
      left: op.left === undefined ? undefined : op.left + start,
      right: op.right === undefined ? undefined : op.right + start,
    });
  }
  for (let i = 0; endLeft + i < left.length; i++) ops.push({ kind: 'same', left: endLeft + i, right: endRight + i });

  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.kind === 'add') added++;
    else if (op.kind === 'del') removed++;
  }
  return { ops, added, removed, approximate };
}

/**
 * Myers' O(ND) diff. Keeps the furthest-reaching x for every diagonal k at each step d, then walks
 * back through those snapshots. Each snapshot only covers diagonals -d-1..d+1, so memory is O(D²).
 * Returns null when more than maxEdits changes are needed.
 */
function myers(a: string[], b: string[], maxEdits: number): DiffOp[] | null {
  const n = a.length;
  const m = b.length;
  const limit = Math.min(n + m, maxEdits);
  const offset = limit + 1;
  const v = new Int32Array(2 * limit + 3);
  const trace: Int32Array[] = [];

  for (let d = 0; d <= limit; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, n, m);
    }
  }
  return null;
}

function backtrack(trace: Int32Array[], n: number, m: number): DiffOp[] {
  const ops: DiffOp[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const snapshot = trace[d];
    const at = (k: number) => snapshot[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      ops.push({ kind: 'same', left: x, right: y });
    }
    if (d > 0) {
      if (x === prevX) ops.push({ kind: 'add', right: prevY });
      else ops.push({ kind: 'del', left: prevX });
    }
    x = prevX;
    y = prevY;
  }
  return ops.reverse();
}

/** The parts of a changed line that differ from its counterpart: everything between the common prefix and suffix. */
export function changedRange(before: string, after: string): { before: [number, number]; after: [number, number] } {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end++;
  }
  return { before: [start, before.length - end], after: [start, after.length - end] };
}

const TOKEN = /\s+|[^\s,;()[\]{}"'=]+|[,;()[\]{}"'=]/g;
const MAX_LINE_TOKENS = 2000;

/**
 * The changed parts of a line and its counterpart, as [start, end) spans. Compares words, so with
 * a key that hides timestamps only the words that really changed are marked.
 */
export function changedSpans(
  before: string,
  after: string,
  key: (token: string) => string = (token) => token,
): { before: [number, number][]; after: [number, number][] } {
  const a = before.match(TOKEN) ?? [];
  const b = after.match(TOKEN) ?? [];
  const diff = a.length + b.length <= MAX_LINE_TOKENS ? diffLines(a.map(key), b.map(key), 200) : null;
  if (!diff || diff.approximate) {
    const range = changedRange(before, after);
    return { before: [range.before], after: [range.after] };
  }
  const offsets = (tokens: string[]) => {
    const starts: number[] = [];
    let at = 0;
    for (const token of tokens) {
      starts.push(at);
      at += token.length;
    }
    return starts;
  };
  const aStarts = offsets(a);
  const bStarts = offsets(b);
  const spans = { before: [] as [number, number][], after: [] as [number, number][] };
  const add = (list: [number, number][], start: number, token: string) => {
    if (/^\s+$/.test(token)) return; // a changed space alone isn't worth marking
    const last = list[list.length - 1];
    // join spans separated only by whitespace into one
    if (last && /^\s*$/.test((list === spans.before ? before : after).slice(last[1], start))) last[1] = start + token.length;
    else list.push([start, start + token.length]);
  };
  for (const op of diff.ops) {
    if (op.kind === 'del') add(spans.before, aStarts[op.left!], a[op.left!]);
    else if (op.kind === 'add') add(spans.after, bStarts[op.right!], b[op.right!]);
  }
  return spans;
}

// ---- logs -------------------------------------------------------------------------------

const ISO_TIME = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g;
const DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
const CLOCK_TIME = /\b\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\b/g;
const EPOCH_AT_START = /^\s*\d{10}(?:\d{3})?(?:\.\d+)?\b/;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
// commit SHAs, container and trace IDs; must contain a letter so plain numbers aren't IDs
const HEX_ID = /\b(?=[0-9a-f]*[a-f])[0-9a-f]{12,}\b/gi;
const DURATION = /\b\d+(?:\.\d+)?\s?(?:ns|µs|us|ms|s|sec|secs|seconds?|m|min|h)\b/g;

/**
 * Hides what changes between two runs of the same job (timestamps, IDs, durations), so a diff of
 * two CI logs shows what actually happened differently.
 */
export function normalizeLogLine(line: string): string {
  return line
    .replace(EPOCH_AT_START, '<time>')
    .replace(ISO_TIME, '<time>')
    .replace(DATE, '<date>')
    .replace(CLOCK_TIME, '<time>')
    .replace(UUID, '<id>')
    .replace(HEX_ID, '<id>')
    .replace(DURATION, '<duration>');
}

export function normalizeWhitespace(line: string): string {
  return line.trim().replace(/\s+/g, ' ');
}

// ---- JSON -------------------------------------------------------------------------------

/** A number whose text can't be held exactly in a double, e.g. 12345678901234567890. */
export class RawNumber {
  constructor(readonly source: string) {}
}

/**
 * JSON.parse that keeps the exact text of numbers a double would change, where the browser
 * gives revivers the source text (Chrome 114+, Firefox 135+).
 */
export function parseJson(text: string): unknown {
  return JSON.parse(text, function (_key, value: unknown, context?: { source?: string }) {
    if (typeof value === 'number' && context?.source !== undefined && !sameNumber(value, context.source)) {
      return new RawNumber(context.source);
    }
    return value;
  });
}

function sameNumber(value: number, source: string): boolean {
  return Number.isSafeInteger(value) || !/^-?\d+$/.test(source) ? true : String(value) === source;
}

/** Parses text as a JSON object or array; null for anything else. */
export function parseJsonDocument(text: string): unknown {
  const trimmed = text.trim();
  if (!/^[[{]/.test(trimmed)) return null;
  try {
    const value = parseJson(trimmed);
    return value !== null && typeof value === 'object' && !(value instanceof RawNumber) ? value : null;
  } catch {
    return null;
  }
}

export type JsonChangeKind = 'added' | 'removed' | 'changed';

export interface JsonChange {
  path: string;
  kind: JsonChangeKind;
  before?: unknown;
  after?: unknown;
}

const MAX_JSON_CHANGES = 1000;

/** Lists what differs between two JSON values by path ($.items[2].price); key order doesn't matter. */
export function diffJson(before: unknown, after: unknown): JsonChange[] {
  const changes: JsonChange[] = [];
  walk(before, after, '$', changes);
  return changes;
}

function walk(before: unknown, after: unknown, path: string, changes: JsonChange[]): void {
  if (changes.length >= MAX_JSON_CHANGES || jsonEqual(before, after)) return;
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let i = 0; i < length; i++) {
      const itemPath = `${path}[${i}]`;
      if (i >= after.length) changes.push({ path: itemPath, kind: 'removed', before: before[i] });
      else if (i >= before.length) changes.push({ path: itemPath, kind: 'added', after: after[i] });
      else walk(before[i], after[i], itemPath, changes);
    }
    return;
  }
  if (isObject(before) && isObject(after)) {
    const keys = [...Object.keys(before), ...Object.keys(after).filter((key) => !(key in before))];
    for (const key of keys) {
      const keyPath = `${path}${/^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`}`;
      if (!(key in after)) changes.push({ path: keyPath, kind: 'removed', before: before[key] });
      else if (!(key in before)) changes.push({ path: keyPath, kind: 'added', after: after[key] });
      else walk(before[key], after[key], keyPath, changes);
    }
    return;
  }
  changes.push({ path, kind: 'changed', before, after });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof RawNumber);
}

function jsonEqual(a: unknown, b: unknown): boolean {
  if (a instanceof RawNumber || b instanceof RawNumber) {
    const source = (value: unknown) => (value instanceof RawNumber ? value.source : String(value));
    return (typeof a === 'number' || a instanceof RawNumber) && (typeof b === 'number' || b instanceof RawNumber)
      ? source(a) === source(b)
      : false;
  }
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => jsonEqual(item, b[i]));
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => key in b && jsonEqual(a[key], b[key]));
  }
  return false;
}

/** Pretty-prints JSON with keys sorted, so a text diff lines up regardless of key order. */
export function canonicalJson(value: unknown, indent = ''): string {
  if (value instanceof RawNumber) return value.source;
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const inner = `${indent}  `;
    return `[\n${value.map((item) => inner + canonicalJson(item, inner)).join(',\n')}\n${indent}]`;
  }
  if (isObject(value)) {
    const keys = Object.keys(value).sort();
    if (keys.length === 0) return '{}';
    const inner = `${indent}  `;
    return `{\n${keys.map((key) => `${inner}${JSON.stringify(key)}: ${canonicalJson(value[key], inner)}`).join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** A short one-line rendering of a JSON value for the list of changes. */
export function previewJson(value: unknown, max = 80): string {
  const text = value instanceof RawNumber ? value.source : canonicalJson(value).replace(/\s*\n\s*/g, ' ');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
