import { LogLine, splitSource } from './logs';

export type TestRunner = 'pytest' | 'jest' | 'vitest' | 'go' | 'maven' | 'gradle' | 'rspec';

/** A test that failed, as a CI log reports it. */
export interface FailedTest {
  runner: TestRunner;
  /** As the runner names it: `TestPay::test_refund`, `PaymentService › refunds twice`, `TestCharge/zero`. */
  name: string;
  /** The test's file, or file and line, when the log says it: `tests/test_pay.py`, `charge_test.go:12`. */
  where: string | null;
  /** Line number where the log first reports the failure. */
  line: number;
  /** A short reason, e.g. the assertion message; empty when the runner prints none. */
  reason: string;
}

/** What the runners' own summaries add up to: `Tests run: 12, Failures: 1`, `2 failed, 10 passed`. */
export interface TestTotals {
  failed: number;
  total: number;
}

export interface TestReport {
  /** In the order they failed: the first one is often the cause of the ones after it. */
  failed: FailedTest[];
  totals: TestTotals | null;
}

const MAX_REASON = 160;

// a leading timestamp that CI adds to every line: GitHub Actions' raw logs
// ("2026-10-04T10:00:00.1234567Z "), Jenkins' timestamper ("[2026-10-04T10:00:00.123Z] "), or a time
// of day ("10:00:00.123 [ERROR] …" from Maven with showDateTime)
const CI_TIME = /^(?:\[?\d{4}-\d{2}-\d{2}T[\d:.]+Z\]?\s|\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\s)/;

// pytest: "FAILED tests/test_pay.py::test_refund - AssertionError: …" (short summary, also "ERROR" for a
// failed setup) and "tests/test_pay.py::test_refund FAILED [ 50%]" (-v)
const PYTEST_SUMMARY = /^(?:FAILED|ERROR) (\S+?\.py::\S+(?:\[[^\]]*\])?)(?: - (.*))?$/;
const PYTEST_VERBOSE = /^(\S+?\.py::\S+(?:\[[^\]]*\])?) (?:FAILED|ERROR)\b/;
// "=== FAILURES ===" opens the section of "___ test_refund ___" headers; the next "=== … ===" closes it
const PYTEST_SECTION = /^={3,} ?(.*?) ?={3,}$/;
const PYTEST_HEADER = /^_{3,} (.+?) _{3,}$/;
const PYTEST_TOTALS = /^={3,} (.*\d+ (?:failed|passed|errors?)\b.*) in [\d.]+s\b.*={3,}$/;

// Jest: "FAIL src/pay.test.ts (1.2 s)", then "● PaymentService › refunds twice" for each test
const JEST_FILE = /^FAIL\s+(\S+\.[cm]?[jt]sx?)(?:\s+\(.*\))?$/;
const JEST_TEST = /^● (.+)$/;
// not tests: console output and Jest's own warnings
const JEST_NOT_TEST = /^(?:Console|.*\bWarning|Validation Error)$/;
const JEST_SUITE = 'Test suite failed to run';
const JEST_TOTALS = /^Tests:\s+(.*\d+ total)$/;
// Vitest: "FAIL  src/pay.test.ts > PaymentService > refunds twice"
const VITEST_TEST = /^FAIL\s+(\S+\.[cm]?[jt]sx?) > (.+?)(?:\s+\[[^\]]*\])?$/;

// Go: "--- FAIL: TestCharge (0.02s)", subtests indented: "    --- FAIL: TestCharge/zero (0.00s)"
const GO_FAIL = /^\s*--- FAIL: (\S+) \([\d.]+m?s\)$/;
const GO_RUN = /^\s*=== (?:RUN|CONT|PAUSE|NAME)\s/;
const GO_MESSAGE = /^\s+(\w[\w.-]*_test\.go:\d+): (.+)$/;

