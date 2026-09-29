import {
  CollapsedLine,
  LEVELS,
  Level,
  buildMatcher,
  collapseRepeats,
  countByLevel,
  filterLines,
  formatGap,
  parseLog,
} from '../lib/logs';
import { VIEWER_CSS } from './viewerStyles';

/**
 * Replaces the current page with a log viewer. Rows have a fixed height and only the
 * visible ones (plus a small buffer) are in the DOM, so 100k+ line logs stay smooth.
 */

declare global {
  interface Window {
    __logbeamViewer?: boolean;
  }
}

const ROW_HEIGHT = 20;
const OVERSCAN = 30;
const GAP_THRESHOLD_MS = 1000;

interface State {
  levels: Set<Level>;
  includeUnknown: boolean;
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  collapse: boolean;
  showGaps: boolean;
}

function readPageText(): string {
  const body = document.body;
  // Chrome shows text/plain documents as <body><pre>…</pre></body>
  const onlyPre = body && body.children.length === 1 && body.firstElementChild instanceof HTMLPreElement;
  if (onlyPre) {
    return (body.firstElementChild as HTMLPreElement).textContent ?? '';
  }
  return body?.innerText ?? '';
}

/** Appends the text to the parent with search matches wrapped in <mark>. Built from DOM nodes,
 * not innerHTML, so it works on pages that enforce Trusted Types (GitHub, Google). */
function appendHighlighted(parent: HTMLElement, text: string, state: State): void {
  if (!state.query) {
    parent.append(text);
    return;
  }
  let re: RegExp;
  try {
    const source = state.regex ? state.query : state.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(source, state.caseSensitive ? 'g' : 'gi');
  } catch {
    parent.append(text);
    return;
  }
  let last = 0;
  for (const match of text.matchAll(re)) {
    if (match[0].length === 0) break; // e.g. /x*/ would loop forever
    const index = match.index ?? 0;
    parent.append(text.slice(last, index), el('mark', {}, match[0]));
    last = index + match[0].length;
  }
  parent.append(text.slice(last));
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const element = Object.assign(document.createElement(tag), props);
  element.append(...children);
  return element;
}

