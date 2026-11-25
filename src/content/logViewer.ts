import { commonFields, excludeWords, fieldValue, filterByFields, parseQuery } from '../lib/fields';
import { displayName, readLogFile } from '../lib/files';
import { MergeInput, mergeByTime } from '../lib/merge';
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
  signature,
  splitLines,
  splitSource,
} from '../lib/logs';
import { Mute, countKind, hideMuted, makeMute, muteKey } from '../lib/mute';
import {
  Bookmark,
  appendedText,
  bookmarkReport,
  defaultColumns,
  findGroups,
  foldGroups,
  formatTime,
  isMostlyJson,
  LineId,
  lineFields,
  lineIds,
  localizeTimestamp,
  tableCells,
  toCsv,
  traceId,
} from '../lib/insights';
import { findSecrets, maskSecrets, setCustomSecretPatterns } from '../lib/secrets';
import { findFailedTests } from '../lib/tests';
import { HINT_VIEWS, ViewPrefs, canSaveSettings, loadSettings, saveSettings } from '../shared/settings';
import { BOOKMARKS_PREFIX, loadBookmarks as loadPageBookmarks, saveBookmarks as savePageBookmarks } from '../shared/bookmarks';
import { applyTheme } from '../shared/theme';
import { Range, searchRanges, toSegments } from '../lib/segments';
import { buildTimeline } from '../lib/timeline';
import { findJump, keepInView, targetLineIndex } from '../lib/navigation';
import { LINK_LEVELS, ViewLink, formatViewLink, parseViewLink } from '../lib/viewLink';
import { parseLogAsync } from './parseAsync';
import { COMPARE_ADD } from '../shared/compare';
import { t, tn, uiLanguage } from '../shared/i18n';
import { RegexSearch } from './regexSearch';
import { shortcutsHelp } from './shortcuts';
import { Child, el } from './dom';
import {
  FOLLOW_INTERVAL_MS,
  HIGHLIGHT_LIMIT,
  ROW_TEXT_LIMIT,
  MAX_HIGHLIGHTS,
  MAX_SOURCES,
  OVERSCAN,
  ROW_HEIGHT,
  State,
  ViewerOptions,
  entryTimes,
} from './viewerState';
import { renderErrorGroups } from './errorGroupsPanel';
import { renderFailedTests } from './testsPanel';
import { renderFieldStats } from './fieldStatsPanel';
import { renderRange } from './rangePanel';
import { createTimelineView } from './timelineView';
import { createMinimap } from './minimap';
import { VIEWER_CSS } from './viewerStyles';

/**
 * Replaces the current page with a log viewer. Rows have a fixed height and only the
 * visible ones (plus a small buffer) are in the DOM, so 100k+ line logs stay smooth.
 * Everything is built from DOM nodes, never innerHTML, so it also works on pages that
 * enforce Trusted Types (GitHub, Google).
 */

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
  document.documentElement.lang = uiLanguage();
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
  await showViewer(async () => ({ text, notice: '' }), name);
}

/** Text to show, read while the loading screen is up; notice is said once the log is open. */
type LoadLog = (label: HTMLElement, bar: HTMLElement) => Promise<{ text: string; notice: string }>;

