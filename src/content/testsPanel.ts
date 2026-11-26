import { FailedTest, TestReport } from '../lib/tests';
import { t, tn } from '../shared/i18n';
import { el } from './dom';

/** How many tests the panel lists; a run with more failures has one cause to find first. */
const MAX_TESTS = 200;

/**
 * The Tests panel: the tests a CI log says failed, from any runner, in the order they failed, the
 * first one marked. Clicking one calls `pick` to go to the line where it failed.
 */
export function renderFailedTests(panel: HTMLElement, report: TestReport, pick: (test: FailedTest) => void): void {
  const { failed, totals } = report;
  const items = failed.slice(0, MAX_TESTS).map((test, i) => {
    const sample = el('span', { className: 'sample' });
    if (i === 0 && failed.length > 1) {
      sample.append(
        el(
          'span',
          {
            className: 'first-badge',
            title: t('viewerFirstTestTitle', 'The first test that failed: often the cause of the ones after it'),
          },
          t('viewerFirstError', 'first'),
        ),
        ' ',
      );
    }
    sample.append(test.name);
    if (test.reason) sample.append(el('span', { className: 'reason' }, ` — ${test.reason}`));
    const item = el(
      'button',
      {
        className: 'group-item test-item',
        title: t('viewerTestItemTitle', 'Go to the line where it failed (line {line})', { line: test.line }),
      },
      el('span', { className: 'n' }, test.runner),
      sample,
      el('span', { className: 'meta' }, test.where ?? ''),
    );
    item.addEventListener('click', () => pick(test));
    return item;
  });
  const head = el(
    'div',
    { className: 'groups-head' },
    el('span', {}, tn('viewerFailedTests', failed.length, '{n} failed test', '{n} failed tests')),
  );
  if (totals) {
    head.append(
      el(
        'span',
        { className: 'test-totals', title: t('viewerTestTotalsTitle', 'From the test runners’ own summaries') },
        tn('viewerTestTotals', totals.failed, '{n} of {total} failed', '{n} of {total} failed', {
          total: totals.total.toLocaleString(),
        }),
      ),
    );
  }
  panel.replaceChildren(head, ...items);
}