// Maven surefire / failsafe, while running: "[ERROR] com.acme.PayTest.refund -- Time elapsed: 0.01 s <<< FAILURE!"
// (surefire 3) or "[ERROR] refund(com.acme.PayTest)  Time elapsed: 0.01 s  <<< FAILURE!" (older)
const MAVEN_RUNNING = /^\[ERROR\] (\S+?)(?:\(([\w$.]+)\))?(?: --)?\s+Time elapsed: .*<<< (?:FAILURE|ERROR)!$/;
// and in the results: "[ERROR] Failures:" then "[ERROR]   PayTest.refund:42 expected:<1> but was:<2>"
const MAVEN_RESULTS = /^\[ERROR\] (?:Failures|Errors):\s*$/;
const MAVEN_RESULT =
  /^\[ERROR\]\s{2,}(?!Run \d)([\w$]+(?:\.[\w$]+)+)(?:\([^)]*\))?(?:\[[^\]]*\])?(?::\d+)?(?:->\S+)*\s*(?:»\s*)?(.*)$/;
const JUNIT_TOTALS = /\bTests run: (\d+), Failures: (\d+), Errors: (\d+)(?!.*Time elapsed)/;

// Gradle: "com.acme.PayTest > refund() FAILED", nested classes as more "> …" parts
const GRADLE_FAIL = /^((?:[a-z_][\w$]*\.)*[A-Z][\w$]*(?: > [^>]+?)*) > (.+) FAILED$/;
const GRADLE_TOTALS = /^(\d+) tests? completed, (\d+) failed\b/;

// RSpec: "  1) Pay refunds twice" under "Failures:", and "rspec ./spec/pay_spec.rb:12 # Pay refunds twice"
const RSPEC_RERUN = /^rspec (\.\/\S+:\d+|\.\/\S+\[[\d:]+\]) # (.+)$/;
const RSPEC_NUMBERED = /^\s+\d+\) (.+)$/;
const RSPEC_TOTALS = /^(\d+) examples?, (\d+) failures?\b/;

// a line has one of these when it is anything the runners below look for, outside their sections
const RUNNER_WORDS = /FAIL|ERROR|●|___|===|Tests|tests? completed|examples?, |Failures:|rspec /;

/** The lines of the log without a pod prefix or a CI timestamp, cleaned when first read. */
interface Texts {
  length: number;
  at(i: number): string;
}

function cleanText(text: string): string {
  const rest = splitSource(text).rest;
  const time = CI_TIME.exec(rest);
  return time ? rest.slice(time[0].length) : rest;
}

/** `org.opentest4j.AssertionFailedError: expected…` → `AssertionFailedError: expected…`. */
function shortReason(text: string): string {
  const reason = text
    .trim()
    .replace(/^(?:[a-z_][\w$]*\.)+(?=[A-Z][\w$]*(?::|$|\s))/, '')
    .replace(/\s+/g, ' ');
  return reason.length > MAX_REASON ? `${reason.slice(0, MAX_REASON - 1)}…` : reason;
}

/** `com.acme.PayTest` → `PayTest`. */
const simpleClass = (name: string) => name.slice(name.lastIndexOf('.') + 1);

interface Entry extends FailedTest {
  key: string;
  /** pytest: the name after the file, with "." for "::", as a "___ header ___" shows it. */
  short?: string;
  /** pytest: whether a "___ header ___" was already taken as this test. */
  header?: boolean;
  /** pytest: a header only counts with a traceback under it ("E   …", "tests/test_pay.py:21: …"). */
  traceback?: boolean;
}

/**
 * The tests a CI log says failed, from pytest, Jest, Vitest, Go, Maven surefire / failsafe, Gradle and
 * RSpec, in the order they failed. A test reported twice (a pytest header and its summary line, a Jest
 * test again under "Summary of all failing tests") is listed once, at the first line.
 */
