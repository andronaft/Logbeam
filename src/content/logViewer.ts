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
  splitSource,
} from '../lib/logs';
import { findSecrets, maskSecrets, setCustomSecretPatterns } from '../lib/secrets';
import { loadSettings } from '../shared/settings';
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
}

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

  const lines = await parseLogAsync(text, (done, total) => {
    bar.style.width = `${Math.round((done / total) * 100)}%`;
    label.textContent = `Parsing log… ${done.toLocaleString()} / ${total.toLocaleString()} lines`;
  });
  const settings = await loadSettings();
  setCustomSecretPatterns(settings.customSecrets);
  if (settings.customSecrets.some((custom) => custom.pattern.trim())) {
    // the worker parsed without the user's own patterns: mark those lines here
    for (const line of lines) {
      if (!line.secret && findSecrets(line.text.slice(0, HIGHLIGHT_LIMIT)).length > 0) line.secret = true;
    }
  }
  body.replaceChildren();
  buildViewer(body, lines, { text, title, gapThreshold: settings.gapThresholdMs, signal: viewer.signal });
}

/** Opens a dropped or chosen file (plain or gzip) in the viewer, replacing the current log. */
export async function openFile(file: File): Promise<void> {
  await openViewer(await readLogFile(file), displayName(file.name));
}

interface ViewerOptions {
  text: string;
  title: string;
  gapThreshold: number;
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
  const counts = countByLevel(allLines);
  const secretCount = allLines.filter((l) => l.secret).length;
  const timeline = buildTimeline(allLines);

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
  };
  const times = entryTimes(allLines);
  const sources = [...new Set(allLines.map((l) => l.source).filter((s): s is string => s !== null))];
  const sourceIndex = new Map(sources.map((source, i) => [source, i]));
  const fields = commonFields(allLines);
  let visible: CollapsedLine[] = [];

  // ---- toolbar ----------------------------------------------------------------------------
  const chip = (key: Level | 'UNKNOWN', text: string) => {
    const button = el(
      'button',
      { className: `chip lvl-${key} on`, title: `Show/hide ${text}` },
      `${text} `,
      el('span', { className: 'count' }, String(counts[key])),
    );
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
  const subbar = el('div', { className: 'subbar' }, rangeChip, highlightChips, sourceChips);

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
  if (timeline) {
    const fmt = (t: number) => new Date(t).toISOString().replace('T', ' ').slice(0, 19);
    timeline.buckets.forEach((bucket, i) => {
      const height = (n: number) => `${Math.round((n / timeline.max) * 100)}%`;
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
    document.addEventListener(
      'pointerup',
      () => {
        if (!drag) return;
        const [first, last] = [Math.min(drag.from, drag.to), Math.max(drag.from, drag.to)];
        drag = null;
        markDrag();
        if (first === last) {
          const index = visible.findIndex((l) => l.time !== null && l.time >= timeline.buckets[first].from);
          if (index >= 0) scrollToIndex(index, true);
          return;
        }
        state.timeRange = [timeline.buckets[first].from, timeline.buckets[last].to];
        void refresh();
      },
      { signal },
    );
  }
  let drag: { from: number; to: number } | null = null;
  function markDrag(): void {
    const buckets = timelineEl.children;
    const range = state.timeRange;
    for (let i = 0; i < buckets.length; i++) {
      const bucket = timeline!.buckets[i];
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
  const toast = el('div', { className: 'toast' });
  const dropHint = el('div', { className: 'drop-hint' }, 'Drop a .log or .gz file to open it');
  body.append(toolbar, subbar, timelineEl, scroller, inspector, toast, dropHint);

  const displayText = (line: LogLine) => {
    if (!state.maskSecrets || !line.secret) return line.text;
    // a line of a private key's base64 body has nothing recognisable to mask piece by piece
    return line.secretBlock ? '****' : maskSecrets(line.text);
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
    if (line.time !== null) facts.push(` · ${new Date(line.time).toISOString()}`);
    if (line.gap !== null) facts.push(` · ${formatGap(line.gap)} after previous entry`);
    if (line.secret) facts.push(' · ', el('b', { className: 'secret-note' }, '🔑 contains a secret'));

    const copyLine = el('button', { className: 'toggle' }, 'Copy line');
    copyLine.addEventListener('click', () => void copy(displayText(line), 'Line copied'));
    const copyLink = el('button', { className: 'toggle' }, 'Copy link');
    copyLink.addEventListener('click', () => void copy(lineLink(line.number), 'Link copied'));
    const close = el('button', { className: 'toggle', title: 'Close ( Esc )' }, '×');
    close.addEventListener('click', () => select(null));

    const text = el('pre', { className: 'full-text' });
    appendText(text, line);
    const parts: Child[] = [
      el('div', { className: 'inspector-head' }, el('span', { className: 'facts' }, ...facts), copyLine, copyLink, close),
      text,
    ];
    if (line.json) {
      const json = JSON.stringify(line.json, null, 2);
      parts.push(el('pre', { className: 'json' }, state.maskSecrets ? maskSecrets(json) : json));
    }
    inspector.replaceChildren(...parts);
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
  const clock = (t: number) => new Date(t).toISOString().slice(11, 19);

  function renderSubbar(): void {
    const range = state.timeRange;
    rangeChip.hidden = range === null;
    if (range) rangeChip.textContent = `⏱ ${clock(range[0])} – ${clock(range[1])} ×`;
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
    subbar.hidden = range === null && state.highlights.length === 0 && sourceButtons.length < 2;
    sourceChips.hidden = sourceButtons.length < 2;
    if (timeline) markDrag();
  }

  const regexSearch = new RegexSearch(allLines.map((l) => l.text));
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
        appendText(txt, line);
        row.append(el('span', { className: 'ln', title: 'Copy a link to this line' }, String(line.number)), gap, txt);
        return row;
      }),
    );
  }

  void refresh();
  scroller.focus();

  // #L120 in the address opens the viewer on that line
  const hash = LINE_HASH.exec(location.hash);
  if (hash) {
    const index = visible.findIndex((l) => l.number === Number(hash[1]));
    if (index >= 0) scrollToIndex(index, true);
  }
}
