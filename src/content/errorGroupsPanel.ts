import { ErrorGroup, TimeMode, formatTime, groupErrors } from '../lib/insights';
import { LogLine } from '../lib/logs';
import { t, tn } from '../shared/i18n';
import { el } from './dom';

/** How many groups the panel lists; a log with more different errors has bigger problems. */
const MAX_GROUPS = 50;

/**
 * The Groups panel: each different error once, with its count, pods and first and last time.
 * Clicking one calls `pick` to show only that error.
 */
export function renderErrorGroups(
  panel: HTMLElement,
  lines: LogLine[],
  timeMode: TimeMode,
  pick: (group: ErrorGroup) => void,
): void {
  const groups = groupErrors(lines);
  const clock = (ms: number) => formatTime(ms, timeMode).slice(11, 19);
  const items = groups.slice(0, MAX_GROUPS).map((group) => {
    const where = group.sources.length ? ` · ${tn('viewerPods', group.sources.length, '{n} pod', '{n} pods')}` : '';
    const when =
      group.first !== null && group.last !== null && group.last > group.first
        ? ` · ${clock(group.first)}–${clock(group.last)}`
        : '';
    const item = el(
      'button',
      { className: 'group-item', title: t('viewerGroupItemTitle', 'Show only this error') },
      el('span', { className: 'n' }, `×${group.count}`),
      el('span', { className: 'sample' }, group.sample),
      el('span', { className: 'meta' }, `${where}${when}`),
    );
    item.addEventListener('click', () => pick(group));
    return item;
  });
  panel.replaceChildren(
    el(
      'div',
      { className: 'groups-head' },
      tn('viewerDifferentErrors', groups.length, '{n} different error', '{n} different errors'),
    ),
    ...(items.length ? items : [el('div', { className: 'facts' }, t('viewerNoErrors', 'No errors in this log.'))]),
  );
}
