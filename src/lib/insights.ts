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
    // a line of a private key's body has nothing a pattern would recognise: Mask hides it whole
    const text = options.mask ? (line.secretBlock ? '****' : options.mask(line.text)) : line.text;
    // a fence longer than any run of backticks in the line, so the line can't close it
    const fence = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((run) => run[0].length + 1)));
    out.push(`  ${fence}`, `  ${text.length > 500 ? `${text.slice(0, 500)}…` : text}`, `  ${fence}`);
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
  const round = (n: number) => Math.round(n * 10) / 10;
  // the unit is chosen after rounding, so 59 999 ms is "1m", not "60s"
  const fits = (n: number, limit: number) => Math.abs(round(n)) < limit;
  if (Math.abs(ms) < 1) return `${Math.round(ms * 1000) / 1000}ms`;
  if (fits(ms, 1000)) return `${round(ms)}ms`;
  if (fits(ms / 1000, 60)) return `${round(ms / 1000)}s`;
  if (fits(ms / 60_000, 60)) return `${round(ms / 60_000)}m`;
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

export type GroupOrder = 'count' | 'first';

/**
 * The groups most often first (as groupErrors gives them), or in the order they first happened:
 * 900 timeouts are often the symptom of the one "pool exhausted" three seconds before them.
 */
