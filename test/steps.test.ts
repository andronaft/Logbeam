import { describe, expect, it } from 'vitest';
import { LogGroup, findGroups, foldGroups, formatStepDuration } from '../src/lib/insights';
import { parseLog } from '../src/lib/logs';

const E = '\x1b';
const steps = (text: string) => findGroups(parseLog(text));
const brief = (groups: LogGroup[]) => groups.map((g) => [g.kind, g.title, g.start, g.end, g.depth, g.durationMs, g.failed]);

describe('GitHub Actions steps', () => {
  const log = [
    '2026-10-04T10:00:00.1000000Z ##[group]Run actions/checkout@v4',
    '2026-10-04T10:00:00.2000000Z with:',
    '2026-10-04T10:00:00.4000000Z ##[endgroup]',
    '2026-10-04T10:00:01.0000000Z Syncing repository: andronaft/Logbeam',
    '2026-10-04T10:00:02.0000000Z ##[group]Run npm test',
    '2026-10-04T10:00:03.0000000Z npm test',
    '2026-10-04T10:00:03.5000000Z ##[endgroup]',
    '2026-10-04T10:03:14.0000000Z tests done',
    '2026-10-04T10:03:14.5000000Z ##[error]Process completed with exit code 1.',
  ].join('\n');

  it('times a step from its header to its last line before the next step, and marks the one that exited', () => {
    expect(brief(steps(log))).toEqual([
      ['gha', 'Run actions/checkout@v4', 1, 3, 0, 900, false],
      ['gha', 'Run npm test', 5, 7, 0, 192_500, true],
    ]);
  });

  it('an exit code of 0 is not a failure', () => {
    expect(steps(log.replace('exit code 1', 'exit code 0'))[1].failed).toBe(false);
  });
});

describe('GitLab sections', () => {
  // as GitLab writes them: the marker, a lone \r, then the header the page shows
  const log = [
    `${E}[0Ksection_start:1700000000:prepare_executor\r${E}[0K${E}[36;1mPreparing the "docker" executor${E}[0;m`,
    'Using Docker executor with image node:20',
    `${E}[0Ksection_end:1700000005:prepare_executor\r${E}[0K`,
    `${E}[0Ksection_start:1700000005:step_script[collapsed=true]\r${E}[0K${E}[36;1mExecuting "step_script" stage${E}[0;m`,
    `${E}[0Ksection_start:1700000006:npm_ci\r${E}[0KInstall`,
    'added 812 packages',
    `${E}[0Ksection_end:1700000040:npm_ci\r${E}[0K`,
    '$ npm test',
    'npm ERR! Test failed.',
    `${E}[0Ksection_end:1700000197:step_script\r${E}[0K`,
    `${E}[0Ksection_start:1700000197:cleanup_file_variables\r${E}[0KCleaning up project directory`,
    `${E}[0Ksection_end:1700000198:cleanup_file_variables\r${E}[0K`,
    `${E}[31;1mERROR: Job failed: exit code 1${E}[0;m`,
  ].join('\n');
  const groups = steps(log);

  it('reads the title from the line after the \\r, nests sections and times them from the markers', () => {
    expect(brief(groups)).toEqual([
      ['gitlab', 'Preparing the "docker" executor', 1, 5, 0, 5000, false],
      ['gitlab', 'Executing "step_script" stage', 6, 16, 0, 192_000, true],
      ['gitlab', 'Install', 8, 12, 1, 34_000, false],
      ['gitlab', 'Cleaning up project directory', 17, 20, 0, 1000, false],
    ]);
    expect(groups[1].collapsed).toBe(true);
    expect(groups[0].collapsed).toBeUndefined();
  });

  it('a section without a section_end ends at the last line; a stray section_end is ignored', () => {
    const unclosed = steps(
      [
        'section_start:1700000000:build\r',
        'section_end:1700000001:other',
        'make',
        'section_start:1700000002:inner\rInner',
        'ok',
      ].join('\n'),
    );
    expect(brief(unclosed)).toEqual([
      ['gitlab', 'build', 1, 6, 0, null, false],
      ['gitlab', 'Inner', 4, 6, 1, null, false],
    ]);
  });

  it('a name with a dot or a dash, and a section that ends right away', () => {
    expect(brief(steps('section_start:1700000000:get-sources.v2\rFetching\nsection_end:1700000003:get-sources.v2'))).toEqual([
      ['gitlab', 'Fetching', 1, 3, 0, 3000, false],
    ]);
  });
});

