import {
  JsonChange,
  canonicalJson,
  changedSpans,
  diffJson,
  diffLines,
  normalizeLogLine,
  normalizeWhitespace,
  parseJsonDocument,
  previewJson,
} from '../lib/diff';
import { splitLines } from '../lib/logs';
import { maskSecrets, setCustomSecretPatterns } from '../lib/secrets';
import { loadSettings } from '../shared/settings';
import { COMPARE_UPDATED, CompareInputs, loadCompareInputs, saveCompareInputs } from '../shared/compare';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const left = $<HTMLTextAreaElement>('left');
const right = $<HTMLTextAreaElement>('right');
const mode = $<HTMLSelectElement>('mode');
const ignoreVolatile = $<HTMLInputElement>('ignore-volatile');
const ignoreSpace = $<HTMLInputElement>('ignore-space');
const mask = $<HTMLInputElement>('mask');
const summary = $('summary');
const changesEl = $('changes');
const result = $('result');

/** Unchanged lines kept around each change; longer unchanged runs are folded. */
const CONTEXT = 3;
/** Rows drawn before "Show all" so a diff of two huge, very different logs stays responsive. */
const ROW_LIMIT = 5000;

let names: Pick<CompareInputs, 'leftName' | 'rightName'> = {};
let showAll = false;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const element = Object.assign(document.createElement(tag), props);
  element.append(...children);
  return element;
}

// ---- comparing -------------------------------------------------------------------------

function compare(): void {
  const before = left.value;
  const after = right.value;
  for (const section of [summary, changesEl, result]) section.replaceChildren();
  if (!before.trim() || !after.trim()) {
    summary.hidden = changesEl.hidden = result.hidden = true;
    return;
  }

  const wantJson = mode.value !== 'text';
  const beforeJson = wantJson ? parseJsonDocument(before) : null;
  const afterJson = wantJson ? parseJsonDocument(after) : null;
  const asJson = beforeJson !== null && afterJson !== null;
  if (mode.value === 'json' && !asJson) {
    summary.hidden = false;
    changesEl.hidden = result.hidden = true;
    summary.append(
      `${beforeJson === null ? 'Before' : 'After'} isn’t valid JSON. Choose “Text / log” to compare it line by line.`,
    );
    return;
  }

  // JSON is compared by structure, and shown as a text diff of both sides with sorted keys
  const leftLines = asJson ? canonicalJson(beforeJson).split('\n') : splitLines(before);
  const rightLines = asJson ? canonicalJson(afterJson).split('\n') : splitLines(after);
  const key = (line: string) => {
    let k = line;
    if (ignoreVolatile.checked && !asJson) k = normalizeLogLine(k);
    if (ignoreSpace.checked) k = normalizeWhitespace(k);
    return k;
  };
  const diff = diffLines(leftLines.map(key), rightLines.map(key));

  summary.hidden = false;
  summary.append(
    asJson ? 'Compared as JSON (key order ignored): ' : 'Compared line by line: ',
    el('b', { className: 'add' }, `+${diff.added}`),
    ' ',
    el('b', { className: 'del' }, `−${diff.removed}`),
    ` lines`,
  );
  if (names.leftName || names.rightName) {
    summary.append(el('span', { className: 'note' }, `${names.leftName ?? 'Before'} → ${names.rightName ?? 'After'}`));
  }
  if (diff.added + diff.removed === 0) {
    summary.append(el('span', { className: 'note' }, 'No differences.'));
  }
  if (diff.approximate) {
    summary.append(el('span', { className: 'note' }, 'The texts differ a lot, so the changed part is shown as replaced.'));
  }

  if (asJson) renderJsonChanges(diffJson(beforeJson, afterJson));
  else changesEl.hidden = true;
  renderLines(diff.ops, leftLines, rightLines, key);
}

function renderJsonChanges(changes: JsonChange[]): void {
  changesEl.hidden = changes.length === 0;
  if (changes.length === 0) return;
  const show = (value: unknown) => (mask.checked ? maskSecrets(previewJson(value)) : previewJson(value));
  const rows = changes.map((change) =>
    el(
      'tr',
      {},
      el('td', { className: `kind ${change.kind}` }, change.kind),
      el('td', { className: 'path' }, change.path),
      el('td', { className: 'before' }, change.kind === 'added' ? '' : show(change.before)),
      el('td', { className: 'after' }, change.kind === 'removed' ? '' : show(change.after)),
    ),
  );
  changesEl.append(el('table', {}, el('tbody', {}, ...rows)));
}

type Op = ReturnType<typeof diffLines>['ops'][number];