function start(): void {
  const text = readPageText();
  const title = document.title || location.pathname.split('/').pop() || 'log';
  const allLines = parseLog(text);
  const counts = countByLevel(allLines);

  const state: State = {
    levels: new Set(LEVELS),
    includeUnknown: true,
    query: '',
    regex: false,
    caseSensitive: false,
    collapse: false,
    showGaps: true,
  };
  let visible: CollapsedLine[] = [];

  // ---- build the page -------------------------------------------------------------
  document.documentElement.replaceChildren();
  const head = el('head', {}, el('meta', { name: 'viewport', content: 'width=device-width' } as Partial<HTMLMetaElement>), el('title', {}, `${title} — Logbeam`), el('style', {}, VIEWER_CSS));
  const body = el('body');
  document.documentElement.append(head, body);

  const levelChips: HTMLButtonElement[] = [];
  const chip = (key: Level | 'UNKNOWN', label: string) => {
    const button = el('button', { className: `chip lvl-${key} on`, title: `Show/hide ${label}` }, `${label} `, el('span', { className: 'count' }, String(counts[key])));
    button.addEventListener('click', () => {
      if (key === 'UNKNOWN') state.includeUnknown = !state.includeUnknown;
      else if (state.levels.has(key)) state.levels.delete(key);
      else state.levels.add(key);
      button.classList.toggle('on');
      refresh();
    });
    levelChips.push(button);
    return button;
  };

  const search = el('input', { type: 'search', placeholder: 'Search… ( / )', className: 'search', spellcheck: false });
  const regexToggle = el('button', { className: 'toggle', title: 'Regular expression' }, '.*');
  const caseToggle = el('button', { className: 'toggle', title: 'Match case' }, 'Aa');
  const collapseToggle = el('button', { className: 'toggle', title: 'Collapse repeated lines' }, 'Collapse repeats');
  const gapsToggle = el('button', { className: 'toggle on', title: `Show pauses longer than ${GAP_THRESHOLD_MS / 1000}s` }, 'Gaps');
  const nextError = el('button', { className: 'toggle', title: 'Jump to next error ( e )' }, 'Next error');
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
    el('span', { className: 'search-box' }, search, regexToggle, caseToggle),
    collapseToggle,
    gapsToggle,
    nextError,
    copyButton,
    rawButton,
    status,
  );

  const spacer = el('div', { className: 'spacer' });
  const rows = el('div', { className: 'rows' });
  const scroller = el('main', { className: 'scroller', tabIndex: 0 }, spacer, rows);
  body.append(toolbar, scroller);

  // ---- behaviour --------------------------------------------------------------------
  const toggle = (button: HTMLButtonElement, apply: () => void) =>
    button.addEventListener('click', () => {
      button.classList.toggle('on');
      apply();
      refresh();
    });
  toggle(regexToggle, () => (state.regex = !state.regex));
  toggle(caseToggle, () => (state.caseSensitive = !state.caseSensitive));
  toggle(collapseToggle, () => (state.collapse = !state.collapse));
  toggle(gapsToggle, () => (state.showGaps = !state.showGaps));

  let debounce: number | undefined;
  search.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = window.setTimeout(() => {
      state.query = search.value;
      refresh();
    }, 150);
  });

  nextError.addEventListener('click', jumpToNextError);
  copyButton.addEventListener('click', async () => {
    await navigator.clipboard.writeText(visible.map((l) => l.text).join('\n'));
    copyButton.textContent = 'Copied ✓';
    setTimeout(() => (copyButton.textContent = 'Copy'), 1500);
  });
  rawButton.addEventListener('click', () => location.reload());

  document.addEventListener('keydown', (event) => {
    if (event.target === search) {
      if (event.key === 'Escape') {
        search.value = '';
        state.query = '';
        refresh();
        scroller.focus();
      }
      return;
    }
    if (event.key === '/') {
      event.preventDefault();
      search.focus();
    } else if (event.key === 'e') {
      jumpToNextError();
    }
  });

  scroller.addEventListener('scroll', () => render(), { passive: true });
  window.addEventListener('resize', () => render());

  function jumpToNextError(): void {
    const firstVisibleIndex = Math.floor(scroller.scrollTop / ROW_HEIGHT);
    let target = visible.findIndex((l, i) => i > firstVisibleIndex && l.level === 'ERROR' && !l.continuation);
    if (target < 0) target = visible.findIndex((l) => l.level === 'ERROR' && !l.continuation); // wrap around
    if (target >= 0) {
      scroller.scrollTop = target * ROW_HEIGHT;
      render();
    }
  }

  function refresh(): void {
    let matcherError = '';
    try {
      buildMatcher(state);
      search.classList.remove('invalid');
    } catch (e) {
      matcherError = (e as Error).message;
      search.classList.add('invalid');
    }
    const filtered = matcherError ? [] : filterLines(allLines, state);
    visible = state.collapse ? collapseRepeats(filtered) : filtered.map((l) => ({ ...l, repeat: 1 }));
    spacer.style.height = `${visible.length * ROW_HEIGHT}px`;
    status.textContent = matcherError || `${visible.length.toLocaleString()} / ${allLines.length.toLocaleString()} lines`;
    render();
  }

  function render(): void {
    const first = Math.max(0, Math.floor(scroller.scrollTop / ROW_HEIGHT) - OVERSCAN);
    const count = Math.ceil(scroller.clientHeight / ROW_HEIGHT) + OVERSCAN * 2;
    const slice = visible.slice(first, first + count);
    rows.style.transform = `translateY(${first * ROW_HEIGHT}px)`;
    rows.replaceChildren(
      ...slice.map((line) => {
        const row = el('div', { className: `row lvl-${line.level ?? 'UNKNOWN'}${line.continuation ? ' cont' : ''}` });
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
        appendHighlighted(txt, line.text, state);
        row.append(el('span', { className: 'ln' }, String(line.number)), gap, txt);
        return row;
      }),
    );
  }

  refresh();
  scroller.focus();
}

if (!window.__logbeamViewer) {
  window.__logbeamViewer = true;
  start();
}
