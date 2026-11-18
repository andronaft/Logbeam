/**
 * "Hide lines like this": takes a kind of line out of the view, such as the health checks that
 * are nine lines in ten of a pod's log. A kind is the line with its times, numbers and IDs taken
 * out (the signature that Collapse uses too) and its level, so a 503 that a log marks ERROR is not
 * hidden with the 200s.
 */
import { Level, LogLine, signature, splitSource } from './logs';

export interface Mute {
  /** The line it was made from: a view link keeps this number, not the text. */
  line: number;
  key: string;
  level: Level | null;
  /** The kind of line as its chip shows it, e.g. "GET /healthz #". */
  label: string;
}

const LABEL_LENGTH = 48;

/** Which kind of line this is. Lines of every pod or file share their kinds. */
export function muteKey(line: LogLine): string {
  let text = splitSource(line.text).rest;
  // the other fields of a JSON record (a user, a request ID) would make every line a kind of its own
  if (line.json) text = text.replace(/ \{.*\}$/, '');
  return `${line.level ?? ''} ${signature(text)}`;
}

export function makeMute(line: LogLine): Mute {
  const key = muteKey(line);
  const text = key.slice(key.indexOf(' ') + 1) || '…';
  const label = text.length > LABEL_LENGTH ? `${text.slice(0, LABEL_LENGTH - 1)}…` : text;
  return { line: line.number, key, level: line.level, label };
}

/**
 * Calls back with each line and whether it starts an entry. In a log with timestamps, a line
 * without one ("java.lang.IllegalStateException: …" under an error) belongs to the entry above.
 */
function eachEntryLine(lines: LogLine[], visit: (line: LogLine, starts: boolean) => void): void {
  let timed = false;
  for (const line of lines) {
    const starts = !line.continuation && (line.time !== null || !timed);
    if (starts) timed = line.time !== null;
    visit(line, starts);
  }
}

/**
 * The lines without the hidden kinds, and how many lines were taken out. A stack trace goes with
 * its entry. keyOf is muteKey, cached by the caller: the viewer asks for the same lines on every
 * filter change.
 */
export function hideMuted(
  lines: LogLine[],
  keys: ReadonlySet<string>,
  keyOf: (line: LogLine) => string = muteKey,
): { lines: LogLine[]; hidden: number } {
  if (keys.size === 0) return { lines, hidden: 0 };
  let hide = false;
  const kept: LogLine[] = [];
  eachEntryLine(lines, (line, starts) => {
    if (starts) hide = keys.has(keyOf(line));
    if (!hide) kept.push(line);
  });
  return { lines: kept, hidden: lines.length - kept.length };
}

/** How many entries are of this kind. */
export function countKind(lines: LogLine[], key: string, keyOf: (line: LogLine) => string = muteKey): number {
  let count = 0;
  eachEntryLine(lines, (line, starts) => {
    if (starts && keyOf(line) === key) count++;
  });
  return count;
}