describe('Azure DevOps sections', () => {
  it('opens on Starting, closes on Finishing, and takes 5 s from their times', () => {
    const log = [
      '2026-10-04T10:00:00.0000000Z ##[section]Starting: Build',
      '2026-10-04T10:00:01.0000000Z ##[group]Run dotnet build',
      '2026-10-04T10:00:02.0000000Z dotnet build',
      '2026-10-04T10:00:03.0000000Z ##[endgroup]',
      '2026-10-04T10:00:05.0000000Z ##[section]Finishing: Build',
      '2026-10-04T10:00:06.0000000Z ##[section]Starting: Test',
      "2026-10-04T10:00:07.0000000Z ##[error]Bash exited with code '1'.",
      '2026-10-04T10:00:08.0000000Z ##[section]Finishing: Test',
    ].join('\n');
    expect(brief(steps(log))).toEqual([
      ['azure', 'Build', 1, 5, 0, 5000, false],
      ['gha', 'Run dotnet build', 2, 4, 1, 2000, false],
      ['azure', 'Test', 6, 8, 0, 2000, true],
    ]);
  });
});

describe('Buildkite groups', () => {
  const log = [
    '--- :hammer: Build',
    'make',
    'built',
    '+++ :test_tube: Tests',
    '2 failed',
    '🚨 Error: The command exited with status 1',
  ].join('\n');

  it('a header ends the group before it; +++ starts open, --- folded; the second group failed', () => {
    const groups = steps(log);
    expect(brief(groups)).toEqual([
      ['buildkite', ':hammer: Build', 1, 3, 0, null, false],
      ['buildkite', ':test_tube: Tests', 4, 6, 0, null, true],
    ]);
    expect(groups.map((g) => g.collapsed)).toEqual([true, false]);
  });

  it('^^^ +++ opens the group before it', () => {
    expect(steps(`--- Setup\nok\n~~~ Build\nerror: boom\n^^^ +++`).map((g) => g.collapsed)).toEqual([true, false]);
  });

  it('takes durations from Buildkite timestamps', () => {
    const timed = [
      `${E}_bk;t=1700000000000\x07--- Build`,
      `${E}_bk;t=1700000002500\x07make`,
      `${E}_bk;t=1700000003000\x07--- Test`,
      `${E}_bk;t=1700000004000\x07ok`,
    ].join('\n');
    expect(steps(timed).map((g) => [g.title, g.durationMs])).toEqual([
      ['Build', 2500],
      ['Test', 1000],
    ]);
  });
});

describe('Jenkins stages', () => {
  it('pushes on [Pipeline] { (Name), pops on // stage, ignores { without a name; no timestamps, no durations', () => {
    const log = [
      'Started by user admin',
      '[Pipeline] node',
      '[Pipeline] {',
      '[Pipeline] stage',
      '[Pipeline] { (Build)',
      '[Pipeline] sh',
      '+ make',
      '[Pipeline] }',
      '[Pipeline] // stage',
      '[Pipeline] stage',
      '[Pipeline] { (Deploy)',
      '[Pipeline] sh',
      '+ ./deploy.sh',
      'deploy: no healthy upstream',
      '[Pipeline] }',
      '[Pipeline] // stage',
      '[Pipeline] }',
      'ERROR: script returned exit code 2',
      'Finished: FAILURE',
    ].join('\n');
    expect(brief(steps(log))).toEqual([
      ['jenkins', 'Build', 5, 9, 0, null, false],
      ['jenkins', 'Deploy', 11, 16, 0, null, true],
    ]);
  });

  it('times stages from the timestamper plugin and nests them', () => {
    const log = [
      '[2026-10-04T10:00:00.000Z] [Pipeline] { (Outer)',
      '[2026-10-04T10:00:01.000Z] [Pipeline] { (Inner)',
      '[2026-10-04T10:00:04.000Z] [Pipeline] // stage',
      '[2026-10-04T10:00:09.000Z] [Pipeline] // stage',
    ].join('\n');
    expect(brief(steps(log))).toEqual([
      ['jenkins', 'Outer', 1, 4, 0, 9000, false],
      ['jenkins', 'Inner', 2, 3, 1, 3000, false],
    ]);
  });
});

