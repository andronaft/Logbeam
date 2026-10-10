import { commonFields, filterByFields, parseFieldQuery } from '../lib/fields';
import { displayName, readLogFile } from '../lib/files';
import {
  CollapsedLine,
  LEVELS,
  Level,
  LogLine,
  collapseRepeats,
  countByLevel,
  filterLines,
  formatGap,
  LogParser,
  ParseOptions,
  splitLines,
  splitSource,
} from '../lib/logs';
import {
  Bookmark,
  TimeMode,
  appendedText,
  bookmarkReport,
  defaultColumns,
  fieldStats,
  formatTime,
  groupErrors,
  isMostlyJson,
  lineFields,
  localizeTimestamp,
  tableCells,
} from '../lib/insights';
import { findSecrets, maskSecrets, setCustomSecretPatterns } from '../lib/secrets';
import { loadSettings, saveSettings } from '../shared/settings';
import { applyTheme } from '../shared/theme';
import { Range, searchRanges, toSegments } from '../lib/segments';
import { buildTimeline } from '../lib/timeline';
import { parseLogAsync } from './parseAsync';
import { COMPARE_ADD } from '../shared/compare';
import { RegexSearch } from './regexSearch';
import { VIEWER_CSS } from './viewerStyles';

/**
 * Replaces the current page with a log viewer. Rows have a fixed height and only the
 * visible ones (plus a small buffer) are in the DOM, so 100k+ line logs stay smooth.
 * Everything is built from DOM nodes, never innerHTML, so it also works on pages that
 * enforce Trusted Types (GitHub, Google).
 */

const ROW_HEIGHT = 20;
const OVERSCAN = 30;
/** Pods with their own chip and colour; more than this and the chips would fill the screen. */
const MAX_SOURCES = 24;
const MAX_HIGHLIGHTS = 5;
const LINE_HASH = /^#L(\d+)$/;
/** Highlighting only looks at the start of very long lines (a minified bundle, say); rows don't wrap anyway. */
const HIGHLIGHT_LIMIT = 5000;

interface State {
  levels: Set<Level>;
  includeUnknown: boolean;
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  collapse: boolean;
  showGaps: boolean;
  maskSecrets: boolean;
  showTimeline: boolean;
  /** Why the current search can't run (invalid or too slow regex); empty when it's fine. */
  searchError: string;
  selected: number | null;
  /** Only entries in this time range, chosen by dragging across the timeline. */
  timeRange: [number, number] | null;
  /** Pods or containers switched off with their chips. */
  hiddenSources: Set<string>;
  /** Terms pinned with their own colour, independent of the search. */
  highlights: string[];
  /** Bookmarked line numbers and their notes. */
  bookmarks: Map<number, string>;
  timeMode: TimeMode;
  /** Only the entries of this error group (see Groups). */
  group: { key: string; lines: Set<number>; label: string } | null;
  /** JSON records as a table with these columns. */
  table: string[] | null;
}

/** How often Follow reads the page again. */
const FOLLOW_INTERVAL_MS = 3000;

type Child = Node | string;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = Object.assign(document.createElement(tag), props);
  element.append(...children);
  return element;
}

export function readPageText(): string {
  const body = document.body;
  // Chrome shows text/plain documents as <body><pre>…</pre></body>
  const onlyPre = body && body.children.length === 1 && body.firstElementChild instanceof HTMLPreElement;
  if (onlyPre) {
    return (body.firstElementChild as HTMLPreElement).textContent ?? '';
  }
  return body?.innerText ?? '';
}

function resetDocument(title: string): HTMLBodyElement {
  document.documentElement.replaceChildren();
  const head = el(
    'head',
    {},
    el('meta', { name: 'viewport', content: 'width=device-width' } as Partial<HTMLMetaElement>),
    el('title', {}, `${title} — Logbeam`),
    el('style', {}, VIEWER_CSS),
  );
  const body = el('body');
  document.documentElement.append(head, body);
  return body;
}

/** Stops the listeners of the previous viewer when a dropped file opens a new one. */
let previousViewer: AbortController | null = null;

/** The extension's own viewer page, for pasted text and files, rather than a web page. */
const ON_EXTENSION_PAGE = /^(chrome|moz)-extension:$/.test(location.protocol);

export async function openViewer(text: string = readPageText(), name?: string): Promise<void> {
  previousViewer?.abort();
  const viewer = new AbortController();
  previousViewer = viewer;
  // the page is about to be replaced; "Compare…" in the context menu reads the log from here
  (window as unknown as { __logbeamLogText?: string }).__logbeamLogText = text;
  const title = name ?? (document.title || location.pathname.split('/').pop() || 'log');
  const body = resetDocument(title);

  const bar = el('div', { className: 'progress-bar' });
  const label = el('div', { className: 'loading-label' }, 'Parsing log…');
  body.append(
    el(
      'div',
      { className: 'loading' },
      el('span', { className: 'brand' }, 'Logbeam'),
      label,
      el('div', { className: 'progress' }, bar),
    ),
  );

  const settings = await loadSettings();
  applyTheme(settings.theme);
  const parseOptions = { customLevels: settings.customLevels };
  const lines = await parseLogAsync(
    text,
    (done, total) => {
      bar.style.width = `${Math.round((done / total) * 100)}%`;
      label.textContent = `Parsing log… ${done.toLocaleString()} / ${total.toLocaleString()} lines`;
    },
    parseOptions,
  );
  setCustomSecretPatterns(settings.customSecrets);
  if (settings.customSecrets.some((custom) => custom.pattern.trim())) {
    // the worker parsed without the user's own patterns: mark those lines here
    for (const line of lines) {
      if (!line.secret && findSecrets(line.text.slice(0, HIGHLIGHT_LIMIT)).length > 0) line.secret = true;
    }
  }
  body.replaceChildren();
  buildViewer(body, lines, {
    text,
    title,
    gapThreshold: settings.gapThresholdMs,
    timeMode: settings.timeMode,
    parseOptions,
    signal: viewer.signal,
  });
}

