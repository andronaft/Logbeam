import { ErrorGroup, GroupOrder, TimeMode, formatTime, groupErrors, sortGroups } from '../lib/insights';
import { LogLine } from '../lib/logs';
import { t, tn } from '../shared/i18n';
import { el } from './dom';

/** How many groups the panel lists; a log with more different errors has bigger problems. */
const MAX_GROUPS = 50;

/** Most often or first seen: kept while the browser tab is open, like the panel itself. */
let order: GroupOrder = 'count';

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
  const groups = sortGroups(groupErrors(lines), order);
  // the earliest error is often the cause of the others: marked whichever way they are sorted
  const earliest = groups.length > 1 ? sortGroups(groups, 'first')[0] : null;
  const firstBadge = () =>
    el(
      'span',
      {
        className: 'first-badge',
        title: t('viewerFirstErrorTitle', 'The first error in the log: often the cause of the ones after it'),
      },
      t('viewerFirstError', 'first'),
    );
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
      el('span', { className: 'sample' }, ...(group === earliest ? [firstBadge(), ' '] : []), group.sample),
      el('span', { className: 'meta' }, `${where}${when}`),
    );
    item.addEventListener('click', () => pick(group));
    return item;
  });
  const orderButton = (value: GroupOrder, label: string) => {
    const button = el('button', { className: `toggle${order === value ? ' on' : ''}` }, label);
    button.setAttribute('aria-pressed', String(order === value));
    button.addEventListener('click', () => {
      order = value;
      renderErrorGroups(panel, lines, timeMode, pick);
    });
    return button;
  };
  const orderSwitch = el(
    'span',
    { className: 'group-order' },
    orderButton('count', t('viewerGroupsByCount', 'Most often')),
    orderButton('first', t('viewerGroupsByFirst', 'First seen')),
  );
  orderSwitch.hidden = groups.length < 2;
  panel.replaceChildren(
    el(
      'div',
      { className: 'groups-head' },
      el('span', {}, tn('viewerDifferentErrors', groups.length, '{n} different error', '{n} different errors')),
      orderSwitch,
    ),
    ...(items.length ? items : [el('div', { className: 'facts' }, t('viewerNoErrors', 'No errors in this log.'))]),
  );
}