describe('Docker BuildKit steps', () => {
  it('groups by step id, reads DONE 41.3s and marks ERROR', () => {
    const log = [
      '#1 [internal] load build definition from Dockerfile',
      '#1 transferring dockerfile: 312B done',
      '#1 DONE 0.0s',
      '#5 [build 2/4] RUN npm ci',
      '#5 0.512 added 812 packages',
      '#5 DONE 41.3s',
      '#6 [build 3/4] RUN npm test',
      '#6 2.104 1 test failed',
      '#6 ERROR: process "/bin/sh -c npm test" did not complete successfully: exit code: 1',
      '------',
      'ERROR: failed to solve: exit code: 1',
    ].join('\n');
    expect(brief(steps(log))).toEqual([
      ['buildkit', '[internal] load build definition from Dockerfile', 1, 3, 0, 0, false],
      ['buildkit', '[build 2/4] RUN npm ci', 4, 6, 0, 41_300, false],
      ['buildkit', '[build 3/4] RUN npm test', 7, 9, 0, null, true],
    ]);
  });
});

describe('no false steps', () => {
  it('lines that start with --- are Buildkite groups only with something only Buildkite writes', () => {
    // two "--- " lines in an ordinary log
    expect(
      steps(
        'Deploy FAILED for some reason\nthe --- separator here\n--- a line that starts with dashes\nTests run fine\nmore text\n--- another\n',
      ),
    ).toEqual([]);
    // go test output
    expect(
      steps('=== RUN   TestCharge\n--- FAIL: TestCharge (0.02s)\n=== RUN   TestRefund\n--- PASS: TestRefund (0.00s)\nFAIL\n'),
    ).toEqual([]);
    // a diff without a/ b/ prefixes, with or without file times
    expect(steps('--- src/x.ts\n+++ src/x.ts\n@@ -1 +1 @@\n--- src/y.ts\n+++ src/y.ts\n')).toEqual([]);
    expect(steps('--- x.ts\t2026-10-04 10:00:00\n+++ x.ts\t2026-10-04 10:00:01\n--- y.ts\t2026-10-04\n')).toEqual([]);
  });

  it('a real Buildkite log with only --- headers still has steps, by its emoji or its timestamps', () => {
    const emoji = steps('--- :docker: Build image\nok\n--- Run tests\n1 passed\n');
    expect(emoji.map((g) => [g.kind, g.title])).toEqual([
      ['buildkite', ':docker: Build image'],
      ['buildkite', 'Run tests'],
    ]);
    const timed = steps(`${E}_bk;t=1700000000000\x07--- Build\nok\n${E}_bk;t=1700000001000\x07--- Test\n`);
    expect(timed.map((g) => g.title)).toEqual(['Build', 'Test']);
    expect(steps('--- Build\nok\n--- Test\nboom\n^^^ +++\n').map((g) => g.title)).toEqual(['Build', 'Test']);
  });

  it('ordinary logs with --- or #1 [ in them have no steps', () => {
    for (const log of [
      '2026-10-04 10:00:00 INFO --- starting ---\n2026-10-04 10:00:01 INFO --- done ---',
      '--- a single dashed line\nINFO ok',
      '=== RUN   TestPay\n--- FAIL: TestPay (0.00s)\n=== RUN   TestRefund\n--- PASS: TestRefund (0.00s)',
      'diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@',
      '#1 [note] only one',
      'INFO step 1 --- done\nINFO step 2 --- done',
      'section_start:soon:build',
      '[Pipeline] {\n[Pipeline] }',
    ])
      expect(steps(log)).toEqual([]);
  });
});

describe('folding nested steps', () => {
  const log = parseLog(
    [
      'section_start:1700000000:outer\rOuter',
      'section_start:1700000001:inner\rInner',
      'x',
      'section_end:1700000002:inner',
      'y',
      'section_end:1700000003:outer',
      'after',
    ].join('\n'),
  );
  const groups = findGroups(log);

  it('a closed outer step hides the inner one; an open outer one shows the inner header', () => {
    const shown = (open: number[]) => foldGroups(log, groups, new Set(open)).map((l) => l.number);
    expect(groups.map((g) => [g.start, g.end])).toEqual([
      [1, 8],
      [3, 6],
    ]);
    expect(shown([])).toEqual([1, 9]);
    expect(shown([3])).toEqual([1, 9]);
    expect(shown([1])).toEqual([1, 2, 3, 7, 8, 9]);
    expect(shown([1, 3])).toHaveLength(log.length);
  });
});

describe('formatStepDuration', () => {
  it('writes durations like CI pages', () => {
    expect([250, 5000, 41_300, 192_000, 3_900_000].map(formatStepDuration)).toEqual(['250ms', '5s', '41.3s', '3m 12s', '1h 5m']);
  });
});