async function showViewer(load: LoadLog, name?: string, fromFile = false): Promise<void> {
  previousViewer?.abort();
  const viewer = new AbortController();
  previousViewer = viewer;
  const title = name ?? (document.title || location.pathname.split('/').pop() || 'log');
  const body = resetDocument(title);

  const bar = el('div', { className: 'progress-bar' });
  const label = el('div', { className: 'loading-label' }, t('viewerParsing', 'Parsing log…'));
  body.append(
    el(
      'div',
      { className: 'loading' },
      el('span', { className: 'brand' }, 'Logbeam'),
      label,
      el('div', { className: 'progress' }, bar),
    ),
  );

  const { text, notice } = await load(label, bar);
  // the page is about to be replaced; "Compare…" in the context menu reads the log from here
  (window as unknown as { __logbeamLogText?: string }).__logbeamLogText = text;
  const settings = await loadSettings();
  applyTheme(settings.theme);
  const parseOptions = { customLevels: settings.customLevels };
  bar.style.width = '0';
  label.textContent = t('viewerParsing', 'Parsing log…');
  const lines = await parseLogAsync(
    text,
    (done, total) => {
      bar.style.width = `${Math.round((done / total) * 100)}%`;
      label.textContent = t('viewerParsingProgress', 'Parsing log… {done} / {total} lines', {
        done: done.toLocaleString(),
        total: total.toLocaleString(),
      });
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
  const hint = canSaveSettings() && settings.hintViews < HINT_VIEWS;
  if (hint) void saveSettings({ ...settings, hintViews: settings.hintViews + 1 }).catch(() => undefined);
  buildViewer(body, lines, {
    hint,
    text,
    title,
    gapThreshold: settings.gapThresholdMs,
    timeMode: settings.timeMode,
    view: settings.view,
    parseOptions,
    signal: viewer.signal,
    notice,
    fromFile,
  });
}

/**
 * Opens dropped or chosen files (plain or gzip) in the viewer, replacing the current log. Several
 * files are merged into one log by time, each with its name in front of its lines (see merge.ts).
 */
export async function openFiles(files: File[]): Promise<void> {
  if (files.length === 0) return;
  // the line and the filters in the address belong to the log that was open before
  if (parseViewLink(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  const names = files.map((file) => displayName(file.name));
  if (files.length === 1) {
    const text = await readLogFile(files[0]);
    await showViewer(async () => ({ text, notice: '' }), names[0], true);
    return;
  }
  const texts = await Promise.all(files.map(readLogFile));
  await showViewer(
    async (label, bar) => {
      const inputs: MergeInput[] = [];
      for (const [i, text] of texts.entries()) {
        label.textContent = t('viewerMerging', 'Merging by time: {name}', { name: names[i] });
        bar.style.width = `${Math.round((i / texts.length) * 100)}%`;
        // only when each entry starts matters here; the merged log is parsed again as a whole
        const parsed = await parseLogAsync(text, () => {});
        inputs.push({
          name: names[i],
          lines: splitLines(text),
          times: parsed.map((line) => (line.continuation ? null : line.time)),
        });
      }
      const merged = mergeByTime(inputs);
      const notice = merged.untimed.length
        ? t('viewerMergedUntimed', 'No timestamps in {names}, so those lines are at the end', {
            names: merged.untimed.join(', '),
          })
        : tn('viewerMerged', files.length, '{n} file merged by time', '{n} files merged by time');
      return { text: merged.text, notice };
    },
    names.join(' + '),
    true,
  );
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
    context: options.view.context,
    collapse: options.view.collapse,
    showGaps: options.view.showGaps,
    maskSecrets: options.view.maskSecrets,
    searchError: '',
    showTimeline: timeline !== null && options.view.showTimeline,
    selected: null,
    selectedTo: null,
    timeRange: null,
    hiddenSources: new Set(),
    mutes: [],
    highlights: [],
    bookmarks: new Map(),
    timeMode: options.timeMode,
    group: null,
    table: null,
  };
  let times = entryTimes(allLines);
  const sources = [...new Set(allLines.map((l) => l.source).filter((s): s is string => s !== null))];
  /** The pods that have a chip to switch them off with. */
  const chipSources = sources.slice(0, MAX_SOURCES);
  const sourceIndex = new Map(sources.map((source, i) => [source, i]));
  const fields = commonFields(allLines);
  let visible: CollapsedLine[] = [];
  // the kind of each line, for "Hide lines like this": worked out once, when first asked for
  const kinds: string[] = [];
  const kindOf = (line: LogLine) => (kinds[line.number - 1] ??= muteKey(line));
  // worked out once per line, not on every refresh: Collapse compares signatures, and a row of the
  // view is the line with a repeat count (600k copies per keystroke took 0.1 s)
  const signatures: string[] = [];
  const signatureOf = (line: LogLine) => (signatures[line.number - 1] ??= signature(line.text));
  const rowCache: CollapsedLine[] = [];
  const rowOf = (line: LogLine): CollapsedLine =>
    // a context line is a copy with its own flags: not the one to keep
    line === allLines[line.number - 1] ? (rowCache[line.number - 1] ??= { ...line, repeat: 1 }) : { ...line, repeat: 1 };
  // GitHub Actions ##[group] sections: folded like in GitHub, except the ones with errors
  let groups = findGroups(allLines);
  let groupByStart = new Map(groups.map((g) => [g.start, g]));
  const openGroups = new Set(groups.filter((g) => g.errors > 0).map((g) => g.start));

  // ---- toolbar ----------------------------------------------------------------------------
  const setPressed = (button: HTMLElement, on: boolean) => {
    button.classList.toggle('on', on);
    button.setAttribute('aria-pressed', String(on));
  };
  const chipCounts: Partial<Record<Level | 'UNKNOWN', [HTMLButtonElement, HTMLSpanElement]>> = {};
  const chip = (key: Level | 'UNKNOWN', text: string) => {
    const count = el('span', { className: 'count' }, String(counts[key]));
    const button = el(
      'button',
      { className: `chip lvl-${key} on`, title: t('viewerShowHide', 'Show/hide {name}', { name: text }) },
      `${text} `,
      count,
    );
    button.setAttribute('aria-pressed', 'true');
    chipCounts[key] = [button, count];
    button.addEventListener('click', () => {
      if (key === 'UNKNOWN') state.includeUnknown = !state.includeUnknown;
      else if (state.levels.has(key)) state.levels.delete(key);
      else state.levels.add(key);
      button.setAttribute('aria-pressed', String(button.classList.toggle('on')));
      void refresh();
    });
    button.hidden = counts[key] === 0; // nothing to filter
    return button;
  };
  const toggleButton = (text: string, title: string, on: boolean, apply: () => void, remember = false) => {
    const button = el('button', { className: `toggle${on ? ' on' : ''}`, title }, text);
    button.setAttribute('aria-pressed', String(on));
    // ".*", "Aa": a screen reader reads the title instead
    if (text.length <= 2) button.setAttribute('aria-label', title);
    button.addEventListener('click', () => {
      button.setAttribute('aria-pressed', String(button.classList.toggle('on')));
      apply();
      if (remember) rememberView();
      void refresh();
    });
    return button;
  };
  /** Keeps Collapse, Gaps, Timeline, Mask and Context as they are for the next log. */
  function rememberView(): void {
    const view: ViewPrefs = {
      collapse: state.collapse,
      showGaps: state.showGaps,
      // a log without times has no timeline to show or hide: keep what was saved
      showTimeline: timeline === null ? options.view.showTimeline : state.showTimeline,
      maskSecrets: state.maskSecrets,
      context: state.context,
    };
    void loadSettings()
      .then((settings) => saveSettings({ ...settings, view }))
      .catch(() => undefined);
  }

  const search = el('input', {
    type: 'search',
    placeholder: fields.length
      ? t('viewerSearchExamplePlaceholder', 'Search, or {example} ( / )', { example: fieldExample() ?? `${fields[0]}=…` })
      : t('viewerSearchPlaceholder', 'Search… ( / )'),
    title: t(
      'viewerSearchTitle',
      'Text to find, or fields: level=error service=payments duration>500 (key=value, !=, >, <, * wildcards)',
    ),
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
    {
      className: 'toggle',
      title: t('viewerHighlightTitle', 'Keep this text highlighted in its own colour ( Enter in the search box )'),
    },
    '🖍',
  );
  highlightButton.setAttribute('aria-label', highlightButton.title);
  const regexToggle = toggleButton('.*', t('viewerRegexTitle', 'Regular expression'), false, () => (state.regex = !state.regex));
  const caseToggle = toggleButton(
    'Aa',
    t('viewerCaseTitle', 'Match case'),
    false,
    () => (state.caseSensitive = !state.caseSensitive),
  );
  const contextSelect = el(
    'select',
    {
      className: 'toggle context',
      title: t('viewerContextTitle', 'Show a few lines around each search match (like grep -C)'),
    },
    el('option', { value: '0' }, t('viewerContext0', 'Context: 0')),
    el('option', { value: '2' }, t('viewerContext2', 'Context: 2')),
    el('option', { value: '5' }, t('viewerContext5', 'Context: 5')),
    el('option', { value: '10' }, t('viewerContext10', 'Context: 10')),
  );
  contextSelect.value = String(state.context);
  contextSelect.classList.toggle('on', state.context > 0);
  contextSelect.addEventListener('change', () => {
    state.context = Number(contextSelect.value);
    contextSelect.classList.toggle('on', state.context > 0);
    rememberView();
    void refresh();
  });
  const collapseToggle = toggleButton(
    t('viewerCollapse', 'Collapse'),
    t('viewerCollapseTitle', 'Collapse repeated lines (×N)'),
    state.collapse,
    () => (state.collapse = !state.collapse),
    true,
  );
  const gapsToggle = toggleButton(
    t('viewerGaps', 'Gaps'),
    t('viewerGapsTitle', 'Show pauses longer than {seconds}s', { seconds: gapThreshold / 1000 }),
    state.showGaps,
    () => (state.showGaps = !state.showGaps),
    true,
  );
  const timelineToggle = toggleButton(
    t('viewerTimeline', 'Timeline'),
    t('viewerTimelineTitle', 'Errors and warnings over time'),
    state.showTimeline,
    () => {
      state.showTimeline = !state.showTimeline;
      timelineEl.hidden = !state.showTimeline;
    },
    true,
  );
  timelineToggle.hidden = timeline === null;
  const maskToggle = toggleButton(
    t('viewerMask', 'Mask'),
    t('viewerMaskTitle', 'Hide secret values on screen and in copied text'),
    state.maskSecrets,
    () => (state.maskSecrets = !state.maskSecrets),
    true,
  );
  const secretsButton = el(
    'button',
    {
      className: 'toggle secrets',
      title: t('viewerSecretsTitle', 'Lines that show keys, tokens or passwords. Jump to the next one ( s )'),
    },
    `🔑 ${secretCount}`,
  );
  const secretsGroup = el('span', { className: 'group' }, secretsButton, maskToggle);
  secretsGroup.hidden = secretCount === 0;
  const nextError = el(
    'button',
    { className: 'toggle', title: t('viewerNextErrorTitle', 'Jump to the next error ( e )') },
    t('viewerNextError', 'Next error'),
  );
  const copyButton = el(
    'button',
    { className: 'toggle', title: t('viewerCopyTitle', 'Copy visible lines') },
    t('viewerCopy', 'Copy'),
  );
  const linkButton = el(
    'button',
    {
      className: 'toggle',
      title: t(
        'viewerViewLinkTitle',
        'Copy a link that opens this view: the levels, the search, the time range, the pods and the selected lines ( y )',
      ),
    },
    '🔗',
  );
  linkButton.setAttribute('aria-label', linkButton.title);
  // pasted text and files have no address to share
  // a file opened or dropped onto a web page isn't that page's log: its address can't open it
  const ownPage = !ON_EXTENSION_PAGE && !options.fromFile;
  linkButton.hidden = !ownPage;
  const compareButton = el(
    'button',
    {
      className: 'toggle',
      title: t('viewerCompareTitle', 'Compare this log with another one, e.g. a passing and a failing CI run'),
    },
    t('viewerCompare', 'Compare'),
  );
  // only as an extension content script (not when a test injects the viewer into the page)
  compareButton.hidden = typeof chrome === 'undefined' || !chrome.runtime?.id;
  const saveButton = el(
    'button',
    { className: 'toggle', title: t('viewerSaveTitle', 'Download the visible lines as a file') },
    t('viewerSave', 'Save'),
  );
  const fileInput = el('input', { type: 'file', multiple: true, hidden: true });
  const openButton = el(
    'button',
    {
      className: 'toggle',
      title: t('viewerOpenTitle', 'Open .log or .gz files (or drop them here); several are merged by time'),
    },
    t('viewerOpen', 'Open…'),
  );
  const rawButton = el(
    'button',
    { className: 'toggle', title: t('viewerRawTitle', 'Back to the original page') },
    t('viewerRaw', 'Raw'),
  );
  // the extension's viewer page shows pasted text or a file: there is no original page to go back to
  rawButton.hidden = ON_EXTENSION_PAGE;
  openButton.hidden = !ON_EXTENSION_PAGE;
  const status = el('span', { className: 'status' });

  const timeButton = el('button', {
    className: 'toggle',
    title: t(
      'viewerTimeTitle',
      'Show times in UTC or in your time zone (timestamps with a zone, the inspector and the timeline)',
    ),
  });
  const bookmarksButton = el('button', {
    className: 'toggle bookmarks',
    title: t('viewerBookmarksTitle', 'Jump to the next bookmark ( b )'),
  });
  const reportButton = el(
    'button',
    {
      className: 'toggle',
      title: t('viewerReportTitle', 'Copy the bookmarked lines with times and notes, as Markdown for a ticket'),
    },
    t('viewerReport', 'Report'),
  );
  const helpButton = el('button', { className: 'toggle', title: t('viewerHelpTitle', 'Keyboard shortcuts ( ? )') }, '?');
  helpButton.setAttribute('aria-label', helpButton.title);
  const groupsButton = el(
    'button',
    {
      className: 'toggle',
      title: t('viewerGroupsTitle', 'The same error grouped: how often, in which pods, first and last time'),
    },
    t('viewerGroups', 'Groups'),
  );
  // the tests a CI log says failed, from any runner: shown only when some did
  let testReport = findFailedTests(allLines);
  const testsButton = el('button', {
    className: 'toggle',
    title: t(
      'viewerTestsTitle',
      'The tests that failed, from pytest, Jest, Go, Maven, Gradle and RSpec, in the order they failed',
    ),
  });
  const showTestCount = () => {
    testsButton.textContent = `${t('viewerTests', 'Tests')} ✖ ${testReport.failed.length}`;
    testsButton.hidden = testReport.failed.length === 0;
  };
  showTestCount();
  const tableToggle = el(
    'button',
    { className: 'toggle', title: t('viewerTableTitle', 'Show JSON records as a table') },
    t('viewerTable', 'Table'),
  );
  const sectionsButton = el(
    'button',
    {
      className: 'toggle',
      title: t('viewerSectionsTitle', 'Open or close all ##[group] sections of a GitHub Actions log'),
    },
    t('viewerSections', 'Sections'),
  );
  sectionsButton.hidden = groups.length === 0;
  tableToggle.hidden = !isMostlyJson(allLines);
  const followToggle = el(
    'button',
    {
      className: 'toggle',
      title: t('viewerFollowTitle', 'Read the page again every {seconds}s and add new lines', {
        seconds: FOLLOW_INTERVAL_MS / 1000,
      }),
    },
    t('viewerFollow', 'Follow'),
  );
  // only a log served over http(s) can be read again
  followToggle.hidden = !ownPage || !/^https?:$/.test(location.protocol);

  // second row: what narrows the view besides levels and search
  const rangeChip = el('button', { className: 'toggle on range', title: t('viewerRangeTitle', 'Show all times again') });
  const highlightChips = el('span', { className: 'group' });
  const sourceChips = el('span', { className: 'group sources' });
  const muteChips = el('span', { className: 'group mutes' });
  const sourceButtons = chipSources.map((source, i) => {
    const button = el(
      'button',
      { className: `chip on src-${i % 8}`, title: t('viewerSourceTitle', 'Show/hide lines from {source}', { source }) },
      source,
    );
    button.setAttribute('aria-pressed', 'true');
    button.addEventListener('click', () => {
      if (state.hiddenSources.has(source)) state.hiddenSources.delete(source);
      else state.hiddenSources.add(source);
      setPressed(button, !state.hiddenSources.has(source));
      void refresh();
    });
    return button;
  });
  sourceChips.append(...sourceButtons);
  const groupChip = el('button', {
    className: 'toggle on group-chip',
    title: t('viewerGroupChipTitle', 'Show all lines again'),
  });
  const columnsInput = el('input', {
    className: 'columns',
    title: t('viewerColumnsTitle', 'Table columns, separated by commas'),
    spellcheck: false,
  });
  const columnsLabel = el('label', { className: 'columns-label' }, `${t('viewerColumns', 'Columns')} `, columnsInput);
  const subbar = el('div', { className: 'subbar' }, rangeChip, groupChip, columnsLabel, highlightChips, muteChips, sourceChips);

  // controls in groups that wrap as a whole: levels, search, how lines are shown, finding things, actions
  const tgroup = (name: string, ...children: Child[]) => el('span', { className: `tgroup ${name}` }, ...children);
  const toolbar = el(
    'header',
    { className: 'toolbar' },
    el('span', { className: 'brand' }, 'Logbeam'),
    tgroup(
      'levels',
      chip('ERROR', 'Error'),
      chip('WARN', 'Warn'),
      chip('INFO', 'Info'),
      chip('DEBUG', 'Debug'),
      chip('TRACE', 'Trace'),
      chip('UNKNOWN', t('viewerOtherLevel', 'Other')),
    ),
    tgroup('find', search, highlightButton, regexToggle, caseToggle, contextSelect),
    tgroup('view', collapseToggle, gapsToggle, timelineToggle, tableToggle, timeButton),
    tgroup('jump', secretsGroup, nextError, groupsButton, testsButton, sectionsButton, bookmarksButton, reportButton),
    tgroup(
      'actions',
      followToggle,
      copyButton,
      linkButton,
      saveButton,
      compareButton,
      openButton,
      fileInput,
      rawButton,
      helpButton,
    ),
    status,
    fieldList,
  );

  // ---- timeline -------------------------------------------------------------------------
  const timelineView = createTimelineView({
    signal,
    jump: (time) => {
      const index = visible.findIndex((l) => l.time !== null && l.time >= time);
      if (index >= 0) scrollToIndex(index, true);
    },
    pickRange: (from, to) => {
      // a range up to the last bar keeps the last entry too (the range's end is not included)
      const end = timeline && to >= timeline.buckets[timeline.buckets.length - 1].to ? to + 1 : to;
      state.timeRange = [from, end];
      void refresh();
    },
  });
  const timelineEl = timelineView.element;
  timelineEl.hidden = !state.showTimeline;
  const drawTimeline = () => timelineView.draw(timeline, state.timeMode, state.timeRange);
  const markDrag = () => timelineView.mark(state.timeRange);
  drawTimeline();

  // ---- rows and inspector ---------------------------------------------------------------
  const spacer = el('div', { className: 'spacer' });
  const rows = el('div', { className: 'rows' });
  const scroller = el('main', { className: 'scroller', tabIndex: 0 }, spacer, rows);
  // instead of a blank page when the filters leave nothing: why, and the way back
  const emptyState = el('div', { className: 'empty-state' });
  emptyState.hidden = true;
  const hintBar = el('div', { className: 'hint' });
  hintBar.hidden = true;
  const minimap = createMinimap({
    scroller,
    rowHeight: ROW_HEIGHT,
    signal,
    scrollTo: (index) => {
      scroller.scrollTop = Math.max(0, index * ROW_HEIGHT - scroller.clientHeight / 2);
      render();
    },
  });
  const inspector = el('aside', { className: 'inspector' });
  inspector.hidden = true;
  const groupsPanel = el('aside', { className: 'groups' });
  groupsPanel.hidden = true;
  const testsPanel = el('aside', { className: 'groups tests' });
  testsPanel.hidden = true;
  const toast = el('div', { className: 'toast' });
  const dropHint = el(
    'div',
    { className: 'drop-hint' },
    t('viewerDropHint', 'Drop .log or .gz files to open them; several are merged by time'),
  );
  const help = shortcutsHelp();
  body.append(
    toolbar,
    subbar,
    timelineEl,
    groupsPanel,
    testsPanel,
    hintBar,
    el('div', { className: 'log-area' }, scroller, emptyState, minimap.element),
    inspector,
    toast,
    dropHint,
    help,
  );

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
      showToast(t('viewerCopyFailed', 'Copy failed: the page doesn’t allow clipboard access'));
    }
  }

  function showToast(message: string, ms = 1600): void {
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), ms);
  }

  /** The selected range as [first, last] line numbers; null when one line or none is selected. */
  function selectedRange(): [number, number] | null {
    if (state.selected === null || state.selectedTo === null) return null;
    return [Math.min(state.selected, state.selectedTo), Math.max(state.selected, state.selectedTo)];
  }

  /** What a link has to keep to open this view again: the selection and what narrows the lines. */
  function currentView(): ViewLink {
    const range = selectedRange();
    // a level this log doesn't have has no chip, so it is neither shown nor hidden
    const present = LINK_LEVELS.filter((level) => counts[level === 'OTHER' ? 'UNKNOWN' : level] > 0);
    const shown = present.filter((level) => (level === 'OTHER' ? state.includeUnknown : state.levels.has(level)));
    const hiddenPods = chipSources.filter((source) => state.hiddenSources.has(source));
    const shownPods = chipSources.filter((source) => !state.hiddenSources.has(source));
    // whichever list of pods is shorter
    const listShown = hiddenPods.length > 0 && shownPods.length <= hiddenPods.length;
    return {
      line: range ? range[0] : state.selected,
      lineEnd: range ? range[1] : null,
      levels: shown.length === present.length ? null : shown,
      query: state.query,
      regex: state.regex,
      caseSensitive: state.caseSensitive,
      timeRange: state.timeRange,
      pods: listShown ? shownPods : null,
      hiddenPods: listShown ? null : hiddenPods,
      mutes: state.mutes.length > 0 ? state.mutes.map((mute) => mute.line) : null,
    };
  }

  function viewUrl(): string {
    return `${location.href.split('#')[0]}${formatViewLink(currentView())}`;
  }

  /**
   * Keeps the view in the address, so the address bar is always a link to what is on screen.
   * replaceState adds no history entry per key typed. A page's own #anchor stays until there
   * is something to write instead.
   */
  function syncAddress(): void {
    if (options.fromFile && !ON_EXTENSION_PAGE) return;
    const hash = formatViewLink(currentView());
    if (hash === location.hash) return;
    if (!hash && parseViewLink(location.hash) === null) return;
    try {
      history.replaceState(null, '', hash || location.pathname + location.search);
    } catch {
      // a sandboxed page that may not touch its history: the Link button still works
    }
  }

  /**
   * A line's text with its search matches, secrets, ANSI colours and pod. A row shows the first
   * `limit` characters: a 50k-character line would stall the page when it scrolls into view, and the
   * line details show all of it.
   */
  function appendText(parent: HTMLElement, line: LogLine, limit = Number.POSITIVE_INFINITY): void {
    const full = displayText(line);
    const text = full.length > limit ? full.slice(0, limit) : full;
    const head = text.length > HIGHLIGHT_LIMIT ? text.slice(0, HIGHLIGHT_LIMIT) : text;
    const query = searchText;
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
    if (text.length < full.length) {
      const more = (full.length - text.length).toLocaleString();
      parent.append(
        el(
          'span',
          { className: 'more-chars' },
          ` … ${t('viewerMoreChars', '+{n} characters (click the line to read it all)', { n: more })}`,
        ),
      );
    }
  }

  function renderInspector(): void {
    const line = state.selected === null ? undefined : allLines[state.selected - 1];
    inspector.hidden = !line;
    if (!line) return;
    const range = selectedRange();
    if (range) {
      const shown = visible.filter((l) => l.number >= range[0] && l.number <= range[1]);
      const first = times[range[0] - 1];
      const last = times[range[1] - 1];
      renderRange(inspector, {
        from: range[0],
        to: range[1],
        lines: shown.map(displayText),
        span: last > first ? formatGap(last - first).replace(/^\+/, '') : '',
        onCopyLines: () =>
          void copy(
            shown.map(displayText).join('\n'),
            tn('viewerLinesCopied', shown.length, '{n} line copied', '{n} lines copied'),
          ),
        onCopyLink: () => void copy(viewUrl(), t('viewerLinkCopied', 'Link copied')),
        onClose: () => select(null),
      });
      return;
    }
    const facts: Child[] = [t('viewerLineNumber', 'Line {n}', { n: line.number })];
    if (line.level) facts.push(' · ', el('b', { className: `lvl-${line.level}` }, line.level));
    if (line.time !== null) facts.push(` · ${formatTime(line.time, state.timeMode)}`);
    if (line.gap !== null) facts.push(` · ${t('viewerGapAfter', '{gap} after previous entry', { gap: formatGap(line.gap) })}`);
    if (line.secret) facts.push(' · ', el('b', { className: 'secret-note' }, `🔑 ${t('viewerHasSecret', 'contains a secret')}`));

    const hideLike = el(
      'button',
      { className: 'toggle', title: t('viewerMuteTitle', 'Hide every line like this one, e.g. health checks ( x )') },
      `⊘ ${t('viewerMute', 'Hide lines like this')}`,
    );
    hideLike.addEventListener('click', () => muteLike(line.number));
    const copyLine = el('button', { className: 'toggle' }, t('viewerCopyLine', 'Copy line'));
    copyLine.addEventListener('click', () => void copy(displayText(line), t('viewerLineCopied', 'Line copied')));
    const copyLink = el('button', { className: 'toggle' }, t('viewerCopyLink', 'Copy link'));
    copyLink.addEventListener('click', () => void copy(viewUrl(), t('viewerLinkCopied', 'Link copied')));
    const close = el('button', { className: 'toggle', title: t('viewerCloseTitle', 'Close ( Esc )') }, '×');
    close.addEventListener('click', () => select(null));
    const marked = state.bookmarks.has(line.number);
    const bookmark = el(
      'button',
      { className: `toggle${marked ? ' on' : ''}`, title: t('viewerBookmarkTitle', 'Bookmark this line for the report ( m )') },
      marked ? `★ ${t('viewerBookmarked', 'Bookmarked')}` : `☆ ${t('viewerBookmark', 'Bookmark')}`,
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
        hideLike,
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
        placeholder: t('viewerNotePlaceholder', 'Note for the report, e.g. “the timeout starts here”'),
      });
      note.addEventListener('input', () => {
        state.bookmarks.set(line.number, note.value);
        saveBookmarks();
      });
      parts.push(note);
    }
    const ids = lineIds(line);
    if (ids.length > 0) {
      const chips = ids.map((id) => {
        const chip = el(
          'button',
          {
            className: 'trace-id',
            title: t('viewerTraceTitle', 'Show every line with {id}, in all pods', { id: id.value }),
          },
          el('span', { className: 'name' }, id.key),
          ` ${id.value.length > 40 ? `${id.value.slice(0, 18)}…${id.value.slice(-8)}` : id.value}`,
        );
        chip.addEventListener('click', () => followId(id));
        return chip;
      });
      parts.push(
        el('div', { className: 'fields' }, el('span', { className: 'facts' }, `${t('viewerTrace', 'Follow:')} `), ...chips),
      );
    }
    const keys = lineFields(line);
    if (keys.length > 0) {
      const statsBox = el('div', { className: 'stats' });
      const buttons = keys.slice(0, 40).map((key) => {
        const button = el(
          'button',
          {
            className: 'field',
            title: t('viewerFieldTitle', 'Most common values of {field} in the shown lines', { field: key }),
          },
          key,
        );
        button.addEventListener('click', () => showStats(statsBox, key));
        return button;
      });
      parts.push(
        el('div', { className: 'fields' }, el('span', { className: 'facts' }, `${t('viewerFields', 'Fields:')} `), ...buttons),
        statsBox,
      );
    }
    if (line.json) {
      const json = JSON.stringify(line.json, null, 2);
      parts.push(el('pre', { className: 'json' }, state.maskSecrets ? maskSecrets(json) : json));
    }
    inspector.replaceChildren(...parts);
  }

  /**
   * Shows every line of one request across pods and services: the ID as plain text, so traceId=…,
   * trace_id=… and the bare ID in a message all match. A short value (user 42) would match inside
   * other numbers as text, so it is searched as its field instead.
   */
  function followId(id: LineId): void {
    const trace = traceId(allLines, id.value);
    if (state.regex) regexToggle.click();
    const asText = id.value.length >= 6 || id.key === 'id' || id.key === 'trace';
    search.value = asText ? id.value : `${id.key}=${/[\s"]/.test(id.value) ? JSON.stringify(id.value) : id.value}`;
    state.query = search.value;
    void refresh();
    const parts = [tn('viewerTraceEntries', trace.entries, '{n} entry', '{n} entries')];
    if (trace.sources.length > 1) parts.push(tn('viewerTracePods', trace.sources.length, '{n} pod', '{n} pods'));
    if (trace.first !== null && trace.last !== null && trace.last > trace.first) {
      parts.push(t('viewerTraceOver', 'over {time}', { time: formatGap(trace.last - trace.first).replace(/^\+/, '') }));
    }
    showToast(parts.join(' · '));
  }

  /** Filters by a field query (status=502, duration>=950ms), as if typed into the search box. */
  function setQuery(query: string): void {
    search.value = query;
    state.query = query;
    void refresh();
  }

  function showStats(box: HTMLElement, key: string): void {
    renderFieldStats(box, visible, key, setQuery);
  }

  // bookmarks are kept for this page while the browser is open (in memory, not on disk)
  const bookmarksKey = `${BOOKMARKS_PREFIX}${location.href.split('#')[0]}`;
  function saveBookmarks(): void {
    if (!ownPage) return;
    try {
      void savePageBookmarks(bookmarksKey, [...state.bookmarks]).catch(() => undefined);
    } catch {
      // the viewer injected into a page without extension APIs (tests)
    }
  }
  async function loadBookmarks(): Promise<void> {
    if (!ownPage) return;
    try {
      const saved = await loadPageBookmarks(bookmarksKey);
      if (saved.length) {
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
    minimap.draw(visible, state.bookmarks);
  }

  function renderGroups(): void {
    renderErrorGroups(groupsPanel, allLines, state.timeMode, (group) => {
      state.group = { key: group.key, lines: new Set(group.lines), label: `×${group.count} ${group.sample.slice(0, 60)}` };
      void refresh().then(() => {
        const index = visible.findIndex((l) => l.number === group.lines[0]);
        if (index >= 0) scrollToIndex(index, true);
      });
    });
  }

  function renderTests(): void {
    renderFailedTests(testsPanel, testReport, (test) => {
      // open the section the line is folded in; a filter that hides it still shows where it would be
      for (const group of groups) if (test.line > group.start && test.line <= group.end) openGroups.add(group.start);
      void refresh().then(() => {
        select(test.line);
        showSelection();
      });
    });
  }

  /** Selects one line, or with `to` the lines from `number` to it. */
  function select(number: number | null, to: number | null = null): void {
    state.selected = number;
    state.selectedTo = number === null || to === number ? null : to;
    syncAddress();
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
    if (state.table) {
      const csv = toCsv(visible, state.table, {
        mask: state.maskSecrets ? maskSecrets : undefined,
      });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const link = el('a', {
        href: URL.createObjectURL(blob),
        download: `${options.title.replace(/[\\/:*?"<>|]+/g, '_').replace(/\.log$/i, '')}.filtered.csv`,
      });
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
      showToast(tn('viewerRowsSaved', visible.length, '{n} row saved', '{n} rows saved'));
      return;
    }
    const blob = new Blob([visible.map(displayText).join('\n') + '\n'], { type: 'text/plain' });
    const link = el('a', {
      href: URL.createObjectURL(blob),
      download: `${options.title.replace(/[\\/:*?"<>|]+/g, '_').replace(/\.log$/i, '')}.filtered.log`,
    });
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    showToast(tn('viewerLinesSaved', visible.length, '{n} line saved', '{n} lines saved'));
  });

  // open or drop a file (plain or .gz) to replace this log
  const openChosen = (list: FileList | null | undefined) => {
    const files = [...(list ?? [])];
    if (files.length)
      void openFiles(files).catch((error) =>
        showToast(
          t('viewerCouldNotOpen', 'Couldn’t open {name}: {error}', {
            name: files.map((file) => file.name).join(', '),
            error: (error as Error).message,
          }),
        ),
      );
  };
  openButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => openChosen(fileInput.files));
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
      openChosen(event.dataTransfer?.files);
    },
    { signal },
  );

  nextError.addEventListener('click', () => jumpToNext((l) => l.level === 'ERROR' && !l.continuation, 'error'));
  bookmarksButton.addEventListener('click', () => jumpToNext((l) => state.bookmarks.has(l.number), 'bookmark'));
  reportButton.addEventListener('click', () => {
    const bookmarks: Bookmark[] = [...state.bookmarks].map(([line, note]) => ({ line, note }));
    const report = bookmarkReport(bookmarks, allLines, {
      title: options.title,
      url: ownPage ? location.href.split('#')[0] : '',
      timeMode: state.timeMode,
      mask: state.maskSecrets ? maskSecrets : undefined,
    });
    void copy(report, tn('viewerReportCopied', bookmarks.length, 'Report with {n} line copied', 'Report with {n} lines copied'));
  });
  helpButton.addEventListener('click', () => (help.hidden = !help.hidden));
  function toggleGroup(start: number): void {
    if (openGroups.has(start)) openGroups.delete(start);
    else openGroups.add(start);
    void refresh();
  }
  sectionsButton.addEventListener('click', () => {
    // open them all, or close them all once all are open
    const allOpen = groups.every((g) => openGroups.has(g.start));
    openGroups.clear();
    if (!allOpen) for (const group of groups) openGroups.add(group.start);
    void refresh();
  });
  groupsButton.addEventListener('click', () => {
    groupsPanel.hidden = !groupsPanel.hidden;
    groupsButton.classList.toggle('on', !groupsPanel.hidden);
    if (!groupsPanel.hidden) renderGroups();
  });
  testsButton.addEventListener('click', () => {
    testsPanel.hidden = !testsPanel.hidden;
    testsButton.classList.toggle('on', !testsPanel.hidden);
    if (!testsPanel.hidden) renderTests();
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
    timeButton.textContent = state.timeMode === 'utc' ? 'UTC' : t('viewerLocalTime', 'Local time');
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
      // the page's <pre> has LF line ends (the HTML parser turns CRLF into LF), the file may have CRLF
      text = (await response.text()).replace(/\r\n?/g, '\n');
    } catch (error) {
      showToast(t('viewerFollowFailed', 'Follow: couldn’t read the page again ({error})', { error: (error as Error).message }));
      return;
    }
    if (signal.aborted) return;
    const appended = appendedText(followedText.slice(0, consumed), text);
    if (!appended) {
      stopFollowing();
      showToast(t('viewerLogReplaced', 'The log was replaced, not added to. Reload the page to see it.'));
      return;
    }
    consumed = appended.consumed;
    followedText = text;
    if (!appended.added) return;
    const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - ROW_HEIGHT * 2;
    const offset = allLines.length;
    const added = lastHeads.push(splitLines(appended.added)).map((line, i) => ({ ...line, number: offset + i + 1 }));
    // a loop, not push(...added): 200k new lines are past what a call takes as arguments
    for (const line of added) allLines.push(line);
    rowCache.length = 0;
    times = entryTimes(allLines);
    counts = countByLevel(allLines);
    secretCount = allLines.filter((l) => l.secret).length;
    timeline = buildTimeline(allLines);
    // a group that was still being written may have ended or got errors; new ones start folded
    groups = findGroups(allLines);
    groupByStart = new Map(groups.map((g) => [g.start, g]));
    for (const group of groups) if (group.errors > 0 && group.start > offset) openGroups.add(group.start);
    sectionsButton.hidden = groups.length === 0;
    testReport = findFailedTests(allLines);
    showTestCount();
    if (!testsPanel.hidden) renderTests();
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
    // keep the inspector as it is: a note being typed keeps its focus, field statistics stay open
    await refresh({ keepInspector: true });
    if (atBottom) scroller.scrollTop = scroller.scrollHeight;
    showToast(tn('viewerNewLines', added.length, '{n} new line', '{n} new lines'));
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

  secretsButton.addEventListener('click', () => jumpToNext((l) => l.secret, 'secret'));
  const copyViewLink = () => void copy(viewUrl(), t('viewerViewLinkCopied', 'Link to this view copied'));
  linkButton.addEventListener('click', copyViewLink);
  copyButton.addEventListener(
    'click',
    () =>
      void copy(
        visible.map(displayText).join('\n'),
        tn('viewerLinesCopied', visible.length, '{n} line copied', '{n} lines copied'),
      ),
  );
  rawButton.addEventListener('click', () => location.reload());
  compareButton.addEventListener('click', async () => {
    try {
      const side = await chrome.runtime.sendMessage({ type: COMPARE_ADD, text: options.text, name: options.title });
      if (side === 'left') showToast(t('viewerAddedAsBefore', 'Added as “Before”. Open the other log and press Compare there.'));
      // the background couldn't keep it: storage for Compare holds about 10 MB
      else if (side !== 'right') showToast(t('viewerCompareTooBig', 'This log is too big to compare (over about 10 MB)'));
    } catch {
      showToast(t('viewerCompareUnavailable', 'Compare isn’t available here'));
    }
  });

  rows.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>('.row');
    if (!row) return;
    const number = Number(row.dataset.number);
    if (target.closest('.fold-toggle')) {
      toggleGroup(number);
      return;
    }
    // Shift+click: the lines from the selected one to this one, like #L120-L135 on GitHub
    const extend = event.shiftKey && state.selected !== null;
    if (target.classList.contains('ln')) {
      if (extend) select(state.selected, number);
      else select(number);
      const range = selectedRange();
      void copy(
        viewUrl(),
        range
          ? t('viewerRangeLinkCopied', 'Link to lines {from}–{to} copied', { from: range[0], to: range[1] })
          : t('viewerLineLinkCopied', 'Link to line {n} copied', { n: number }),
      );
      return;
    }
    if (extend) {
      select(state.selected, number);
      return;
    }
    // don't steal clicks that finish a text selection
    if (window.getSelection()?.toString()) return;
    select(state.selected === number && state.selectedTo === null ? null : number);
  });
  // with a line selected, Shift+click picks a range of lines, not a range of text
  rows.addEventListener('mousedown', (event) => {
    if (event.shiftKey && state.selected !== null) event.preventDefault();
  });

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.target === search) {
        if (event.key === 'Escape') {
          // a search still waiting for typing to stop would run after this and redraw again
          clearTimeout(debounce);
          search.value = '';
          state.query = '';
          void refresh();
          scroller.focus();
        }
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // typing in the bookmark note or the Columns box: letters are text there, not shortcuts
      const target = event.target as HTMLElement;
      if (event.key !== 'Escape' && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable))
        return;
      if (event.key === '?') {
        help.hidden = !help.hidden;
      } else if (event.key === 'Escape' && !help.hidden) {
        help.hidden = true;
      } else if (event.key === '/') {
        event.preventDefault();
        search.focus();
      } else if (event.key === 'j') {
        event.preventDefault();
        moveSelection(1);
      } else if (event.key === 'k') {
        event.preventDefault();
        moveSelection(-1);
      } else if (event.key === 'J') {
        event.preventDefault();
        extendSelection(1);
      } else if (event.key === 'K') {
        event.preventDefault();
        extendSelection(-1);
      } else if (event.key === 'y' && ownPage) {
        copyViewLink();
      } else if (event.key === 'g') {
        event.preventDefault();
        selectLineAtIndex(0);
      } else if (event.key === 'G') {
        event.preventDefault();
        selectLineAtIndex(visible.length - 1);
      } else if (event.key === 'e') {
        jumpToNext((l) => l.level === 'ERROR' && !l.continuation, 'error');
      } else if (event.key === 'n' || event.key === 'N') {
        jumpToMatch(event.key === 'n' ? 1 : -1);
      } else if (event.key === 'w') {
        jumpToNext((l) => l.level === 'WARN' && !l.continuation, 'warning');
      } else if (event.key === 'x' && state.selected !== null) {
        muteLike(state.selected);
      } else if (event.key === 'X' && state.mutes.length > 0) {
        unmute(state.mutes[state.mutes.length - 1]);
      } else if (event.key === 's' && secretCount > 0) {
        jumpToNext((l) => l.secret, 'secret');
      } else if (event.key === 'm' && state.selected !== null) {
        toggleBookmark(state.selected);
      } else if (event.key === 'b' && state.bookmarks.size > 0) {
        jumpToNext((l) => state.bookmarks.has(l.number), 'bookmark');
      } else if (event.key === 'Escape' && state.selected !== null) {
        select(null);
      }
    },
    { signal },
  );

  scroller.addEventListener(
    'scroll',
    () => {
      render();
      minimap.follow();
    },
    { passive: true },
  );
  window.addEventListener(
    'resize',
    () => {
      render();
      minimap.draw(visible, state.bookmarks);
    },
    { signal },
  );

  function reveal(index: number): void {
    const newScroll = keepInView(index, ROW_HEIGHT, scroller.scrollTop, scroller.clientHeight);
    if (newScroll !== scroller.scrollTop) {
      scroller.scrollTop = newScroll;
      render();
    }
  }

  function selectLineAtIndex(index: number): void {
    if (visible.length === 0) return;
    const clamped = Math.max(0, Math.min(visible.length - 1, index));
    select(visible[clamped].number);
    reveal(clamped);
  }

  /** J / K: grows or shrinks the selected range by one shown line, from its moving end. */
  function extendSelection(delta: number): void {
    if (state.selected === null) return moveSelection(delta);
    const end = state.selectedTo ?? state.selected;
    const current = visible.findIndex((l) => l.number === end);
    if (current < 0) return;
    const target = Math.max(0, Math.min(visible.length - 1, current + delta));
    select(state.selected, visible[target].number);
    reveal(target);
  }

  function moveSelection(delta: number): void {
    if (visible.length === 0) return;
    const current = state.selected !== null ? visible.findIndex((l) => l.number === state.selected) : -1;
    const top = Math.max(0, Math.floor(scroller.scrollTop / ROW_HEIGHT));
    const target = targetLineIndex(current, delta, visible.length, top);
    if (target >= 0) selectLineAtIndex(target);
  }

  function scrollToIndex(index: number, selectIt: boolean): void {
    scroller.scrollTop = Math.max(0, index * ROW_HEIGHT - scroller.clientHeight / 3);
    if (selectIt) select(visible[index].number);
    else render();
  }

  /** What e, w, s, b and n look for, to say why there is nothing to jump to. */
  type JumpKind = 'error' | 'warning' | 'secret' | 'bookmark' | 'match';
  const NOTHING: Record<JumpKind, [none: string, hidden: string]> = {
    error: [t('viewerNoErrors', 'No errors in this log.'), t('viewerErrorsHidden', 'The errors are hidden by the filters')],
    warning: [
      t('viewerNoWarnings', 'No warnings in this log.'),
      t('viewerWarningsHidden', 'The warnings are hidden by the filters'),
    ],
    secret: [
      t('viewerNoSecrets', 'No leaked secrets in this log.'),
      t('viewerSecretsHidden', 'The secrets are hidden by the filters'),
    ],
    bookmark: [
      t('viewerNoBookmarks', 'No bookmarks yet: select a line and press m'),
      t('viewerBookmarksHidden', 'The bookmarked lines are hidden by the filters'),
    ],
    match: [t('viewerNoMatches', 'No lines match the search'), t('viewerNoMatches', 'No lines match the search')],
  };

  /**
   * Selects the next (or with direction -1 the previous) shown line that passes the predicate,
   * after the selected line or the top of the view, wrapping around at the ends.
   */
  function jumpToNext(predicate: (line: LogLine) => boolean, kind: JumpKind, direction: 1 | -1 = 1): void {
    const top = Math.floor(scroller.scrollTop / ROW_HEIGHT);
    const current =
      state.selected !== null ? visible.findIndex((l) => l.number === state.selected) : direction > 0 ? top - 1 : top;
    const target = findJump(visible, current, predicate, direction);
    if (target >= 0) scrollToIndex(target, true);
    else showToast(NOTHING[kind][kind !== 'match' && allLines.some(predicate) ? 1 : 0]);
  }

  /** n / N: the next or previous search match, skipping the context lines around the matches. */
  function jumpToMatch(direction: 1 | -1): void {
    if (!state.query || state.searchError) return;
    jumpToNext((l) => !l.isContext, 'match', direction);
  }

  /**
   * A field condition worth trying on this log, for the search box's placeholder and the tips:
   * status>=500 says more than time=….
   */
  function fieldExample(): string | null {
    if (fields.includes('status')) return 'status>=500';
    const duration = ['duration', 'took', 'elapsed', 'latency'].find((key) => fields.includes(key));
    if (duration) return `${duration}>1s`;
    if (fields.includes('level')) return 'level=error';
    const key = ['service', 'method', 'logger', 'app', 'user'].find((name) => fields.includes(name));
    if (!key) return null;
    const value = allLines
      .slice(0, 500)
      .map((line) => fieldValue(line, key))
      .find((v) => v && /^[\w.@/:-]+$/.test(v));
    return value ? `${key}=${value}` : null;
  }

  let fieldMode = false;
  /** The text part of the search, highlighted in the lines: without its field conditions and -words. */
  let searchText = '';
  const clock = (t: number) => formatTime(t, state.timeMode).slice(11, 19);

  /**
   * The first line of the entry a line is in. In a log with timestamps that is the last line
   * with a time; its stack trace and the lines it printed come after it.
   */
  function entryHead(number: number): LogLine {
    for (let i = number - 1; i >= 0; i--) if (allLines[i].time !== null) return allLines[i];
    let i = number - 1;
    while (i > 0 && allLines[i].continuation) i--;
    return allLines[i];
  }

  /** Hide lines like this (x): every entry of the kind of the given line's entry. */
  function muteLike(number: number): void {
    const mute = makeMute(entryHead(number));
    if (state.mutes.some((m) => m.key === mute.key)) return;
    state.mutes.push(mute);
    const count = countKind(allLines, mute.key, kindOf);
    showToast(
      tn(
        'viewerMuted',
        count,
        '{n} entry like this hidden · X shows it again',
        '{n} entries like this hidden · X shows them again',
      ),
    );
    void refresh({ keepInspector: true });
  }

  function unmute(mute: Mute): void {
    state.mutes = state.mutes.filter((m) => m !== mute);
    void refresh({ keepInspector: true }).then(showSelection);
  }

  function renderSubbar(): void {
    const range = state.timeRange;
    rangeChip.hidden = range === null;
    if (range) rangeChip.textContent = `⏱ ${clock(range[0])} – ${clock(range[1])} ×`;
    groupChip.hidden = state.group === null;
    if (state.group) groupChip.textContent = `${t('viewerOnlyGroup', 'Only {group}', { group: state.group.label })} ×`;
    columnsLabel.hidden = state.table === null;
    saveButton.title = state.table
      ? t('viewerSaveCsvTitle', 'Download the shown rows as a CSV file')
      : t('viewerSaveTitle', 'Download the visible lines as a file');
    highlightChips.replaceChildren(
      ...state.highlights.map((term, i) => {
        const chip = el(
          'button',
          { className: `toggle hl-chip hl-${i}`, title: t('viewerRemoveHighlight', 'Remove this highlight') },
          `${term} ×`,
        );
        chip.addEventListener('click', () => {
          state.highlights.splice(i, 1);
          void refresh();
        });
        return chip;
      }),
    );
    muteChips.replaceChildren(
      ...state.mutes.map((mute) => {
        const count = countKind(allLines, mute.key, kindOf);
        const chip = el(
          'button',
          {
            className: `toggle mute-chip${mute.level === 'ERROR' ? ' error' : ''}`,
            title: t('viewerUnmuteTitle', 'Show these lines again'),
          },
          `⊘ ${mute.label} (${count.toLocaleString()}) ×`,
        );
        chip.addEventListener('click', () => unmute(mute));
        return chip;
      }),
    );
    subbar.hidden =
      range === null &&
      state.group === null &&
      state.table === null &&
      state.highlights.length === 0 &&
      state.mutes.length === 0 &&
      sourceButtons.length < 2;
    sourceChips.hidden = sourceButtons.length < 2;
    markDrag();
  }

  let regexSearch = new RegexSearch(allLines.map((l) => l.text));
  // another log was opened: let the old search worker and its copy of the lines go
  signal.addEventListener('abort', () => regexSearch.dispose());
  let refreshId = 0;

  /**
   * Plain-text search is linear and runs here. Regex search runs in a worker with a time limit,
   * so a pattern like (a+)+$ can't freeze the tab; results of outdated searches are dropped.
   */
  async function refresh(how: { keepInspector?: boolean } = {}): Promise<void> {
    const id = ++refreshId;
    let error = '';
    let mask: Uint8Array | null = null;
    // the search box takes fields, -words and text together: service=payments timeout -healthz
    const parsed = state.regex ? null : parseQuery(state.query);
    const conditions = parsed?.conditions.length ? parsed.conditions : null;
    const exclude = parsed?.exclude ?? [];
    fieldMode = conditions !== null || exclude.length > 0;
    searchText = parsed ? parsed.text : state.query;
    search.classList.toggle('fields', fieldMode);
    if (state.query && state.regex) {
      status.textContent = t('viewerSearching', 'Searching…');
      const result = await regexSearch.search(state.query, state.caseSensitive);
      if (id !== refreshId || 'superseded' in result) return;
      if ('error' in result) error = result.error;
      else mask = result.mask;
    }
    state.searchError = error;
    search.classList.toggle('invalid', error !== '');
    search.title = error;

    // fields, time range and pods narrow the lines first; levels and search then filter what's left
    let base = conditions ? filterByFields(allLines, conditions) : allLines;
    base = excludeWords(base, exclude, state.caseSensitive);
    const range = state.timeRange;
    if (range) base = base.filter((l) => times[l.number - 1] >= range[0] && times[l.number - 1] < range[1]);
    if (state.hiddenSources.size > 0) base = base.filter((l) => l.source === null || !state.hiddenSources.has(l.source));
    const muted = hideMuted(base, new Set(state.mutes.map((mute) => mute.key)), kindOf);
    base = muted.lines;
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
    } else {
      filtered = filterLines(base, {
        ...state,
        query: searchText,
        mask: mask ?? undefined,
        context: state.context,
      });
    }
    // a search or an error group looks inside closed sections too
    if (groups.length > 0 && !state.query && !state.group) filtered = foldGroups(filtered, groups, openGroups);
    visible = state.collapse ? collapseRepeats(filtered, signatureOf) : filtered.map(rowOf);
    spacer.style.height = `${visible.length * ROW_HEIGHT}px`;
    const conditionNote =
      (conditions ? ` · ${tn('viewerFieldConditions', conditions.length, '{n} field condition', '{n} field conditions')}` : '') +
      (exclude.length ? ` · ${tn('viewerExcludedWords', exclude.length, '{n} word left out', '{n} words left out')}` : '');
    const matchCount = state.query || mask ? filtered.filter((l) => !l.isContext).length : visible.length;
    status.textContent =
      error ||
      t('viewerStatus', '{shown} / {total} lines', {
        shown: matchCount.toLocaleString(),
        total: allLines.length.toLocaleString(),
      }) +
        conditionNote +
        (muted.hidden > 0 ? ` · ${tn('viewerHiddenNote', muted.hidden, '{n} line hidden', '{n} lines hidden')}` : '');
    syncAddress();
    renderSubbar();
    if (!how.keepInspector || inspector.hidden || !visible.some((l) => l.number === state.selected)) renderInspector();
    render();
    minimap.draw(visible, state.bookmarks);
    renderEmptyState();
  }

  function renderEmptyState(): void {
    emptyState.hidden = visible.length > 0;
    if (emptyState.hidden) return;
    if (allLines.length === 0) {
      emptyState.replaceChildren(el('p', {}, t('viewerEmptyFile', 'This log is empty.')));
      return;
    }
    const actions: HTMLElement[] = [];
    const action = (label: string, run: () => void) => {
      const button = el('button', { className: 'toggle' }, label);
      button.addEventListener('click', run);
      actions.push(button);
    };
    if (state.query) {
      action(t('viewerClearSearch', 'Clear the search'), () => {
        search.value = state.query = '';
        void refresh();
        scroller.focus();
      });
    }
    const levelsOff = Object.entries(chipCounts).filter(([key, entry]) => {
      if (entry![0].hidden) return false;
      return key === 'UNKNOWN' ? !state.includeUnknown : !state.levels.has(key as Level);
    });
    if (levelsOff.length > 0) {
      action(t('viewerShowAllLevels', 'Show all levels'), () => {
        for (const [key, entry] of levelsOff) {
          if (key === 'UNKNOWN') state.includeUnknown = true;
          else state.levels.add(key as Level);
          setPressed(entry![0], true);
        }
        void refresh();
      });
    }
    if (state.timeRange) {
      action(t('viewerRangeTitle', 'Show all times again'), () => {
        state.timeRange = null;
        void refresh();
      });
    }
    const message = state.query
      ? t('viewerNoMatch', 'No lines match “{query}”', { query: state.query })
      : t('viewerNothingShown', 'The filters leave no lines to show');
    emptyState.replaceChildren(el('p', {}, message), el('div', { className: 'empty-actions' }, ...actions));
  }

  // looked up once: render() runs on every scroll
  const gapTitle = t('viewerGapTitle', 'Pause since the previous entry');
  const repeatTitle = t('viewerRepeatTitle', 'Similar consecutive lines');
  const lineLinkTitle = t('viewerLineLinkTitle', 'Copy a link to this line (Shift+click: to the lines from the selected one)');

  function render(): void {
    const range = selectedRange();
    const first = Math.max(0, Math.floor(scroller.scrollTop / ROW_HEIGHT) - OVERSCAN);
    const count = Math.ceil(scroller.clientHeight / ROW_HEIGHT) + OVERSCAN * 2;
    const slice = visible.slice(first, first + count);
    rows.style.transform = `translateY(${first * ROW_HEIGHT}px)`;
    rows.replaceChildren(
      ...slice.map((line) => {
        const classes = ['row', `lvl-${line.level ?? 'UNKNOWN'}`];
        if (line.continuation) classes.push('cont');
        if (line.secret) classes.push('has-secret');
        if (line.isContext) classes.push('context');
        if (line.gapAbove) classes.push('gap-above');
        if (range ? line.number >= range[0] && line.number <= range[1] : line.number === state.selected) classes.push('selected');
        if (state.bookmarks.has(line.number)) classes.push('bookmarked');
        const row = el('div', { className: classes.join(' ') });
        row.dataset.number = String(line.number);

        const gap = el('span', { className: state.showGaps ? 'gap' : 'gap off' });
        if (state.showGaps && line.gap !== null && line.gap >= gapThreshold) {
          gap.textContent = formatGap(line.gap);
          gap.title = gapTitle;
          if (line.gap >= 10_000) gap.classList.add('big');
        }
        const txt = el('span', { className: 'txt' });
        const group = groupByStart.get(line.number);
        if (group) {
          const open = openGroups.has(group.start);
          row.classList.add('group-head');
          const size = group.end - group.start;
          txt.append(
            el(
              'span',
              {
                className: 'fold-toggle',
                title: open ? t('viewerSectionHide', 'Hide this section') : t('viewerSectionShow', 'Show this section'),
              },
              `${open ? '▾' : '▸'} ${tn('viewerSectionLines', size, '{n} line', '{n} lines')}`,
            ),
          );
          if (group.errors > 0) {
            txt.append(el('span', { className: 'group-errors' }, `✖ ${group.errors.toLocaleString()}`));
          }
        }
        if (line.repeat > 1) {
          txt.append(el('span', { className: 'repeat', title: repeatTitle }, `×${line.repeat}`));
        }
        if (state.table && line.json) {
          const { cells, rest } = tableCells(line, state.table);
          txt.classList.add('table');
          for (const cell of cells)
            txt.append(el('span', { className: 'cell', title: cell }, localizeTimestamp(cell, state.timeMode)));
          txt.append(el('span', { className: 'rest' }, state.maskSecrets ? maskSecrets(rest) : rest));
        } else {
          appendText(txt, line, ROW_TEXT_LIMIT);
        }
        row.append(el('span', { className: 'ln', title: lineLinkTitle }, String(line.number)), gap, txt);
        return row;
      }),
    );
  }

  /** Sets the view up as a link describes it: the filters, then the line or the range of lines. */
  function applyLink(link: ViewLink): void {
    if (link.levels) {
      const shown = new Set<string>(link.levels);
      for (const [key, entry] of Object.entries(chipCounts)) {
        const level = key as Level | 'UNKNOWN';
        // a level this log doesn't have stays on: its chip is hidden, nobody could switch it back
        const on = counts[level] === 0 || shown.has(level === 'UNKNOWN' ? 'OTHER' : level);
        if (level === 'UNKNOWN') state.includeUnknown = on;
        else if (on) state.levels.add(level);
        else state.levels.delete(level);
        setPressed(entry![0], on);
      }
    }
    search.value = state.query = link.query;
    state.regex = link.regex;
    setPressed(regexToggle, link.regex);
    state.caseSensitive = link.caseSensitive;
    setPressed(caseToggle, link.caseSensitive);
    // without timestamps there is no timeline to show the range on, or to take it off again
    if (link.timeRange && timeline !== null) state.timeRange = link.timeRange;
    if ((link.pods || link.hiddenPods) && sourceButtons.length >= 2) {
      sourceButtons.forEach((button, i) => {
        const source = chipSources[i];
        const hidden = link.pods ? !link.pods.includes(source) : link.hiddenPods!.includes(source);
        if (hidden) state.hiddenSources.add(source);
        setPressed(button, !hidden);
      });
    }
    for (const number of link.mutes ?? []) {
      if (number > allLines.length) continue;
      const mute = makeMute(entryHead(number));
      if (!state.mutes.some((m) => m.key === mute.key)) state.mutes.push(mute);
    }
    if (link.line !== null && link.line <= allLines.length) {
      state.selected = link.line;
      const end = link.lineEnd === null ? null : Math.min(link.lineEnd, allLines.length);
      state.selectedTo = end === link.line ? null : end;
      // open the sections these lines are folded in
      const last = state.selectedTo ?? link.line;
      for (const group of groups) if (link.line <= group.end && last > group.start) openGroups.add(group.start);
    }
  }

  /** Scrolls to the selected line or range; if a filter hides it, to where it would be. */
  function showSelection(): void {
    if (state.selected === null) return;
    const [first, last] = selectedRange() ?? [state.selected, state.selected];
    let index = visible.findIndex((l) => l.number >= first);
    if (index < 0 || visible[index].number > last) index = Math.max(0, (index < 0 ? visible.length : index) - 1);
    if (visible.length === 0) return;
    scroller.scrollTop = Math.max(0, index * ROW_HEIGHT - scroller.clientHeight / 3);
    render();
  }

  /**
   * One line of tips under the toolbar for the first few logs, made from this log: the keys and
   * a field condition it actually has, so the ways in are in front of people who never press ?.
   */
  function buildHint(): void {
    const items: Child[][] = [];
    if (counts.ERROR > 0) items.push([el('kbd', {}, 'e'), ` ${t('viewerHintNextError', 'next error')}`]);
    const example = fieldExample();
    if (example) {
      const tryIt = el('button', { className: 'hint-example', title: t('viewerHintTry', 'Try it') }, example);
      tryIt.addEventListener('click', () => {
        search.value = example;
        search.dispatchEvent(new Event('input'));
      });
      items.push([`${t('viewerHintField', 'filter by a field')} `, tryIt]);
    }
    items.push([t('viewerHintClickLine', 'click a line for details')]);
    if (timeline) items.push([t('viewerHintDrag', 'drag across the timeline to keep a time range')]);
    items.push([el('kbd', {}, '?'), ` ${t('viewerHintKeys', 'all keys')}`]);
    const close = el('button', { className: 'hint-close', title: t('viewerHintClose', 'Don’t show tips again') }, '×');
    close.addEventListener('click', () => {
      hintBar.hidden = true;
      void loadSettings()
        .then((settings) => saveSettings({ ...settings, hintViews: HINT_VIEWS }))
        .catch(() => undefined);
    });
    hintBar.replaceChildren(
      el('span', { className: 'hint-label' }, t('viewerHintTitle', 'Tips')),
      ...items.map((children, i) => el('span', { className: 'hint-item' }, ...(i > 0 ? ['· '] : []), ...children)),
      close,
    );
    hintBar.hidden = false;
  }
  if (options.hint) buildHint();

  // a link opens the same view: #L120, #L120-L135, and the filters after them
  const link = parseViewLink(location.hash);
  if (link) applyLink(link);
  updateBookmarkButtons();
  void refresh().then(showSelection);
  void loadBookmarks();
  scroller.focus();
  if (options.notice) showToast(options.notice, 4000);
}