function renderLines(ops: Op[], leftLines: string[], rightLines: string[], key: (text: string) => string): void {
  result.hidden = false;
  const show = (text: string) => (mask.checked ? maskSecrets(text) : text);
  const fragment = document.createDocumentFragment();
  let drawn = 0;

  const row = (op: Op, highlight?: [number, number][]) => {
    const text = show(op.kind === 'add' ? rightLines[op.right!] : leftLines[op.left!]);
    const content = el('span', { className: 'text' });
    // masking changes the text's length, so the marks would land in the wrong place
    if (highlight && !mask.checked) {
      let at = 0;
      for (const [start, end] of highlight) {
        content.append(text.slice(at, start), el('mark', {}, text.slice(start, end)));
        at = end;
      }
      content.append(text.slice(at));
    } else {
      content.append(text);
    }
    drawn++;
    return el(
      'div',
      { className: `line ${op.kind}` },
      el('span', { className: 'ln' }, op.left === undefined ? '' : String(op.left + 1)),
      el('span', { className: 'ln' }, op.right === undefined ? '' : String(op.right + 1)),
      el('span', { className: 'sign' }, op.kind === 'add' ? '+' : op.kind === 'del' ? '−' : ' '),
      content,
    );
  };

  // which unchanged lines are close enough to a change to be shown
  const near = new Uint8Array(ops.length);
  ops.forEach((op, i) => {
    if (op.kind === 'same') return;
    for (let j = Math.max(0, i - CONTEXT); j <= Math.min(ops.length - 1, i + CONTEXT); j++) near[j] = 1;
  });

  let i = 0;
  while (i < ops.length && (showAll || drawn < ROW_LIMIT)) {
    const op = ops[i];
    if (op.kind === 'same' && !near[i]) {
      let end = i;
      while (end < ops.length && ops[end].kind === 'same' && !near[end]) end++;
      const folded = ops.slice(i, end);
      const fold = el('button', { className: 'fold' }, `⋯ ${folded.length.toLocaleString()} unchanged lines`);
      fold.addEventListener('click', () => fold.replaceWith(...folded.map((same) => row(same))));
      fragment.append(fold);
      i = end;
      continue;
    }
    if (op.kind === 'del') {
      // pair a run of removed lines with the added lines after it, to mark what changed inside them
      let delEnd = i;
      while (delEnd < ops.length && ops[delEnd].kind === 'del') delEnd++;
      let addEnd = delEnd;
      while (addEnd < ops.length && ops[addEnd].kind === 'add') addEnd++;
      const pairs = Math.min(delEnd - i, addEnd - delEnd);
      const ranges = Array.from({ length: pairs }, (_, p) =>
        changedSpans(leftLines[ops[i + p].left!], rightLines[ops[delEnd + p].right!], key),
      );
      for (let j = i; j < delEnd; j++) fragment.append(row(ops[j], ranges[j - i]?.before));
      for (let j = delEnd; j < addEnd; j++) fragment.append(row(ops[j], ranges[j - delEnd]?.after));
      i = addEnd;
      continue;
    }
    fragment.append(row(op));
    i++;
  }
  if (i < ops.length) {
    const more = el('button', { className: 'fold' }, `Show all ${ops.length.toLocaleString()} lines`);
    more.addEventListener('click', () => {
      showAll = true;
      compare();
    });
    fragment.append(more);
  }
  if (ops.length === 0) fragment.append(el('div', { className: 'empty' }, 'Both sides are empty.'));
  result.replaceChildren(fragment);
}

// ---- inputs ------------------------------------------------------------------------------

let timer: ReturnType<typeof setTimeout> | undefined;
function scheduleCompare(): void {
  clearTimeout(timer);
  timer = setTimeout(() => {
    showAll = false;
    compare();
    void saveCompareInputs({ left: left.value, right: right.value, ...names });
  }, 250);
}

async function loadInputs(): Promise<void> {
  const inputs = await loadCompareInputs();
  left.value = inputs.left;
  right.value = inputs.right;
  names = { leftName: inputs.leftName, rightName: inputs.rightName };
  compare();
}

function readFile(file: File, target: HTMLTextAreaElement, side: 'leftName' | 'rightName'): void {
  void file.text().then((text) => {
    target.value = text;
    names[side] = file.name;
    scheduleCompare();
  });
}

for (const [area, side, picker] of [
  [left, 'leftName', 'left-file'],
  [right, 'rightName', 'right-file'],
] as const) {
  area.addEventListener('input', () => {
    names[side] = undefined;
    scheduleCompare();
  });
  area.addEventListener('dragover', (event) => {
    event.preventDefault();
    area.classList.add('dragging');
  });
  area.addEventListener('dragleave', () => area.classList.remove('dragging'));
  area.addEventListener('drop', (event) => {
    area.classList.remove('dragging');
    const file = event.dataTransfer?.files[0];
    if (!file) return;
    event.preventDefault();
    readFile(file, area, side);
  });
  const input = $<HTMLInputElement>(picker);
  input.addEventListener('change', () => {
    if (input.files?.[0]) readFile(input.files[0], area, side);
    input.value = '';
  });
}

for (const control of [mode, ignoreVolatile, ignoreSpace, mask]) control.addEventListener('change', scheduleCompare);

$('swap').addEventListener('click', () => {
  [left.value, right.value] = [right.value, left.value];
  names = { leftName: names.rightName, rightName: names.leftName };
  scheduleCompare();
});
$('clear').addEventListener('click', () => {
  left.value = right.value = '';
  names = {};
  scheduleCompare();
  left.focus();
});

// the context menu or a log viewer added a text: show it and come to the front
chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
  if (message?.type !== COMPARE_UPDATED) return;
  void loadInputs();
  void chrome.tabs.getCurrent().then((tab) => {
    if (tab?.id !== undefined) void chrome.tabs.update(tab.id, { active: true });
    if (tab?.windowId !== undefined) void chrome.windows.update(tab.windowId, { focused: true });
  });
  sendResponse(true);
});

void loadSettings().then((settings) => {
  setCustomSecretPatterns(settings.customSecrets);
  return loadInputs();
});