/** Opens a dropped or chosen file (plain or gzip) in the viewer, replacing the current log. */
export async function openFile(file: File): Promise<void> {
  await openViewer(await readLogFile(file), displayName(file.name));
}

interface ViewerOptions {
  text: string;
  title: string;
  gapThreshold: number;
  timeMode: TimeMode;
  parseOptions: ParseOptions;
  signal: AbortSignal;
}

/**
 * The time of the entry each line belongs to: continuation lines and lines without a timestamp
 * take the time of the entry above, so a time range keeps whole stack traces.
 */
function entryTimes(lines: LogLine[]): Float64Array {
  const times = new Float64Array(lines.length);
  let current = Number.NaN;
  lines.forEach((line, i) => {
    if (line.time !== null) current = line.time;
    times[i] = current;
  });
  return times;
}

function buildViewer(body: HTMLElement, allLines: LogLine[], options: ViewerOptions): void {
  const { signal, gapThreshold } = options;
  // these change when Follow adds lines
  let counts = countByLevel(allLines);
  let secretCount = allLines.filter((l) => l.secret).length;
  let timeline = buildTimeline(allLines);

  const state: State = {
    levels: new Set(LEVELS),
    includeUnknown: true,
    query: '',
    regex: false,
    caseSensitive: false,
    collapse: false,
    showGaps: true,
    maskSecrets: false,
    searchError: '',
    showTimeline: timeline !== null,
    selected: null,
    timeRange: null,
    hiddenSources: new Set(),
    highlights: [],
    bookmarks: new Map(),
    timeMode: options.timeMode,
    group: null,
    table: null,
  };
  let times = entryTimes(allLines);
  const sources = [...new Set(allLines.map((l) => l.source).filter((s): s is string => s !== null))];
  const sourceIndex = new Map(sources.map((source, i) => [source, i]));
  const fields = commonFields(allLines);
  let visible: CollapsedLine[] = [];

  // ---- toolbar ----------------------------------------------------------------------------
  const chipCounts: Partial<Record<Level | 'UNKNOWN', [HTMLButtonElement, HTMLSpanElement]>> = {};
  const chip = (key: Level | 'UNKNOWN', text: string) => {
    const count = el('span', { className: 'count' }, String(counts[key]));
    const button = el('button', { className: `chip lvl-${key} on`, title: `Show/hide ${text}` }, `${text} `, count);
    chipCounts[key] = [button, count];
    button.addEventListener('click', () => {
      if (key === 'UNKNOWN') state.includeUnknown = !state.includeUnknown;
      else if (state.levels.has(key)) state.levels.delete(key);
      else state.levels.add(key);
      button.classList.toggle('on');
      void refresh();
    });
    button.hidden = counts[key] === 0; // nothing to filter
    return button;
  };
  const toggleButton = (text: string, title: string, on: boolean, apply: () => void) => {
    const button = el('button', { className: `toggle${on ? ' on' : ''}`, title }, text);
    button.addEventListener('click', () => {
      button.classList.toggle('on');
      apply();
      void refresh();
    });
    return button;
  };

  const search = el('input', {
    type: 'search',
    placeholder: fields.length ? `Search, or ${fields[0]}=… ( / )` : 'Search… ( / )',
    title: 'Text to find, or fields: level=error service=payments duration>500 (key=value, !=, >, <, * wildcards)',
    className: 'search',
    spellcheck: false,
  });
  search.setAttribute('list', 'logbeam-fields');
  // suggestions for field filters: "status=", "service=", …
  const fieldList = el(
    'datalist',
    { id: 'logbeam-fields' },
    ...fields.slice(0, 30).map((key) => el('option', { value: `${key}=` })),
  );
  const highlightButton = el(
    'button',
    { className: 'toggle', title: 'Keep this text highlighted in its own colour ( Enter in the search box )' },
    '🖍',
  );
  const regexToggle = toggleButton('.*', 'Regular expression', false, () => (state.regex = !state.regex));
  const caseToggle = toggleButton('Aa', 'Match case', false, () => (state.caseSensitive = !state.caseSensitive));
  const collapseToggle = toggleButton(
    'Collapse',
    'Collapse repeated lines (×N)',
    false,
    () => (state.collapse = !state.collapse),
  );
  const gapsToggle = toggleButton(
    'Gaps',
    `Show pauses longer than ${gapThreshold / 1000}s`,
    true,
    () => (state.showGaps = !state.showGaps),
  );
  const timelineToggle = toggleButton('Timeline', 'Errors and warnings over time', state.showTimeline, () => {
    state.showTimeline = !state.showTimeline;
    timelineEl.hidden = !state.showTimeline;
  });
  timelineToggle.hidden = timeline === null;
  const maskToggle = toggleButton(
    'Mask',
    'Hide secret values on screen and in copied text',
    false,
    () => (state.maskSecrets = !state.maskSecrets),
  );
  const secretsButton = el(
    'button',
    { className: 'toggle secrets', title: 'Lines that show keys, tokens or passwords. Jump to the next one ( s )' },
    `🔑 ${secretCount}`,
  );
  const secretsGroup = el('span', { className: 'group' }, secretsButton, maskToggle);
  secretsGroup.hidden = secretCount === 0;
  const nextError = el('button', { className: 'toggle', title: 'Jump to the next error ( e )' }, 'Next error');
  const copyButton = el('button', { className: 'toggle', title: 'Copy visible lines' }, 'Copy');
  const compareButton = el(
    'button',
    { className: 'toggle', title: 'Compare this log with another one, e.g. a passing and a failing CI run' },
    'Compare',
  );
  // only as an extension content script (not when a test injects the viewer into the page)
  compareButton.hidden = typeof chrome === 'undefined' || !chrome.runtime?.id;
  const saveButton = el('button', { className: 'toggle', title: 'Download the visible lines as a file' }, 'Save');
  const fileInput = el('input', { type: 'file', hidden: true });
  const openButton = el('button', { className: 'toggle', title: 'Open a .log or .gz file (or drop it here)' }, 'Open…');
  const rawButton = el('button', { className: 'toggle', title: 'Back to the original page' }, 'Raw');
  // the extension's viewer page shows pasted text or a file: there is no original page to go back to
  rawButton.hidden = ON_EXTENSION_PAGE;
  openButton.hidden = !ON_EXTENSION_PAGE;
  const status = el('span', { className: 'status' });

  const timeButton = el('button', {
    className: 'toggle',
    title: 'Show times in UTC or in your time zone (timestamps with a zone, the inspector and the timeline)',
  });
  const bookmarksButton = el('button', { className: 'toggle bookmarks', title: 'Jump to the next bookmark ( b )' });
  const reportButton = el(
    'button',
    { className: 'toggle', title: 'Copy the bookmarked lines with times and notes, as Markdown for a ticket' },
    'Report',
  );
  const groupsButton = el(
    'button',
    { className: 'toggle', title: 'The same error grouped: how often, in which pods, first and last time' },
    'Groups',
  );
  const tableToggle = el('button', { className: 'toggle', title: 'Show JSON records as a table' }, 'Table');
  tableToggle.hidden = !isMostlyJson(allLines);
  const followToggle = el(
    'button',
    { className: 'toggle', title: `Read the page again every ${FOLLOW_INTERVAL_MS / 1000}s and add new lines` },
    'Follow',
  );
  // only a log served over http(s) can be read again
  followToggle.hidden = ON_EXTENSION_PAGE || !/^https?:$/.test(location.protocol);

  // second row: what narrows the view besides levels and search
  const rangeChip = el('button', { className: 'toggle on range', title: 'Show all times again' });
  const highlightChips = el('span', { className: 'group' });
  const sourceChips = el('span', { className: 'group sources' });
  const sourceButtons = sources.slice(0, MAX_SOURCES).map((source, i) => {
    const button = el('button', { className: `chip on src-${i % 8}`, title: `Show/hide lines from ${source}` }, source);
    button.addEventListener('click', () => {
      if (state.hiddenSources.has(source)) state.hiddenSources.delete(source);
      else state.hiddenSources.add(source);
      button.classList.toggle('on');
      void refresh();
    });
    return button;
  });
  sourceChips.append(...sourceButtons);
  const groupChip = el('button', { className: 'toggle on group-chip', title: 'Show all lines again' });
  const columnsInput = el('input', {
    className: 'columns',
    title: 'Table columns, separated by commas',
    spellcheck: false,
  });
  const columnsLabel = el('label', { className: 'columns-label' }, 'Columns ', columnsInput);
  const subbar = el('div', { className: 'subbar' }, rangeChip, groupChip, columnsLabel, highlightChips, sourceChips);

  const toolbar = el(
    'header',
    { className: 'toolbar' },
    el('span', { className: 'brand' }, 'Logbeam'),
    chip('ERROR', 'Error'),
    chip('WARN', 'Warn'),
    chip('INFO', 'Info'),
    chip('DEBUG', 'Debug'),
    chip('TRACE', 'Trace'),
    chip('UNKNOWN', 'Other'),
    el('span', { className: 'group' }, search, highlightButton, regexToggle, caseToggle),
    collapseToggle,
    gapsToggle,
    timelineToggle,
    secretsGroup,
    nextError,
    groupsButton,
    tableToggle,
    timeButton,
    el('span', { className: 'group' }, bookmarksButton, reportButton),
    followToggle,
    copyButton,
    saveButton,
    compareButton,
    openButton,
    fileInput,
    rawButton,
    status,
    fieldList,
  );

  // ---- timeline -------------------------------------------------------------------------
  const timelineEl = el('div', { className: 'timeline' });
  timelineEl.hidden = !state.showTimeline;
  function drawTimeline(): void {
    timelineEl.replaceChildren();
    const current = timeline;
    if (!current) return;
    const fmt = (t: number) => formatTime(t, state.timeMode).slice(0, 19);
    current.buckets.forEach((bucket, i) => {
      const height = (n: number) => `${Math.round((n / current.max) * 100)}%`;
      const other = bucket.total - bucket.errors - bucket.warnings;
      const bar = el(
        'button',
        {
          className: 'bucket',
          title: `${fmt(bucket.from)} – ${fmt(bucket.to)}\n${bucket.total} entries, ${bucket.errors} errors, ${bucket.warnings} warnings`,
        },
        el('span', { className: 'b-err' }),
        el('span', { className: 'b-warn' }),
        el('span', { className: 'b-other' }),
      );
      (bar.children[0] as HTMLElement).style.height = height(bucket.errors);
      (bar.children[1] as HTMLElement).style.height = height(bucket.warnings);
      (bar.children[2] as HTMLElement).style.height = height(other);
      // a click jumps there; dragging across bars keeps only that time range
      bar.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        drag = { from: i, to: i };
        markDrag();
      });
      bar.addEventListener('pointerenter', () => {
        if (!drag) return;
        drag.to = i;
        markDrag();
      });
      timelineEl.append(bar);
    });
  }
  drawTimeline();
  document.addEventListener(
    'pointerup',
    () => {
      const current = timeline;
      if (!drag || !current) return;
      const [first, last] = [Math.min(drag.from, drag.to), Math.max(drag.from, drag.to)];
      drag = null;
      markDrag();
      if (first === last) {
        const index = visible.findIndex((l) => l.time !== null && l.time >= current.buckets[first].from);
        if (index >= 0) scrollToIndex(index, true);
        return;
      }
      state.timeRange = [current.buckets[first].from, current.buckets[last].to];
      void refresh();
    },
    { signal },
  );
  let drag: { from: number; to: number } | null = null;
  function markDrag(): void {
    const buckets = timelineEl.children;
    const range = state.timeRange;
    for (let i = 0; i < buckets.length && timeline; i++) {
      const bucket = timeline.buckets[i];
      const dragging = drag !== null && i >= Math.min(drag.from, drag.to) && i <= Math.max(drag.from, drag.to);
      const inRange = range !== null && bucket.to > range[0] && bucket.from < range[1];
      buckets[i].classList.toggle('dragging', dragging);
      buckets[i].classList.toggle('outside', range !== null && !inRange && !dragging);
    }
  }

  // ---- rows and inspector ---------------------------------------------------------------
  const spacer = el('div', { className: 'spacer' });
  const rows = el('div', { className: 'rows' });
  const scroller = el('main', { className: 'scroller', tabIndex: 0 }, spacer, rows);
  const inspector = el('aside', { className: 'inspector' });
  inspector.hidden = true;
  const groupsPanel = el('aside', { className: 'groups' });
  groupsPanel.hidden = true;
  const toast = el('div', { className: 'toast' });
  const dropHint = el('div', { className: 'drop-hint' }, 'Drop a .log or .gz file to open it');
  body.append(toolbar, subbar, timelineEl, groupsPanel, scroller, inspector, toast, dropHint);

  const displayText = (line: LogLine) => {
    const text = localizeTimestamp(line.text, state.timeMode);
    if (!state.maskSecrets || !line.secret) return text;
    // a line of a private key's base64 body has nothing recognisable to mask piece by piece
    return line.secretBlock ? '****' : maskSecrets(text);
  };

  async function copy(text: string, message: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      showToast(message);
    } catch {
      showToast('Copy failed: the page doesn’t allow clipboard access');
    }
  }

  function showToast(message: string): void {
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 1600);
  }

  function lineLink(number: number): string {
    return `${location.href.split('#')[0]}#L${number}`;
  }

  function appendText(parent: HTMLElement, line: LogLine): void {
    const text = displayText(line);
    const head = text.length > HIGHLIGHT_LIMIT ? text.slice(0, HIGHLIGHT_LIMIT) : text;
    const query = fieldMode ? '' : state.query;
    const ranges: Range[] = state.searchError ? [] : searchRanges(head, query, state.regex, state.caseSensitive, 'match');
    state.highlights.forEach((term, i) => ranges.push(...searchRanges(head, term, false, false, `hl hl-${i}`)));
    // colours from ANSI codes, unless the shown text was changed (masked, local time)
    if (line.ansi && text === line.text) ranges.push(...line.ansi);
    if (line.source !== null) {
      const prefix = text.length - splitSource(text).rest.length;
      ranges.push({ start: 0, end: prefix, cls: `src src-${(sourceIndex.get(line.source) ?? 0) % 8}` });
    }
    if (line.secret && !state.maskSecrets) {
      if (line.secretBlock) {
        ranges.push({ start: 0, end: text.length, cls: 'secret' });
      } else {
        for (const secret of findSecrets(head)) {
          ranges.push({ start: secret.start, end: secret.end, cls: 'secret' });
        }
      }
    }
    for (const segment of toSegments(text, ranges)) {
      parent.append(segment.classes.length ? el('span', { className: segment.classes.join(' ') }, segment.text) : segment.text);
    }
  }

  function renderInspector(): void {
    const line = state.selected === null ? undefined : allLines[state.selected - 1];
    inspector.hidden = !line;
    if (!line) return;
    const facts: Child[] = [`Line ${line.number}`];
    if (line.level) facts.push(' · ', el('b', { className: `lvl-${line.level}` }, line.level));
    if (line.time !== null) facts.push(` · ${formatTime(line.time, state.timeMode)}`);
    if (line.gap !== null) facts.push(` · ${formatGap(line.gap)} after previous entry`);
    if (line.secret) facts.push(' · ', el('b', { className: 'secret-note' }, '🔑 contains a secret'));

    const copyLine = el('button', { className: 'toggle' }, 'Copy line');
    copyLine.addEventListener('click', () => void copy(displayText(line), 'Line copied'));
    const copyLink = el('button', { className: 'toggle' }, 'Copy link');
    copyLink.addEventListener('click', () => void copy(lineLink(line.number), 'Link copied'));
    const close = el('button', { className: 'toggle', title: 'Close ( Esc )' }, '×');
    close.addEventListener('click', () => select(null));
    const marked = state.bookmarks.has(line.number);
    const bookmark = el(
      'button',
      { className: `toggle${marked ? ' on' : ''}`, title: 'Bookmark this line for the report ( m )' },
      marked ? '★ Bookmarked' : '☆ Bookmark',
    );
    bookmark.addEventListener('click', () => toggleBookmark(line.number));

    const text = el('pre', { className: 'full-text' });
    appendText(text, line);
    const parts: Child[] = [
      el(
        'div',
        { className: 'inspector-head' },
        el('span', { className: 'facts' }, ...facts),
        bookmark,
        copyLine,
        copyLink,
        close,
      ),
      text,
    ];
    if (marked) {
      const note = el('input', {
        className: 'note',
        value: state.bookmarks.get(line.number) ?? '',
        placeholder: 'Note for the report, e.g. “the timeout starts here”',
      });
      note.addEventListener('input', () => {
        state.bookmarks.set(line.number, note.value);
        saveBookmarks();
      });
      parts.push(note);
    }
    const keys = lineFields(line);
    if (keys.length > 0) {
      const statsBox = el('div', { className: 'stats' });
      const buttons = keys.slice(0, 40).map((key) => {
        const button = el('button', { className: 'field', title: `Most common values of ${key} in the shown lines` }, key);
        button.addEventListener('click', () => showStats(statsBox, key));
        return button;
      });
      parts.push(el('div', { className: 'fields' }, el('span', { className: 'facts' }, 'Fields: '), ...buttons), statsBox);
    }
    if (line.json) {
      const json = JSON.stringify(line.json, null, 2);
      parts.push(el('pre', { className: 'json' }, state.maskSecrets ? maskSecrets(json) : json));
    }
    inspector.replaceChildren(...parts);
  }

  /** Top values of a field over the lines shown now; click a value to filter by it. */
  function showStats(box: HTMLElement, key: string): void {
    const { values, total } = fieldStats(visible, key);
    const max = values[0]?.count ?? 1;
    box.replaceChildren(
      el('div', { className: 'stats-head' }, `${key}: ${total.toLocaleString()} of the shown entries have it`),
      ...values.map(({ value, count }) => {
        const bar = el('span', { className: 'bar' });
        bar.style.width = `${Math.max(2, Math.round((count / max) * 100))}%`;
        const row = el(
          'button',
          { className: 'stat', title: `Show only ${key}=${value}` },
          el('span', { className: 'value' }, value || '""'),
          el('span', { className: 'bar-wrap' }, bar),
          el('span', { className: 'n' }, `×${count.toLocaleString()}`),
        );
        row.addEventListener('click', () => {
          const quoted = /[\s"]/.test(value) || value === '' ? JSON.stringify(value) : value;
          search.value = `${key}=${quoted}`;
          state.query = search.value;
          void refresh();
        });
        return row;
      }),
    );
  }

  // bookmarks are kept for this page while the browser is open (in memory, not on disk)
  const bookmarksKey = `bookmarks:${location.href.split('#')[0]}`;
  function saveBookmarks(): void {
    try {
      void chrome.storage.session.set({ [bookmarksKey]: [...state.bookmarks] }).catch(() => undefined);
    } catch {
      // the viewer injected into a page without extension APIs (tests)
    }
  }
  async function loadBookmarks(): Promise<void> {
    try {
      const data = await chrome.storage.session.get(bookmarksKey);
      const saved = data[bookmarksKey] as [number, string][] | undefined;
      if (saved?.length && !ON_EXTENSION_PAGE) {
        state.bookmarks = new Map(saved.filter(([line]) => line <= allLines.length));
        updateBookmarkButtons();
        render();
      }
    } catch {
      // as above
    }
  }
  function toggleBookmark(number: number): void {
    if (state.bookmarks.has(number)) state.bookmarks.delete(number);
    else state.bookmarks.set(number, '');
    saveBookmarks();
    updateBookmarkButtons();
    renderInspector();
    render();
  }
  function updateBookmarkButtons(): void {
    bookmarksButton.textContent = `★ ${state.bookmarks.size}`;
    bookmarksButton.hidden = reportButton.hidden = state.bookmarks.size === 0;
  }

  function renderGroups(): void {
    const groups = groupErrors(allLines);
    const items = groups.slice(0, 50).map((group) => {
      const where = group.sources.length ? ` · ${group.sources.length} pod${group.sources.length > 1 ? 's' : ''}` : '';
      const when =
        group.first !== null && group.last !== null && group.last > group.first
          ? ` · ${formatTime(group.first, state.timeMode).slice(11, 19)}–${formatTime(group.last, state.timeMode).slice(11, 19)}`
          : '';
      const item = el(
        'button',
        { className: 'group-item', title: 'Show only this error' },
        el('span', { className: 'n' }, `×${group.count}`),
        el('span', { className: 'sample' }, group.sample),
        el('span', { className: 'meta' }, `${where}${when}`),
      );
      item.addEventListener('click', () => {
        state.group = { key: group.key, lines: new Set(group.lines), label: `×${group.count} ${group.sample.slice(0, 60)}` };
        void refresh().then(() => {
          const index = visible.findIndex((l) => l.number === group.lines[0]);
          if (index >= 0) scrollToIndex(index, true);
        });
      });
      return item;
    });
    groupsPanel.replaceChildren(
      el('div', { className: 'groups-head' }, `${groups.length} different errors`),
      ...(items.length ? items : [el('div', { className: 'facts' }, 'No errors in this log.')]),
    );
  }

  function select(number: number | null): void {
    state.selected = number;
    history.replaceState(null, '', number === null ? location.pathname + location.search : `#L${number}`);
    renderInspector();
    render();
  }

  // ---- behaviour --------------------------------------------------------------------------
  let debounce: number | undefined;
  search.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = window.setTimeout(() => {
      state.query = search.value;
      void refresh();
    }, 150);
  });

  function addHighlight(): void {
    const term = search.value.trim();
    if (!term || state.highlights.includes(term)) return;
    if (state.highlights.length >= MAX_HIGHLIGHTS) state.highlights.shift();
    state.highlights.push(term);
    search.value = '';
    state.query = '';
    void refresh();
  }
  highlightButton.addEventListener('click', addHighlight);
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') addHighlight();
  });
  rangeChip.addEventListener('click', () => {
    state.timeRange = null;
    void refresh();
  });

  saveButton.addEventListener('click', () => {
    const blob = new Blob([visible.map(displayText).join('\n') + '\n'], { type: 'text/plain' });
    const link = el('a', {
      href: URL.createObjectURL(blob),
      download: `${options.title.replace(/[\\/:*?"<>|]+/g, '_').replace(/\.log$/i, '')}.filtered.log`,
    });
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    showToast(`${visible.length.toLocaleString()} lines saved`);
  });

  // open or drop a file (plain or .gz) to replace this log
  const openChosen = (file: File | undefined) => {
    if (file) void openFile(file).catch((error) => showToast(`Couldn’t open ${file.name}: ${(error as Error).message}`));
  };
  openButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => openChosen(fileInput.files?.[0]));
  const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
  document.addEventListener(
    'dragover',
    (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dropHint.classList.add('show');
    },
    { signal },
  );
  document.addEventListener(
    'dragleave',
    (event) => {
      if (!event.relatedTarget) dropHint.classList.remove('show');
    },
    { signal },
  );
  document.addEventListener(
    'drop',
    (event) => {
      dropHint.classList.remove('show');
      if (!hasFiles(event)) return;
      event.preventDefault();
      openChosen(event.dataTransfer?.files[0]);
    },
    { signal },
  );

  nextError.addEventListener('click', () => jumpToNext((l) => l.level === 'ERROR' && !l.continuation));
  bookmarksButton.addEventListener('click', () => jumpToNext((l) => state.bookmarks.has(l.number)));
  reportButton.addEventListener('click', () => {
    const bookmarks: Bookmark[] = [...state.bookmarks].map(([line, note]) => ({ line, note }));
    const report = bookmarkReport(bookmarks, allLines, {
      title: options.title,
      url: ON_EXTENSION_PAGE ? '' : location.href.split('#')[0],
      timeMode: state.timeMode,
      mask: state.maskSecrets ? maskSecrets : undefined,
    });
    void copy(report, `Report with ${bookmarks.length} line${bookmarks.length > 1 ? 's' : ''} copied`);
  });
  groupsButton.addEventListener('click', () => {
    groupsPanel.hidden = !groupsPanel.hidden;
    groupsButton.classList.toggle('on', !groupsPanel.hidden);
    if (!groupsPanel.hidden) renderGroups();
  });
  groupChip.addEventListener('click', () => {
    state.group = null;
    void refresh();
  });
  tableToggle.addEventListener('click', () => {
    state.table = state.table ? null : defaultColumns(allLines);
    tableToggle.classList.toggle('on', state.table !== null);
    columnsInput.value = state.table?.join(', ') ?? '';
    void refresh();
  });
  columnsInput.addEventListener('change', () => {
    const columns = columnsInput.value
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    state.table = columns.length ? columns : defaultColumns(allLines);
    void refresh();
  });
  const showTimeMode = () => {
    timeButton.textContent = state.timeMode === 'utc' ? 'UTC' : 'Local time';
    timeButton.classList.toggle('on', state.timeMode === 'local');
  };
  showTimeMode();
  timeButton.addEventListener('click', () => {
    state.timeMode = state.timeMode === 'utc' ? 'local' : 'utc';
    showTimeMode();
    drawTimeline();
    if (!groupsPanel.hidden) renderGroups();
    void refresh();
    // remembered for next time, like the other settings
    void loadSettings()
      .then((settings) => saveSettings({ ...settings, timeMode: state.timeMode }))
      .catch(() => undefined);
  });

  // Follow: read the page again and add what was written since
  let followTimer: number | undefined;
  let consumed = options.text.length;
  let followedText = options.text;
  let lastHeads = new LogParser(options.parseOptions);
  async function followOnce(): Promise<void> {
    let text: string;
    try {
      const response = await fetch(location.href.split('#')[0], { cache: 'no-store', credentials: 'include' });
      text = await response.text();
    } catch (error) {
      showToast(`Follow: couldn’t read the page again (${(error as Error).message})`);
      return;
    }
    if (signal.aborted) return;
    const appended = appendedText(followedText.slice(0, consumed), text);
    if (!appended) {
      stopFollowing();
      showToast('The log was replaced, not added to. Reload the page to see it.');
      return;
    }
    consumed = appended.consumed;
    followedText = text;
    if (!appended.added) return;
    const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - ROW_HEIGHT * 2;
    const offset = allLines.length;
    const added = lastHeads.push(splitLines(appended.added)).map((line, i) => ({ ...line, number: offset + i + 1 }));
    allLines.push(...added);
    times = entryTimes(allLines);
    counts = countByLevel(allLines);
    secretCount = allLines.filter((l) => l.secret).length;
    timeline = buildTimeline(allLines);
    regexSearch.dispose();
    regexSearch = new RegexSearch(allLines.map((l) => l.text));
    for (const [key, entry] of Object.entries(chipCounts)) {
      const [button, count] = entry!;
      count.textContent = String(counts[key as Level | 'UNKNOWN']);
      button.hidden = counts[key as Level | 'UNKNOWN'] === 0;
    }
    secretsButton.textContent = `🔑 ${secretCount}`;
    secretsGroup.hidden = secretCount === 0;
    timelineToggle.hidden = timeline === null;
    drawTimeline();
    if (!groupsPanel.hidden) renderGroups();
    await refresh();
    if (atBottom) scroller.scrollTop = scroller.scrollHeight;
    showToast(`${added.length.toLocaleString()} new line${added.length > 1 ? 's' : ''}`);
  }
  function stopFollowing(): void {
    clearInterval(followTimer);
    followTimer = undefined;
    followToggle.classList.remove('on');
  }
  followToggle.addEventListener('click', () => {
    if (followTimer !== undefined) return stopFollowing();
    // new lines are parsed from where the first parse ended (its last entry's level carries over)
    lastHeads = new LogParser(options.parseOptions);
    lastHeads.push(splitLines(options.text).slice(-200));
    followToggle.classList.add('on');
    scroller.scrollTop = scroller.scrollHeight;
    void followOnce();
    followTimer = window.setInterval(() => void followOnce(), FOLLOW_INTERVAL_MS);
  });
  signal.addEventListener('abort', () => clearInterval(followTimer));

  secretsButton.addEventListener('click', () => jumpToNext((l) => l.secret));
  copyButton.addEventListener(
    'click',
    () => void copy(visible.map(displayText).join('\n'), `${visible.length.toLocaleString()} lines copied`),
  );
  rawButton.addEventListener('click', () => location.reload());
  compareButton.addEventListener('click', async () => {
    try {
      const side = await chrome.runtime.sendMessage({ type: COMPARE_ADD, text: options.text, name: options.title });
      if (side === 'left') showToast('Added as “Before”. Open the other log and press Compare there.');
    } catch {
      showToast('Compare isn’t available here');
    }
  });

  rows.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>('.row');
    if (!row) return;
    const number = Number(row.dataset.number);
    if (target.classList.contains('ln')) {
      select(number);
      void copy(lineLink(number), `Link to line ${number} copied`);
      return;
    }
    // don't steal clicks that finish a text selection
    if (window.getSelection()?.toString()) return;
    select(state.selected === number ? null : number);
  });

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.target === search) {
        if (event.key === 'Escape') {
          search.value = '';
          state.query = '';
          void refresh();
          scroller.focus();
        }
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === '/') {
        event.preventDefault();
        search.focus();
      } else if (event.key === 'e') {
        jumpToNext((l) => l.level === 'ERROR' && !l.continuation);
      } else if (event.key === 's' && secretCount > 0) {
        jumpToNext((l) => l.secret);
      } else if (event.key === 'm' && state.selected !== null) {
        toggleBookmark(state.selected);
      } else if (event.key === 'b' && state.bookmarks.size > 0) {
        jumpToNext((l) => state.bookmarks.has(l.number));
      } else if (event.key === 'Escape' && state.selected !== null) {
        select(null);
      }
    },
    { signal },
  );

  scroller.addEventListener('scroll', () => render(), { passive: true });
  window.addEventListener('resize', () => render(), { signal });

  function scrollToIndex(index: number, selectIt: boolean): void {
    scroller.scrollTop = Math.max(0, index * ROW_HEIGHT - scroller.clientHeight / 3);
    if (selectIt) select(visible[index].number);
    else render();
  }

  function jumpToNext(predicate: (line: CollapsedLine) => boolean): void {
    const current =
      state.selected !== null
        ? visible.findIndex((l) => l.number === state.selected)
        : Math.floor(scroller.scrollTop / ROW_HEIGHT) - 1;
    let target = visible.findIndex((l, i) => i > current && predicate(l));
    if (target < 0) target = visible.findIndex(predicate); // wrap around
    if (target >= 0) scrollToIndex(target, true);
    else showToast('Nothing found in the visible lines');
  }

  let fieldMode = false;
  const clock = (t: number) => formatTime(t, state.timeMode).slice(11, 19);

  function renderSubbar(): void {
    const range = state.timeRange;
    rangeChip.hidden = range === null;
    if (range) rangeChip.textContent = `⏱ ${clock(range[0])} – ${clock(range[1])} ×`;
    groupChip.hidden = state.group === null;
    if (state.group) groupChip.textContent = `Only ${state.group.label} ×`;
    columnsLabel.hidden = state.table === null;
    highlightChips.replaceChildren(
      ...state.highlights.map((term, i) => {
        const chip = el('button', { className: `toggle hl-chip hl-${i}`, title: 'Remove this highlight' }, `${term} ×`);
        chip.addEventListener('click', () => {
          state.highlights.splice(i, 1);
          void refresh();
        });
        return chip;
      }),
    );
    subbar.hidden =
      range === null && state.group === null && state.table === null && state.highlights.length === 0 && sourceButtons.length < 2;
    sourceChips.hidden = sourceButtons.length < 2;
    markDrag();
  }

  let regexSearch = new RegexSearch(allLines.map((l) => l.text));
  let refreshId = 0;

  /**
   * Plain-text search is linear and runs here. Regex search runs in a worker with a time limit,
   * so a pattern like (a+)+$ can't freeze the tab; results of outdated searches are dropped.
   */
  async function refresh(): Promise<void> {
    const id = ++refreshId;
    let error = '';
    let mask: Uint8Array | null = null;
    const conditions = state.regex ? null : parseFieldQuery(state.query);
    fieldMode = conditions !== null;
    search.classList.toggle('fields', fieldMode);
    if (state.query && state.regex) {
      status.textContent = 'Searching…';
      const result = await regexSearch.search(state.query, state.caseSensitive);
      if (id !== refreshId) return;
      if ('error' in result) error = result.error;
      else mask = result.mask;
    }
    state.searchError = error;
    search.classList.toggle('invalid', error !== '');
    search.title = error;

    // fields, time range and pods narrow the lines first; levels and search then filter what's left
    let base = conditions ? filterByFields(allLines, conditions) : allLines;
    const range = state.timeRange;
    if (range) base = base.filter((l) => times[l.number - 1] >= range[0] && times[l.number - 1] < range[1]);
    if (state.hiddenSources.size > 0) base = base.filter((l) => l.source === null || !state.hiddenSources.has(l.source));
    if (state.group) {
      // the group's error lines and their stack traces
      const heads = state.group.lines;
      let keep = false;
      base = base.filter((l) => {
        if (!l.continuation) keep = heads.has(l.number);
        return keep;
      });
    }

    let filtered: LogLine[];
    if (error) {
      filtered = [];
    } else if (mask) {
      const matches = mask;
      filtered = filterLines(base, { ...state, query: '' }).filter((l) => matches[l.number - 1] === 1);
    } else {
      filtered = filterLines(base, { ...state, query: fieldMode ? '' : state.query });
    }
    visible = state.collapse ? collapseRepeats(filtered) : filtered.map((l) => ({ ...l, repeat: 1 }));
    spacer.style.height = `${visible.length * ROW_HEIGHT}px`;
    const conditionNote = conditions ? ` · ${conditions.length} field condition${conditions.length > 1 ? 's' : ''}` : '';
    status.textContent =
      error || `${visible.length.toLocaleString()} / ${allLines.length.toLocaleString()} lines${conditionNote}`;
    renderSubbar();
    renderInspector();
    render();
  }

  function render(): void {
    const first = Math.max(0, Math.floor(scroller.scrollTop / ROW_HEIGHT) - OVERSCAN);
    const count = Math.ceil(scroller.clientHeight / ROW_HEIGHT) + OVERSCAN * 2;
    const slice = visible.slice(first, first + count);
    rows.style.transform = `translateY(${first * ROW_HEIGHT}px)`;
    rows.replaceChildren(
      ...slice.map((line) => {
        const classes = ['row', `lvl-${line.level ?? 'UNKNOWN'}`];
        if (line.continuation) classes.push('cont');
        if (line.secret) classes.push('has-secret');
        if (line.number === state.selected) classes.push('selected');
        if (state.bookmarks.has(line.number)) classes.push('bookmarked');
        const row = el('div', { className: classes.join(' ') });
        row.dataset.number = String(line.number);

        const gap = el('span', { className: 'gap' });
        if (state.showGaps && line.gap !== null && line.gap >= gapThreshold) {
          gap.textContent = formatGap(line.gap);
          gap.title = 'Pause since the previous entry';
          if (line.gap >= 10_000) gap.classList.add('big');
        }
        const txt = el('span', { className: 'txt' });
        if (line.repeat > 1) {
          txt.append(el('span', { className: 'repeat', title: 'Similar consecutive lines' }, `×${line.repeat}`));
        }
        if (state.table && line.json) {
          const { cells, rest } = tableCells(line, state.table);
          txt.classList.add('table');
          for (const cell of cells)
            txt.append(el('span', { className: 'cell', title: cell }, localizeTimestamp(cell, state.timeMode)));
          txt.append(el('span', { className: 'rest' }, state.maskSecrets ? maskSecrets(rest) : rest));
        } else {
          appendText(txt, line);
        }
        row.append(el('span', { className: 'ln', title: 'Copy a link to this line' }, String(line.number)), gap, txt);
        return row;
      }),
    );
  }

  updateBookmarkButtons();
  void refresh();
  void loadBookmarks();
  scroller.focus();

  // #L120 in the address opens the viewer on that line
  const hash = LINE_HASH.exec(location.hash);
  if (hash) {
    const index = visible.findIndex((l) => l.number === Number(hash[1]));
    if (index >= 0) scrollToIndex(index, true);
  }
}
