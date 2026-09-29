import { findTransform } from '../lib/transforms';

/**
 * Result panel for the context-menu tools. It reads the exact selection (Chrome's menu
 * selectionText drops line breaks), shows the result in a Shadow DOM so page styles
 * can't break it, and can write the result back into an input, textarea or editor.
 */

type Source =
  | { kind: 'field'; element: HTMLInputElement | HTMLTextAreaElement; start: number; end: number }
  | { kind: 'editable'; element: HTMLElement; range: Range }
  | { kind: 'page' };

interface PanelApi {
  run(id: string): void;
}

declare global {
  interface Window {
    __logbeamPanel?: PanelApi;
  }
}

function captureSelection(): { text: string; source: Source } {
  const active = document.activeElement;
  if (
    (active instanceof HTMLTextAreaElement || (active instanceof HTMLInputElement && /^(text|search|url|email|)$/.test(active.type))) &&
    active.selectionStart !== null &&
    active.selectionEnd !== null
  ) {
    const start = active.selectionStart;
    const end = active.selectionEnd;
    // nothing selected in a field: work on the whole value
    if (start === end) {
      return { text: active.value, source: { kind: 'field', element: active, start: 0, end: active.value.length } };
    }
    return { text: active.value.slice(start, end), source: { kind: 'field', element: active, start, end } };
  }

  const selection = window.getSelection();
  const text = selection?.toString() ?? '';
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const element = container instanceof HTMLElement ? container : container.parentElement;
    const editable = element?.closest<HTMLElement>('[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]');
    if (editable) {
      return { text, source: { kind: 'editable', element: editable, range: range.cloneRange() } };
    }
  }
  return { text, source: { kind: 'page' } };
}

function replaceSource(source: Source, value: string): boolean {
  if (source.kind === 'field') {
    const { element, start, end } = source;
    element.focus();
    element.setRangeText(value, start, end, 'select');
    // let frameworks (React, Vue) notice the change
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  if (source.kind === 'editable') {
    source.element.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(source.range);
    // execCommand keeps the editor's undo history, unlike changing the DOM directly
    return document.execCommand('insertText', false, value);
  }
  return false;
}

const STYLE = `
  :host { all: initial; }
  .panel {
    position: fixed; top: 16px; right: 16px; z-index: 2147483647;
    width: min(520px, calc(100vw - 32px)); max-height: min(70vh, 640px);
    display: flex; flex-direction: column;
    background: #0f1419; color: #e6e1cf; border: 1px solid #2d3640; border-radius: 10px;
    box-shadow: 0 12px 32px rgba(0,0,0,.45);
    font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #2d3640; }
  .title { font-weight: 600; flex: 1; }
  .brand { color: #ffb454; font-weight: 700; }
  pre {
    margin: 0; padding: 12px; overflow: auto; flex: 1; white-space: pre-wrap; word-break: break-word;
    font: 12.5px/1.5 ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace;
  }
  .error { color: #ff6b6b; }
  footer { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid #2d3640; justify-content: flex-end; }
  button {
    font: inherit; cursor: pointer; border-radius: 6px; padding: 5px 12px;
    border: 1px solid #3a4550; background: #1a222b; color: #e6e1cf;
  }
  button:hover { border-color: #ffb454; }
  button.primary { background: #ffb454; color: #0f1419; border-color: #ffb454; font-weight: 600; }
  .close { border: none; background: none; font-size: 18px; line-height: 1; padding: 2px 6px; }
`;

let host: HTMLElement | null = null;

function close(): void {
  host?.remove();
  host = null;
  document.removeEventListener('keydown', onKeyDown, true);
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    close();
  }
}

function show(title: string, output: string, isError: boolean, source: Source): void {
  close();
  host = document.createElement('logbeam-panel');
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLE;

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', `Logbeam: ${title}`);

  const header = document.createElement('header');
  const brand = document.createElement('span');
  brand.className = 'brand';
  brand.textContent = 'Logbeam';
  const titleEl = document.createElement('span');
  titleEl.className = 'title';
  titleEl.textContent = title;
  const closeButton = document.createElement('button');
  closeButton.className = 'close';
  closeButton.textContent = '×';
  closeButton.title = 'Close (Esc)';
  closeButton.addEventListener('click', close);
  header.append(brand, titleEl, closeButton);

  const pre = document.createElement('pre');
  pre.textContent = output;
  if (isError) pre.classList.add('error');

  const footer = document.createElement('footer');
  if (!isError) {
    const copy = document.createElement('button');
    copy.textContent = 'Copy';
    copy.addEventListener('click', async () => {
      await navigator.clipboard.writeText(output);
      copy.textContent = 'Copied ✓';
    });
    footer.append(copy);

    if (source.kind !== 'page') {
      const replace = document.createElement('button');
      replace.className = 'primary';
      replace.textContent = 'Replace selection';
      replace.addEventListener('click', () => {
        if (replaceSource(source, output)) close();
        else replace.textContent = 'Could not replace';
      });
      footer.append(replace);
    }
  }

  panel.append(header, pre, footer);
  shadow.append(style, panel);
  document.documentElement.append(host);
  document.addEventListener('keydown', onKeyDown, true);
}

function run(id: string): void {
  const transform = findTransform(id);
  if (!transform) return;
  const { text, source } = captureSelection();
  if (!text.trim()) {
    show(transform.title, 'Select some text first.', true, source);
    return;
  }
  try {
    show(transform.title, transform.apply(text), false, source);
  } catch (e) {
    show(transform.title, (e as Error).message, true, source);
  }
}

if (!window.__logbeamPanel) {
  window.__logbeamPanel = { run };
}
