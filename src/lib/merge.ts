/**
 * Several log files read as one, in the order things happened: the API's log next to the worker's,
 * or the same service on three machines. Each line keeps the name of its file in front, like
 * `docker compose logs` does, so every file gets a chip and a colour of its own.
 *
 *   api.log    | 2026-10-04 10:00:00 INFO  POST /orders
 *   worker.log | 2026-10-04 10:00:01 ERROR charge failed
 *   worker.log |   at Payments.charge(Payments.java:42)
 */

/** One file, with the time each of its lines starts an entry at (null for the other lines). */
export interface MergeInput {
  name: string;
  lines: string[];
  times: (number | null)[];
}

export interface MergeResult {
  text: string;
  /** The files without a single timestamp: they can't be put in order, so they come last. */
  untimed: string[];
}

/** File names that the prefix of a merged line ends with (see FILE_PREFIX in logs.ts). */
export const MERGED_EXTENSIONS = ['log', 'txt', 'out', 'err', 'json', 'jsonl', 'ndjson'];
const EXTENSION_RE = new RegExp(`\\.(?:${MERGED_EXTENSIONS.join('|')})$`, 'i');

/**
 * A short name for each file, as written in front of its lines: only letters, digits, "_", "-"
 * and ".", ending in a log extension so the viewer reads it back ("build" → "build.log"), and
 * different for two files of the same name ("app.log", "app-2.log").
 */
export function fileLabels(names: string[]): string[] {
  const taken = new Set<string>();
  return names.map((name) => {
    let label =
      name
        .replace(/\.gz$/i, '')
        .replace(/[^\w.-]+/g, '_')
        .replace(/^[.-]+/, '') || 'log';
    if (!EXTENSION_RE.test(label)) label += '.log';
    const dot = label.lastIndexOf('.');
    const [stem, extension] = [label.slice(0, dot), label.slice(dot)];
    for (let n = 2; taken.has(label.toLowerCase()); n++) label = `${stem}-${n}${extension}`;
    taken.add(label.toLowerCase());
    return label;
  });
}

/** A run of lines that belong together: an entry with its stack trace or pretty-printed JSON. */
interface Entry {
  time: number;
  start: number;
  end: number;
}

function entriesOf(input: MergeInput): Entry[] {
  const { lines, times } = input;
  const first = times.find((time) => time !== null) ?? Number.POSITIVE_INFINITY;
  // lines before the first timestamp (a header, say) stay right before the first entry
  const entries: Entry[] = [{ time: first, start: 0, end: 0 }];
  lines.forEach((_, i) => {
    const time = times[i];
    const current = entries[entries.length - 1];
    if (time !== null && time !== undefined && i > current.start) entries.push({ time, start: i, end: i });
    entries[entries.length - 1].end = i + 1;
  });
  return entries.filter((entry) => entry.end > entry.start);
}

/**
 * Interleaves the files by time. Each file keeps its own order (a log is written in order; a
 * timestamp that goes back a little is a thread that was late, not a reason to move lines), and
 * on equal times the file given first goes first.
 */
export function mergeByTime(inputs: MergeInput[]): MergeResult {
  const labels = fileLabels(inputs.map((input) => input.name));
  const width = Math.max(...labels.map((label) => label.length));
  const prefixes = labels.map((label) => `${label.padEnd(width)} | `);
  const files = inputs.map(entriesOf);
  const next = files.map(() => 0);
  const out: string[] = [];
  for (;;) {
    let pick = -1;
    files.forEach((entries, f) => {
      if (next[f] < entries.length && (pick < 0 || entries[next[f]].time < files[pick][next[pick]].time)) pick = f;
    });
    if (pick < 0) break;
    const entry = files[pick][next[pick]++];
    for (let i = entry.start; i < entry.end; i++) out.push(prefixes[pick] + inputs[pick].lines[i]);
  }
  return {
    text: out.length ? `${out.join('\n')}\n` : '',
    untimed: labels.filter((_, f) => !inputs[f].times.some((time) => time !== null)),
  };
}
