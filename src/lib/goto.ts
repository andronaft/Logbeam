/**
 * "Go to a time" (t): what someone types from an alert or a chat message, read as a moment in the
 * log. "10:05", "10:05:30.250", "2026-10-04 10:05:30", "2026-10-04T10:05:30Z". A time without a date
 * is on the log's own day (or days, for a log that goes past midnight), in the viewer's time mode.
 */
import type { TimeMode } from './insights';

const INPUT = /^(?:(\d{4})-(\d{2})-(\d{2})[ T])?(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,3})\d*)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;
const DAY = 86_400_000;

interface Parts {
  date: [number, number, number] | null;
  time: [number, number, number, number];
  zone: string | null;
}

function read(input: string): Parts | null {
  const m = INPUT.exec(input.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '0', ms = '0', zone] = m;
  if (+h > 23 || +mi > 59 || +s > 60) return null;
  return {
    date: y ? [+y, +mo, +d] : null,
    time: [+h, +mi, +s, +ms.padEnd(3, '0')],
    zone: zone ? zone.toUpperCase() : null,
  };
}

/** The moment of a date and time: with its own zone, or in UTC or the browser's zone. */
function at([y, mo, d]: [number, number, number], [h, mi, s, ms]: Parts['time'], zone: string | null, mode: TimeMode) {
  if (zone !== null) {
    const offset = zone === 'Z' ? 0 : (zone.startsWith('-') ? -1 : 1) * (+zone.slice(1, 3) * 60 + +zone.slice(-2));
    return Date.UTC(y, mo - 1, d, h, mi, s, ms) - offset * 60_000;
  }
  return mode === 'utc' ? Date.UTC(y, mo - 1, d, h, mi, s, ms) : new Date(y, mo - 1, d, h, mi, s, ms).getTime();
}

/** The calendar day of a moment, in the viewer's time mode. */
function dayOf(ms: number, mode: TimeMode): [number, number, number] {
  const date = new Date(ms);
  return mode === 'utc'
    ? [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
    : [date.getFullYear(), date.getMonth() + 1, date.getDate()];
}

/**
 * The moment someone means, in a log that runs from `first` to `last`; null when it isn't a time.
 * A time of day is tried on each day the log covers, and the first that falls inside it wins;
 * outside them all, the one on the log's first day.
 */
export function parseGotoTime(input: string, first: number, last: number, mode: TimeMode): number | null {
  const parts = read(input);
  if (!parts) return null;
  if (parts.date) return at(parts.date, parts.time, parts.zone, mode);
  const start = dayOf(first, mode);
  const candidates: number[] = [];
  // a few days at most: a log of weeks gets the first day, like any time outside it
  for (let i = 0; i <= Math.min(7, Math.ceil((last - first) / DAY) + 1); i++) {
    const day = dayOf(Date.UTC(start[0], start[1] - 1, start[2] + i, 12), 'utc');
    candidates.push(at(day, parts.time, parts.zone, mode));
  }
  return candidates.find((moment) => moment >= first && moment <= last) ?? candidates[0];
}

/** Index of the first shown line whose entry is at or after the moment; the last timed one if none is. */
export function indexAtTime(entryTimes: ArrayLike<number>, moment: number): number {
  let lastTimed = -1;
  for (let i = 0; i < entryTimes.length; i++) {
    const time = entryTimes[i];
    if (Number.isNaN(time)) continue;
    if (time >= moment) return i;
    lastTimed = i;
  }
  return lastTimed;
}