export function sortGroups(groups: ErrorGroup[], order: GroupOrder): ErrorGroup[] {
  if (order === 'count') return groups;
  // by time when every group has one (pods' logs one after another), else by where they are in the log
  const timed = groups.every((group) => group.first !== null);
  return [...groups].sort((a, b) => (timed ? a.first! - b.first! : 0) || a.lines[0] - b.lines[0]);
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
const ID_KEY = /^(?:x[_.-]?)?(?:trace|span|request|req|correlation|transaction|txn|order|job|user|tenant)[_.-]?id$/i;
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

// ---- CI steps ----------------------------------------------------------------------------

/** Which CI wrote the step markers. */
export type StepKind = 'gha' | 'gitlab' | 'azure' | 'buildkite' | 'jenkins' | 'buildkit';

/** One step (section, stage) of a CI log, which the viewer folds to its first line. */
export interface LogGroup {
  /** "Run npm test", the header of a GitLab section, a Jenkins stage, "[build 2/4] RUN npm ci". */
  title: string;
  /** Line number of the line that starts it: ##[group], section_start, [Pipeline] { (Build), … */
  start: number;
  /** Line number of its end marker, or of the step's last line before the next step or the log's end. */
  end: number;
  /** ERROR entries inside the step. */
  errors: number;
  kind: StepKind;
  /** 0 for a top-level step, 1 for a section inside one, … */
  depth: number;
  /** How long it took, from the CI's own markers or the times of its lines; null when the log doesn't say. */
  durationMs: number | null;
  /** It has errors, or a command in it exited with a non-zero code. */
  failed: boolean;
  /** The CI asks for it folded (GitLab [collapsed=true], Buildkite ---) or open (Buildkite +++). */
  collapsed?: boolean;
}

/** A step while the log is read: what its duration and failure are worked out from. */
interface Step {
  group: LogGroup;
  /** The GitLab section name, which its section_end repeats. */
  name: string;
  firstTime: number | null;
  firstLine: number;
  lastTime: number | null;
  lastLine: number;
  /** GitLab: epoch seconds in section_start and section_end. */
  markStart: number | null;
  markEnd: number | null;
  /** BuildKit: "#5 DONE 41.3s". */
  markMs: number | null;
  exited: boolean;
}

// a time before the marker: GitHub Actions and GitLab (with its "00O " stream tag), Jenkins' timestamper
const LEADING_TIME =
  /^\[?(?:\d{4}-\d{2}-\d{2}[T ])?\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?\]?\s+(?:\d{2}[OE]\+?\s)?/;
// Buildkite's timestamps, \e_bk;t=1700000000000\a, of which the colour parser takes out only the \e_
// eslint-disable-next-line no-control-regex
const BUILDKITE_TIME = /^(?:bk;t=(\d{10,16})\x07)+/;

// GitHub Actions raw logs, ::group:: as written in a workflow or printed by act
const GHA_START = /^(?:##\[group\]|::group::)(.*)$/;
const GHA_END = /^(?:##\[endgroup\]|::endgroup::)\s*$/;
// GitLab: \e[0Ksection_start:1700000000:step_script[collapsed=true]\r\e[0KStep title
const GITLAB_START = /^section_start:(\d+):([\w.-]+)(\[[^\]]*\])?\s*$/;
const GITLAB_END = /^section_end:(\d+):([\w.-]+)\s*$/;
const AZURE = /^##\[section\](Starting|Finishing): (.*)$/;
// Buildkite: "--- Build" folded, "+++ Tests" open, "~~~ Setup" folded; "^^^ +++" opens the one before
const BUILDKITE = /^(---|\+\+\+|~~~) (.+)$/;
const BUILDKITE_REOPEN = /^\^\^\^ \+\+\+\s*$/;
// what else starts with "--- ": go test results, a diff's file names
const NOT_BUILDKITE = /^(?:--- (?:PASS|FAIL|SKIP|BENCH)\b|(?:---|\+\+\+) (?:[ab]\/|\/dev\/null|\S+\t))/;
// Buildkite's headers often start with an emoji code: "--- :hammer: Build"
const BUILDKITE_EMOJI = /(?:^|\s):[a-z0-9_+-]+:(?=\s|$)/;
// Jenkins: "[Pipeline] { (Build)" opens a stage, "[Pipeline] // stage" closes it; parallel branches aren't stages
const JENKINS_START = /^\[Pipeline\] \{ \((?!Branch: )(.+)\)\s*$/;
const JENKINS_END = /^\[Pipeline\] \/\/ stage\s*$/;
// Docker BuildKit plain progress: "#5 [build 2/4] RUN npm ci", "#5 0.512 …", "#5 DONE 41.3s", "#5 ERROR: …"
const BUILDKIT_HEAD = /^#(\d+) \[.+?\]/;
const BUILDKIT_LINE = /^#(\d+) /;
const BUILDKIT_DONE = /^#\d+ DONE (\d+(?:\.\d+)?)s\b/;
const BUILDKIT_FAILED = /^#\d+ (?:ERROR|CANCELED)\b/;
// a command that failed: GitHub Actions, GitLab, Jenkins, Buildkite, Azure, CircleCI
const EXIT_LINE =
  /^(?:##\[error\](?:Process completed with exit code |\S+ exited with code '?)|ERROR: (?:Job failed: (?:command terminated with )?exit code |script returned exit code )|🚨 Error: The command exited with status |Exited with code exit status )(?!0\b)-?\d+/;
// GitLab sections that run after the script failed: not where it failed
const GITLAB_AFTER_FAILURE = /^(?:after_script|upload_artifacts|archive_cache|cleanup)/;

function lastIndex<T>(items: T[], test: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (test(items[i])) return i;
  return -1;
}

/** A line's text as the step markers are matched: no pod or file prefix, no time before it. */
function stepText(line: LogLine, times: (number | null)[]): string {
  // read on every refresh of a followed log: the regular expressions run only where they can match
  let rest = line.source === null ? line.text : splitSource(line.text).rest;
  let time: number | null = null;
  if (rest.startsWith('bk;t=')) {
    const buildkite = BUILDKITE_TIME.exec(rest);
    if (buildkite) {
      time = Number(buildkite[1]);
      rest = rest.slice(buildkite[0].length);
    }
  }
  times.push(time);
  const c = rest.charCodeAt(0);
  return (c >= 48 && c <= 57) || c === 91 ? rest.replace(LEADING_TIME, '') : rest;
}

/** The first characters a step marker or an exit line can start with: # : s [ - + ~ ^ E 🚨 */
const MARKER_STARTS = new Set([35, 58, 115, 91, 45, 43, 126, 94]);
const EXIT_STARTS = new Set([35, 69, 0xd83d]);

/**
 * The steps of a CI log, which the viewer folds like the CI's own page does: GitHub Actions ##[group]
 * sections, GitLab sections (nested), Azure DevOps sections, Buildkite groups, Jenkins stages and the
 * steps of a Docker BuildKit build, each with how long it took and whether it failed.
 */
export function findGroups(lines: LogLine[]): LogGroup[] {
  const markTimes: (number | null)[] = [];
  const texts = lines.map((line) => stepText(line, markTimes));
  // "--- " and "#1 [" start ordinary lines too. A log is Buildkite's only with two headers and something
  // only Buildkite writes: a +++ or ~~~ header, ^^^ +++, its bk;t= timestamps or an :emoji: in a header.
  // BuildKit's needs two different "#N [" steps. When in doubt, nothing is folded.
  let buildkiteHeads = 0;
  let buildkiteSigns = 0;
  const buildkitIds = new Set<string>();
  texts.forEach((rest, i) => {
    if (markTimes[i] !== null) buildkiteSigns++;
    const c = rest.charCodeAt(0);
    if (c === 94 && BUILDKITE_REOPEN.test(rest)) buildkiteSigns++;
    const head = c === 45 || c === 43 || c === 126 ? BUILDKITE.exec(rest) : null;
    // a diff's file names: "--- x.ts" right before "+++ x.ts"
    const diff = head !== null && head[1] === '+++' && (texts[i - 1] ?? '').startsWith('--- ');
    if (head && !diff && !NOT_BUILDKITE.test(rest)) {
      buildkiteHeads++;
      if (head[1] !== '---' || BUILDKITE_EMOJI.test(head[2])) buildkiteSigns++;
    }
    const step = c === 35 ? BUILDKIT_HEAD.exec(rest) : null;
    if (step) buildkitIds.add(step[1]);
  });
  const buildkite = buildkiteHeads >= 2 && buildkiteSigns > 0;
  const buildkit = buildkitIds.size >= 2;

  const steps: Step[] = [];
  // open GitLab, Azure and Jenkins sections, innermost last
  const stack: Step[] = [];
  // the open GitHub Actions, Buildkite or BuildKit step: the next one ends it
  let flat: Step | null = null;
  // a GitHub Actions step's output goes on after its ##[endgroup], up to the next group
  let ghaTiming: Step | null = null;
  const buildkitSteps = new Map<string, Step>();
  let lastBuildkite: Step | null = null;
  // the line after a GitLab section's header marker is its title
  let wantsTitle: Step | null = null;
  // and after its end marker comes an empty line (the "\r\e[0K" of the marker)
  let justEnded: Step | null = null;

  const start = (kind: StepKind, title: string, line: LogLine, time: number | null): Step => {
    const step: Step = {
      group: {
        title,
        start: line.number,
        end: line.number,
        errors: 0,
        kind,
        depth: stack.length,
        durationMs: null,
        failed: false,
      },
      name: title,
      firstTime: time,
      firstLine: line.number,
      lastTime: time,
      lastLine: line.number,
      markStart: null,
      markEnd: null,
      markMs: null,
      exited: false,
    };
    steps.push(step);
    return step;
  };
  const time = (step: Step, line: LogLine, at: number | null) => {
    if (at === null) return;
    if (step.firstTime === null) {
      step.firstTime = at;
      step.firstLine = line.number;
    }
    step.lastTime = at;
    step.lastLine = line.number;
  };
  // a line inside the step
  const see = (step: Step, line: LogLine, rest: string, at: number | null) => {
    step.group.end = line.number;
    if (line.level === 'ERROR' && !line.continuation) step.group.errors++;
    if (EXIT_STARTS.has(rest.charCodeAt(0)) && EXIT_LINE.test(rest)) step.exited = true;
    time(step, line, at);
  };
  const push = (step: Step) => {
    flat = null;
    stack.push(step);
  };
  // closes the section at `index` of the stack and the ones inside it, on this line
  const close = (index: number, line: LogLine, rest: string, at: number | null) => {
    const from = stack[index].group.start;
    for (const step of stack.splice(index)) see(step, line, rest, at);
    if (flat && flat.group.start > from) flat = null;
    if (ghaTiming && ghaTiming.group.start > from) ghaTiming = null;
  };

  lines.forEach((line, i) => {
    const rest = texts[i];
    const at = line.time ?? markTimes[i];
    const marker = MARKER_STARTS.has(rest.charCodeAt(0));
    if (wantsTitle) {
      if (rest.trim() && !GITLAB_START.test(rest) && !GITLAB_END.test(rest)) wantsTitle.group.title = rest.trim();
      wantsTitle = null;
    }
    if (justEnded && rest === '') justEnded.group.end = line.number;
    justEnded = null;

    let started: Step | null = null;
    let closed = false;
    let m: RegExpExecArray | null;
    if (!marker) {
      // an ordinary line
    } else if ((m = GITLAB_START.exec(rest))) {
      started = start('gitlab', m[2], line, at);
      started.markStart = Number(m[1]);
      if (/collapsed=true/.test(m[3] ?? '')) started.group.collapsed = true;
      wantsTitle = started;
    } else if ((m = GITLAB_END.exec(rest))) {
      const name = m[2];
      const index = lastIndex(stack, (s) => s.group.kind === 'gitlab' && s.name === name);
      if (index >= 0) {
        const step = stack[index];
        step.markEnd = Number(m[1]);
        close(index, line, rest, at);
        justEnded = step;
        closed = true;
      }
    } else if ((m = AZURE.exec(rest))) {
      const title = m[2].trim();
      if (m[1] === 'Starting') started = start('azure', title, line, at);
      else {
        const index = lastIndex(stack, (s) => s.group.kind === 'azure' && s.name === title);
        if (index >= 0) {
          close(index, line, rest, at);
          closed = true;
        }
      }
    } else if ((m = JENKINS_START.exec(rest))) {
      started = start('jenkins', m[1].trim(), line, at);
    } else if (JENKINS_END.test(rest)) {
      const index = lastIndex(stack, (s) => s.group.kind === 'jenkins');
      if (index >= 0) {
        close(index, line, rest, at);
        closed = true;
      }
    } else if ((m = GHA_START.exec(rest))) {
      started = ghaTiming = start('gha', m[1].trim(), line, at);
    } else if (GHA_END.test(rest) && flat?.group.kind === 'gha') {
      see(flat, line, rest, at);
      flat = null;
      closed = true;
    } else if (buildkite && BUILDKITE_REOPEN.test(rest)) {
      if (lastBuildkite) lastBuildkite.group.collapsed = false;
    } else if (buildkite && (m = BUILDKITE.exec(rest)) && !NOT_BUILDKITE.test(rest)) {
      started = lastBuildkite = start('buildkite', m[2].trim(), line, at);
      started.group.collapsed = m[1] !== '+++';
    } else if (buildkit && (m = BUILDKIT_LINE.exec(rest))) {
      const id = m[1];
      const step = buildkitSteps.get(id);
      if (!step && BUILDKIT_HEAD.test(rest)) {
        started = start('buildkit', rest.slice(m[0].length).trim(), line, at);
        buildkitSteps.set(id, started);
      } else if (step) {
        const done = BUILDKIT_DONE.exec(rest);
        if (done) step.markMs = Math.round(Number(done[1]) * 1000);
        if (BUILDKIT_FAILED.test(rest)) step.exited = true;
      }
    }

    if (started) {
      if (started.group.kind === 'gitlab' || started.group.kind === 'azure' || started.group.kind === 'jenkins') {
        for (const step of stack) see(step, line, rest, at);
        push(started);
        return;
      }
      for (const step of stack) see(step, line, rest, at);
      flat = started;
      return;
    }
    for (const step of stack) see(step, line, rest, at);
    // a BuildKit step holds only its own "#N …" lines: what comes after the build isn't in it
    const inFlat = flat !== null && !closed && (flat.group.kind !== 'buildkit' || BUILDKIT_LINE.test(rest));
    if (inFlat) see(flat!, line, rest, at);
    if (ghaTiming && ghaTiming !== flat) time(ghaTiming, line, at);
    if (stack.length === 0 && !inFlat && !closed && EXIT_STARTS.has(rest.charCodeAt(0)) && EXIT_LINE.test(rest)) {
      // "ERROR: Job failed: exit code 1" after the last section: the last step with lines failed
      let last: Step | null = null;
      for (const step of steps) {
        if (step.group.end <= step.group.start) continue;
        if (step.group.kind === 'gitlab' && GITLAB_AFTER_FAILURE.test(step.name)) continue;
        if (!last || step.group.end >= last.group.end) last = step;
      }
      if (last) last.exited = true;
    }
  });

  return steps.map((step) => {
    const group = step.group;
    if (step.markMs !== null) group.durationMs = step.markMs;
    else if (step.markStart !== null && step.markEnd !== null && step.markEnd >= step.markStart)
      group.durationMs = (step.markEnd - step.markStart) * 1000;
    else if (
      step.firstTime !== null &&
      step.lastTime !== null &&
      step.lastLine > step.firstLine &&
      step.lastTime >= step.firstTime
    )
      group.durationMs = step.lastTime - step.firstTime;
    group.failed = group.errors > 0 || step.exited;
    return group;
  });
}

/** Leaves out the lines inside closed steps (and the steps in them); a step's first line stays as its header. */
export function foldGroups<T extends LogLine>(lines: T[], groups: LogGroup[], open: Set<number>): T[] {
  const closed = groups.filter((g) => !open.has(g.start) && g.end > g.start).sort((a, b) => a.start - b.start);
  if (closed.length === 0) return lines;
  // the hidden line ranges, (start, end], with nested and touching ones merged
  const hidden: [number, number][] = [];
  for (const g of closed) {
    const last = hidden[hidden.length - 1];
    if (last && g.start <= last[1]) last[1] = Math.max(last[1], g.end);
    else hidden.push([g.start, g.end]);
  }
  let i = 0;
  return lines.filter((line) => {
    while (i < hidden.length && hidden[i][1] < line.number) i++;
    const range = hidden[i];
    return !range || line.number <= range[0] || line.number > range[1];
  });
}

/** How long a step took, as CI pages write it: 250ms, 5s, 41.3s, 3m 12s, 1h 5m. */
export function formatStepDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${Math.floor(ms / 100) / 10}s`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
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
  /** Masks secrets in the cell values; the column says what a bare value is (password, token). */
  mask?: (value: string, column: string) => string;
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
    const formatted = cells.map((cell, i) => {
      const masked = options?.mask ? options.mask(cell, columns[i]) : cell;
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
