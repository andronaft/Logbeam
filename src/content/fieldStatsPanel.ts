import { fieldStats, formatDuration, numericStats } from '../lib/insights';
import { LogLine } from '../lib/logs';
import { t } from '../shared/i18n';
import { el } from './dom';

/**
 * The inspector's statistics for one field over the lines shown: its top values, and for numbers
 * or durations min, median, p95, p99 and max. Clicking one filters by it through `filter`, with a
 * field query like `status=502` or `duration>=950ms`.
 */
export function renderFieldStats(box: HTMLElement, lines: LogLine[], key: string, filter: (query: string) => void): void {
  const { values, total } = fieldStats(lines, key);
  const max = values[0]?.count ?? 1;
  const numbers = numericStats(lines, key);
  const percentiles: Node[] = [];
  if (numbers) {
    const show = (n: number) =>
      numbers.duration ? formatDuration(n) : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    const parts = [
      [t('viewerStatMin', 'min'), numbers.min],
      [t('viewerStatMedian', 'median'), numbers.median],
      ['p95', numbers.p95],
      ['p99', numbers.p99],
      [t('viewerStatMax', 'max'), numbers.max],
    ] as const;
    percentiles.push(
      el(
        'div',
        { className: 'percentiles' },
        ...parts.map(([name, n]) => {
          const chip = el(
            'button',
            { className: 'percentile', title: t('viewerShowOnly', 'Show only {filter}', { filter: `${key} ≥ ${show(n)}` }) },
            el('span', { className: 'name' }, name),
            ` ${show(n)}`,
          );
          // the entries at or above it: the slow ones
          chip.addEventListener('click', () => filter(`${key}>=${numbers.duration ? `${n}ms` : String(n)}`));
          return chip;
        }),
      ),
    );
  }
  box.replaceChildren(
    el(
      'div',
      { className: 'stats-head' },
      t('viewerStatsHead', '{field}: {n} of the shown entries have it', { field: key, n: total.toLocaleString() }),
    ),
    ...percentiles,
    ...values.map(({ value, count }) => {
      const bar = el('span', { className: 'bar' });
      bar.style.width = `${Math.max(2, Math.round((count / max) * 100))}%`;
      const row = el(
        'button',
        { className: 'stat', title: t('viewerShowOnly', 'Show only {filter}', { filter: `${key}=${value}` }) },
        el('span', { className: 'value' }, value || '""'),
        el('span', { className: 'bar-wrap' }, bar),
        el('span', { className: 'n' }, `×${count.toLocaleString()}`),
      );
      row.addEventListener('click', () => {
        const quoted = /[\s"]/.test(value) || value === '' ? JSON.stringify(value) : value;
        filter(`${key}=${quoted}`);
      });
      return row;
    }),
  );
}