export function findFailedTests(lines: LogLine[]): TestReport {
  // most lines of a log are none of this: their text is cleaned only when looked at
  const cleaned: string[] = [];
  const texts: Texts = {
    length: lines.length,
    at: (i) => (cleaned[i] ??= cleanText(lines[i].text)),
  };
  const entries: Entry[] = [];
  const byKey = new Map<string, Entry>();
  let failed = 0;
  let total = 0;
  let hasTotals = false;
  const addTotals = (f: number, t: number) => {
    failed += f;
    total += t;
    hasTotals = true;
  };
  const add = (entry: Entry): Entry => {
    const known = byKey.get(entry.key);
    if (known) {
      if (!known.reason) known.reason = entry.reason;
      return known;
    }
    byKey.set(entry.key, entry);
    entries.push(entry);
    return entry;
  };

  /** The first non-empty line after `i`, for Jest's and Gradle's message under a test. */
  const nextText = (i: number, limit = 4): string => {
    for (let j = i + 1; j < texts.length && j <= i + limit; j++) {
      if (texts.at(j).trim()) return texts.at(j);
    }
    return '';
  };

  // pytest
  let inPytestFailures = false;
  let pytestHeader: Entry | null = null;
  const pytestId = (i: number, id: string, reason: string) => {
    const at = id.indexOf('.py::') + 3;
    const short = id.slice(at + 2).replace(/::/g, '.');
    const key = `pytest:${id}`;
    const known = byKey.get(key);
    if (known) {
      if (!known.reason) known.reason = reason;
      return;
    }
    // the "___ header ___" of this test, seen before its id
    const header = entries.find((e) => e.runner === 'pytest' && e.short === short && e.key.startsWith('pytest-header:'));
    if (header) {
      byKey.delete(header.key);
      header.key = key;
      header.name = id.slice(at + 2);
      header.where = id.slice(0, at);
      byKey.set(key, header);
      if (!header.reason) header.reason = reason;
      return;
    }
    add({ runner: 'pytest', key, name: id.slice(at + 2), where: id.slice(0, at), line: lines[i].number, reason, short });
  };

  // Jest
  let jestFile: string | null = null;
  const jestFiles = new Map<string, { line: number; tests: number }>();

  // Maven
  let inMavenResults = false;

  // RSpec
  let inRspecFailures = false;

  for (let i = 0; i < texts.length; i++) {
    // outside a runner's section, a line without any of the runners' words is skipped at once
    const inSection = inPytestFailures || inMavenResults || inRspecFailures || jestFile !== null;
    if (!inSection && !RUNNER_WORDS.test(lines[i].text)) continue;
    const raw = texts.at(i);
    const text = raw.trim();
    if (!text) continue;

    // ---- pytest
    const section = text[0] === '=' ? PYTEST_SECTION.exec(text) : null;
    if (section) {
      inPytestFailures = /^(?:FAILURES|ERRORS)$/.test(section[1]);
      pytestHeader = null;
      const totals = PYTEST_TOTALS.exec(text);
      if (totals) {
        let f = 0;
        let t = 0;
        for (const [, n, word] of totals[1].matchAll(/(\d+) (\w+)/g)) {
          t += Number(n);
          if (/^(?:failed|errors?)$/.test(word)) f += Number(n);
        }
        addTotals(f, t);
      }
      continue;
    }
    if (inPytestFailures) {
      const header = PYTEST_HEADER.exec(text);
      if (header) {
        const name = header[1].replace(/^ERROR at (?:setup|teardown) of /, '');
        const known = entries.find((e) => e.runner === 'pytest' && e.short === name && !e.header);
        if (known) {
          known.header = true;
          pytestHeader = known;
        } else {
          pytestHeader = add({
            runner: 'pytest',
            key: `pytest-header:${lines[i].number}`,
            name,
            where: null,
            line: lines[i].number,
            reason: '',
            short: name,
            header: true,
          });
        }
        continue;
      }
      // "E       AssertionError: assert 1 == 2": the first one under the header is the reason
      const e = /^E\s+(.+)$/.exec(text);
      if (e && pytestHeader && !pytestHeader.reason) pytestHeader.reason = shortReason(e[1]);
      if (pytestHeader && (e || /^\S+\.py:\d+: /.test(text))) pytestHeader.traceback = true;
    }
    // a few string checks first: most lines are none of this, and a regex costs more
    const py = text.includes('.py::');
    const summary = py ? PYTEST_SUMMARY.exec(text) : null;
    if (summary) {
      pytestId(i, summary[1], shortReason(summary[2] ?? ''));
      continue;
    }
    const verbose = py ? PYTEST_VERBOSE.exec(text) : null;
    if (verbose) {
      pytestId(i, verbose[1], '');
      continue;
    }

    // ---- Jest and Vitest
    const fail = text.startsWith('FAIL');
    const vitest = fail ? VITEST_TEST.exec(text) : null;
    if (vitest) {
      const name = vitest[2].replace(/ > /g, ' › ');
      add({ runner: 'vitest', key: `jest:${vitest[1]}:${name}`, name, where: vitest[1], line: lines[i].number, reason: '' });
      continue;
    }
    const file = fail ? JEST_FILE.exec(text) : null;
    if (file) {
      jestFile = file[1];
      if (!jestFiles.has(jestFile)) jestFiles.set(jestFile, { line: lines[i].number, tests: 0 });
      continue;
    }
    if (jestFile && /^(?:PASS|Test Suites:|Ran all test suites)\b/.test(text)) jestFile = null;
    const jest = jestFile ? JEST_TEST.exec(text) : null;
    if (jest && jestFile && !JEST_NOT_TEST.test(jest[1])) {
      const suite = jest[1] === JEST_SUITE;
      const name = suite ? jestFile : jest[1];
      jestFiles.get(jestFile)!.tests++;
      add({
        runner: 'jest',
        key: `jest:${jestFile}:${name}`,
        name,
        where: suite ? null : jestFile,
        line: lines[i].number,
        reason: shortReason(nextText(i)),
      });
      continue;
    }
    const jestTotals = text.startsWith('Tests:') ? JEST_TOTALS.exec(text) : null;
    if (jestTotals) {
      const f = /(\d+) failed/.exec(jestTotals[1]);
      addTotals(f ? Number(f[1]) : 0, Number(/(\d+) total/.exec(jestTotals[1])![1]));
      continue;
    }

    // ---- Go
    const go = text.startsWith('--- FAIL: ') ? GO_FAIL.exec(raw) : null;
    if (go) {
      const message = goMessage(texts, i, go[1]);
      add({
        runner: 'go',
        key: `go:${go[1]}`,
        name: go[1],
        where: message?.[0] ?? null,
        line: lines[i].number,
        reason: message ? shortReason(message[1]) : '',
      });
      continue;
    }

    // ---- Maven surefire / failsafe
    const maven = text.startsWith('[ERROR]');
    const running = maven ? MAVEN_RUNNING.exec(text) : null;
    if (running) {
      // "com.acme.PayTest.refund" or "refund(com.acme.PayTest)"
      const name = running[2] ? `${simpleClass(running[2])}.${running[1]}` : mavenName(running[1]);
      add({
        runner: 'maven',
        key: `maven:${name}`,
        name,
        where: null,
        line: lines[i].number,
        reason: shortReason(nextText(i, 2)),
      });
      continue;
    }
    if (maven && MAVEN_RESULTS.test(text)) {
      inMavenResults = true;
      continue;
    }
    if (inMavenResults) {
      const result = maven ? MAVEN_RESULT.exec(raw) : null;
      if (result) {
        const name = mavenName(result[1]);
        add({ runner: 'maven', key: `maven:${name}`, name, where: null, line: lines[i].number, reason: shortReason(result[2]) });
        continue;
      }
      inMavenResults = /^\[ERROR\]\s+Run \d/.test(text);
    }
    const junit = text.includes('Tests run: ') ? JUNIT_TOTALS.exec(text) : null;
    if (junit) {
      addTotals(Number(junit[2]) + Number(junit[3]), Number(junit[1]));
      continue;
    }

    // ---- Gradle
    const gradle = text.endsWith(' FAILED') && text.includes(' > ') ? GRADLE_FAIL.exec(text) : null;
    if (gradle) {
      const [cls, ...nested] = gradle[1].split(' > ');
      const name = [simpleClass(cls), ...nested, gradle[2]].join(' > ');
      // Gradle prints the exception indented under the test; without it this is some other "X > y FAILED"
      const next = i + 1 < texts.length ? texts.at(i + 1) : '';
      if (/^\s+\S/.test(next))
        add({
          runner: 'gradle',
          key: `gradle:${name}`,
          name,
          where: null,
          line: lines[i].number,
          reason: shortReason(next),
        });
      continue;
    }
    const gradleTotals = text.includes(' completed, ') ? GRADLE_TOTALS.exec(text) : null;
    if (gradleTotals) {
      addTotals(Number(gradleTotals[2]), Number(gradleTotals[1]));
      continue;
    }

    // ---- RSpec
    if (text === 'Failures:') {
      inRspecFailures = true;
      continue;
    }
    if (inRspecFailures) {
      if (/^(?:Finished in |Failed examples:)/.test(text)) inRspecFailures = false;
      else {
        const numbered = RSPEC_NUMBERED.exec(raw);
        // RSpec prints "Failure/Error:" under each one, a numbered list of something else doesn't
        const reason = numbered ? rspecReason(texts, i) : null;
        if (numbered && reason !== null) {
          const name = numbered[1].trim();
          add({ runner: 'rspec', key: `rspec:${name}`, name, where: null, line: lines[i].number, reason });
          continue;
        }
      }
    }
    const rerun = text.startsWith('rspec ') ? RSPEC_RERUN.exec(text) : null;
    if (rerun) {
      const entry = add({
        runner: 'rspec',
        key: `rspec:${rerun[2]}`,
        name: rerun[2],
        where: null,
        line: lines[i].number,
        reason: '',
      });
      entry.where ??= rerun[1].replace(/^\.\//, '');
      continue;
    }
    const rspecTotals = text.includes(' example') ? RSPEC_TOTALS.exec(text) : null;
    if (rspecTotals) addTotals(Number(rspecTotals[2]), Number(rspecTotals[1]));
  }

  // a Jest file that failed with no test named under it (the output was cut short): the file itself
  for (const [file, { line, tests }] of jestFiles) {
    if (tests === 0) add({ runner: 'jest', key: `jest:${file}:`, name: file, where: null, line, reason: '' });
  }
  // a Go test fails when one of its subtests does: the subtest says more
  const goNames = entries.filter((e) => e.runner === 'go').map((e) => e.name);
  const failedTests = entries
    .filter((e) => !(e.runner === 'go' && goNames.some((n) => n.startsWith(`${e.name}/`))))
    .filter((e) => !e.key.startsWith('pytest-header:') || e.traceback)
    .sort((a, b) => a.line - b.line)
    .map(({ runner, name, where, line, reason }) => ({ runner, name, where, line, reason }));
  return { failed: failedTests, totals: hasTotals && failedTests.length > 0 ? { failed, total } : null };
}

/** `com.acme.PayTest.refund` → `PayTest.refund`. */
function mavenName(qualified: string): string {
  const parts = qualified.split('.');
  return parts.length < 2 ? qualified : parts.slice(-2).join('.');
}

/**
 * What a Go test logged: "charge_test.go:12: expected error, got nil", indented under its
 * "--- FAIL" line, or with -v before it, after its "=== RUN".
 */
function goMessage(texts: Texts, at: number, name: string): [string, string] | null {
  for (let j = at + 1; j < texts.length && j <= at + 20; j++) {
    if (GO_FAIL.test(texts.at(j)) || GO_RUN.test(texts.at(j)) || !/^\s/.test(texts.at(j))) break;
    const message = GO_MESSAGE.exec(texts.at(j));
    if (message) return [message[1], message[2]];
  }
  const run = new RegExp(`^\\s*=== RUN\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  for (let j = at - 1; j >= 0 && j >= at - 200; j--) {
    if (!run.test(texts.at(j))) continue;
    for (let k = j + 1; k < at; k++) {
      if (GO_RUN.test(texts.at(k))) break;
      const message = GO_MESSAGE.exec(texts.at(k));
      if (message) return [message[1], message[2]];
    }
    break;
  }
  return null;
}

/** RSpec's "expected: 2 / got: 1" under "Failure/Error: …", or the exception it raised. */
function rspecReason(texts: Texts, at: number): string | null {
  for (let j = at + 1; j < texts.length && j <= at + 6; j++) {
    if (!texts.at(j).trim().startsWith('Failure/Error:')) continue;
    const parts: string[] = [];
    for (let k = j + 1; k < texts.length && k <= j + 6; k++) {
      const part = texts.at(k).trim();
      if (!part && parts.length === 0) continue;
      if (!part || part.startsWith('# ')) break;
      parts.push(part);
    }
    return shortReason(parts.join(' '));
  }
  return null;
}
