/**
 * A strip next to the scrollbar with a mark for every error, warning and bookmark among the shown
 * lines, so you see at a glance where in a long log the trouble is. Click or drag on it to go there.
 */
import { CollapsedLine } from '../lib/logs';
import { t } from '../shared/i18n';
import { el } from './dom';

export interface Minimap {
  element: HTMLElement;
  /** Draws the marks again: after the shown lines or the bookmarks change, or the window is resized. */
  draw(lines: CollapsedLine[], bookmarks: ReadonlyMap<number, string>): void;
  /** Moves the box that shows the part of the log on screen; cheap, for every scroll. */
  follow(): void;
}

const WIDTH = 14;

export function createMinimap(options: {
  scroller: HTMLElement;
  rowHeight: number;
  signal: AbortSignal;
  /** Shows the line at this index of the shown lines. */
  scrollTo: (index: number) => void;
}): Minimap {
  const { scroller, rowHeight, signal } = options;
  const canvas = el('canvas', { className: 'minimap-marks' });
  const view = el('div', { className: 'minimap-view' });
  const element = el(
    'div',
    {
      className: 'minimap',
      title: t('viewerMinimapTitle', 'Errors, warnings and bookmarks in the shown lines: click to go there'),
    },
    canvas,
    view,
  );
  // the keyboard has e, w and b for the same jumps, so screen readers can skip the strip
  element.setAttribute('aria-hidden', 'true');
  element.hidden = true;
  let count = 0;

  const color = (name: string) => getComputedStyle(element).getPropertyValue(name).trim() || '#888';

  function follow(): void {
    if (element.hidden) return;
    const height = element.clientHeight;
    const total = Math.max(scroller.scrollHeight, 1);
    view.style.top = `${(scroller.scrollTop / total) * height}px`;
    view.style.height = `${Math.max(6, (scroller.clientHeight / total) * height)}px`;
  }

  function draw(lines: CollapsedLine[], bookmarks: ReadonlyMap<number, string>): void {
    count = lines.length;
    // nothing to find when the whole log fits on the screen
    element.hidden = count * rowHeight <= scroller.clientHeight;
    if (element.hidden) return;
    const height = element.clientHeight;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = WIDTH * ratio;
    canvas.height = Math.max(1, Math.round(height * ratio));
    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(ratio, ratio);
    const mark = Math.max(2, height / count);
    const colors = { ERROR: color('--error'), WARN: color('--warn'), bookmark: color('--accent') };
    // warnings first, so an error on the same pixel stays visible; bookmarks on top
    for (const pass of ['WARN', 'ERROR', 'bookmark'] as const) {
      context.fillStyle = colors[pass];
      let last = -1;
      lines.forEach((line, i) => {
        const hit = pass === 'bookmark' ? bookmarks.has(line.number) : line.level === pass && !line.continuation;
        if (!hit) return;
        const y = Math.floor((i / count) * height);
        if (y === last) return;
        last = y;
        if (pass === 'WARN') context.fillRect(2, y, WIDTH / 2 - 2, mark);
        else if (pass === 'ERROR') context.fillRect(2, y, WIDTH - 4, mark);
        else context.fillRect(0, y, WIDTH, Math.max(mark, 3));
      });
    }
    follow();
  }

  const go = (event: PointerEvent) => {
    const box = element.getBoundingClientRect();
    const share = Math.min(Math.max((event.clientY - box.top) / Math.max(box.height, 1), 0), 1);
    options.scrollTo(Math.min(count - 1, Math.floor(share * count)));
  };
  element.addEventListener(
    'pointerdown',
    (event) => {
      if (count === 0) return;
      event.preventDefault();
      element.setPointerCapture(event.pointerId);
      go(event);
    },
    { signal },
  );
  element.addEventListener(
    'pointermove',
    (event) => {
      if (element.hasPointerCapture(event.pointerId)) go(event);
    },
    { signal },
  );

  return { element, draw, follow };
}
