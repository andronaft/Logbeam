import { t, tn } from '../shared/i18n';
import { el } from './dom';

/** A long range is shown from its start; Copy lines still copies all of it. */
const SHOWN_LINES = 200;

export interface RangeView {
  from: number;
  to: number;
  /** The lines of the range that the filters show, as they are on screen (masked, local time). */
  lines: string[];
  /** The time from the first line to the last, e.g. "2.4s"; empty when there are no timestamps. */
  span: string;
  onCopyLines: () => void;
  onCopyLink: () => void;
  onClose: () => void;
}

/**
 * The inspector for a range of lines picked with Shift+click: how many lines and how long they
 * took, and buttons to copy the lines or a link that opens with them selected.
 */
export function renderRange(panel: HTMLElement, range: RangeView): void {
  const total = range.to - range.from + 1;
  const facts = [t('viewerRangeLines', 'Lines {from}–{to}', { from: range.from, to: range.to })];
  facts.push(
    range.lines.length === total
      ? tn('viewerSectionLines', total, '{n} line', '{n} lines')
      : // the rest is hidden by a filter, folded in a section or collapsed as a repeat
        t('viewerRangeShown', '{shown} of {total} lines shown', {
          shown: range.lines.length.toLocaleString(),
          total: total.toLocaleString(),
        }),
  );
  if (range.span) facts.push(t('viewerTraceOver', 'over {time}', { time: range.span }));

  const copyLines = el('button', { className: 'toggle copy-lines' }, t('viewerCopyLines', 'Copy lines'));
  copyLines.addEventListener('click', range.onCopyLines);
  const copyLink = el('button', { className: 'toggle' }, t('viewerCopyLink', 'Copy link'));
  copyLink.addEventListener('click', range.onCopyLink);
  const close = el('button', { className: 'toggle', title: t('viewerCloseTitle', 'Close ( Esc )') }, '×');
  close.addEventListener('click', range.onClose);

  const more = range.lines.length - SHOWN_LINES;
  const text = range.lines.slice(0, SHOWN_LINES).join('\n');
  panel.replaceChildren(
    el('div', { className: 'inspector-head' }, el('span', { className: 'facts' }, facts.join(' · ')), copyLines, copyLink, close),
    el('pre', { className: 'full-text range-text' }, text),
    ...(more > 0
      ? [el('div', { className: 'facts' }, tn('viewerRangeMore', more, '… and {n} more line', '… and {n} more lines'))]
      : []),
  );
}
