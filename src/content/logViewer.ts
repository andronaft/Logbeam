import { CollapsedLine, LEVELS, Level, LogLine, collapseRepeats, countByLevel, filterLines, formatGap } from '../lib/logs';
import { findSecrets, maskSecrets } from '../lib/secrets';
import { Range, searchRanges, toSegments } from '../lib/segments';
import { buildTimeline } from '../lib/timeline';
import { parseLogAsync } from './parseAsync';
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
const GAP_THRESHOLD_MS = 1000;
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

export async function openViewer(text: string = readPageText()): Promise<void> {
  const title = document.title || location.pathname.split('/').pop() || 'log';
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
  body.replaceChildren();
  buildViewer(body, lines);
}

function buildViewer(body: HTMLElement, allLines: LogLine[]): void {
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
  };
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

  const search = el('input', { type: 'search', placeholder: 'Search… ( / )', className: 'search', spellcheck: false });
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
    `Show pauses longer than ${GAP_THRESHOLD_MS / 1000}s`,
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
  const rawButton = el('button', { className: 'toggle', title: 'Back to the original page' }, 'Raw');
  const status = el('span', { className: 'status' });

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
    el('span', { className: 'group' }, search, regexToggle, caseToggle),
    collapseToggle,
    gapsToggle,
    timelineToggle,
    secretsGroup,
    nextError,
    copyButton,
    rawButton,
    status,
  );

  // ---- timeline -------------------------------------------------------------------------
  const timelineEl = el('div', { className: 'timeline' });
  timelineEl.hidden = !state.showTimeline;
  if (timeline) {
    const fmt = (t: number) => new Date(t).toISOString().replace('T', ' ').slice(0, 19);
    for (const bucket of timeline.buckets) {
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
      bar.addEventListener('click', () => {
        const index = visible.findIndex((l) => l.time !== null && l.time >= bucket.from);
        if (index >= 0) scrollToIndex(index, true);
      });
      timelineEl.append(bar);
    }
  }

  // ---- rows and inspector ---------------------------------------------------------------
  const spacer = el('div', { className: 'spacer' });
  const rows = el('div', { className: 'rows' });
  const scroller = el('main', { className: 'scroller', tabIndex: 0 }, spacer, rows);
  const inspector = el('aside', { className: 'inspector' });
  inspector.hidden = true;
  const toast = el('div', { className: 'toast' });
  body.append(toolbar, timelineEl, scroller, inspector, toast);

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
    const ranges: Range[] = state.searchError ? [] : searchRanges(head, state.query, state.regex, state.caseSensitive, 'match');
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

  nextError.addEventListener('click', () => jumpToNext((l) => l.level === 'ERROR' && !l.continuation));
  secretsButton.addEventListener('click', () => jumpToNext((l) => l.secret));
  copyButton.addEventListener(
    'click',
    () => void copy(visible.map(displayText).join('\n'), `${visible.length.toLocaleString()} lines copied`),
  );
  rawButton.addEventListener('click', () => location.reload());

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

  document.addEventListener('keydown', (event) => {
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
  });

  scroller.addEventListener('scroll', () => render(), { passive: true });
  window.addEventListener('resize', () => render());

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

    let filtered: LogLine[];
    if (error) {
      filtered = [];
    } else if (mask) {
      const matches = mask;
      filtered = filterLines(allLines, { ...state, query: '' }).filter((l) => matches[l.number - 1] === 1);
    } else {
      filtered = filterLines(allLines, state);
    }
    visible = state.collapse ? collapseRepeats(filtered) : filtered.map((l) => ({ ...l, repeat: 1 }));
    spacer.style.height = `${visible.length * ROW_HEIGHT}px`;
    status.textContent = error || `${visible.length.toLocaleString()} / ${allLines.length.toLocaleString()} lines`;
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
        if (state.showGaps && line.gap !== null && line.gap >= GAP_THRESHOLD_MS) {
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
