import { LogLine } from './logs';

export interface Bucket {
  from: number;
  to: number;
  errors: number;
  warnings: number;
  total: number;
}

export interface Timeline {
  from: number;
  to: number;
  buckets: Bucket[];
  /** Largest bucket total, for scaling the bars. */
  max: number;
}

/**
 * Counts entries per time slice, so a histogram can show when errors piled up.
 * Only entry lines with a timestamp count; stack-trace lines belong to their entry.
 * Returns null when the log has fewer than two distinct timestamps.
 */
export function buildTimeline(lines: LogLine[], bucketCount = 80): Timeline | null {
  let from = Infinity;
  let to = -Infinity;
  for (const line of lines) {
    if (line.time !== null) {
      if (line.time < from) from = line.time;
      if (line.time > to) to = line.time;
    }
  }
  if (!Number.isFinite(from) || from === to) {
    return null;
  }

  const size = (to - from) / bucketCount;
  const buckets: Bucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    from: from + i * size,
    to: from + (i + 1) * size,
    errors: 0,
    warnings: 0,
    total: 0,
  }));
  for (const line of lines) {
    if (line.time === null) continue;
    const bucket = buckets[Math.min(bucketCount - 1, Math.floor((line.time - from) / size))];
    bucket.total++;
    if (line.level === 'ERROR') bucket.errors++;
    else if (line.level === 'WARN') bucket.warnings++;
  }
  return { from, to, buckets, max: Math.max(...buckets.map((b) => b.total)) };
}
