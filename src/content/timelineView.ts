import { TimeMode, formatTime } from '../lib/insights';
import { Timeline } from '../lib/timeline';
import { t } from '../shared/i18n';
import { el } from './dom';

export interface TimelineView {
  element: HTMLDivElement;
  /** Draws the bars of a timeline (or nothing when the log has no times). */
  draw(timeline: Timeline | null, timeMode: TimeMode, range: [number, number] | null): void;
  /** Dims the bars outside the chosen time range. */
  mark(range: [number, number] | null): void;
}

/**
 * The error timeline: a bar per time slice with its errors, warnings and other entries. A click on a
 * bar calls `jump` with its start; dragging across bars calls `pickRange` with that time range.
 */
export function createTimelineView(options: {
  signal: AbortSignal;
  jump: (time: number) => void;
  pickRange: (from: number, to: number) => void;
}): TimelineView {
  const element = el('div', { className: 'timeline' });
  let timeline: Timeline | null = null;
  let range: [number, number] | null = null;
  let drag: { from: number; to: number } | null = null;

  function mark(newRange: [number, number] | null): void {
    range = newRange;
    const bars = element.children;
    for (let i = 0; i < bars.length && timeline; i++) {
      const bucket = timeline.buckets[i];
      const dragging = drag !== null && i >= Math.min(drag.from, drag.to) && i <= Math.max(drag.from, drag.to);
      const inRange = range !== null && bucket.to > range[0] && bucket.from < range[1];
      bars[i].classList.toggle('dragging', dragging);
      bars[i].classList.toggle('outside', range !== null && !inRange && !dragging);
    }
  }

  function draw(current: Timeline | null, timeMode: TimeMode, newRange: [number, number] | null): void {
    timeline = current;
    element.replaceChildren();
    if (!current) return;
    const fmt = (ms: number) => formatTime(ms, timeMode).slice(0, 19);
    current.buckets.forEach((bucket, i) => {
      const height = (n: number) => `${Math.round((n / current.max) * 100)}%`;
      const other = bucket.total - bucket.errors - bucket.warnings;
      const bar = el(
        'button',
        {
          className: 'bucket',
          title: `${fmt(bucket.from)} – ${fmt(bucket.to)}\n${t(
            'viewerBucketTitle',
            '{total} entries, {errors} errors, {warnings} warnings',
            { total: bucket.total, errors: bucket.errors, warnings: bucket.warnings },
          )}`,
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
        mark(range);
      });
      bar.addEventListener('pointerenter', () => {
        if (!drag) return;
        drag.to = i;
        mark(range);
      });
      element.append(bar);
    });
    mark(newRange);
  }

  document.addEventListener(
    'pointerup',
    () => {
      if (!drag || !timeline) return;
      const [first, last] = [Math.min(drag.from, drag.to), Math.max(drag.from, drag.to)];
      drag = null;
      mark(range);
      if (first === last) options.jump(timeline.buckets[first].from);
      else options.pickRange(timeline.buckets[first].from, timeline.buckets[last].to);
    },
    { signal: options.signal },
  );

  return { element, draw, mark };
}
