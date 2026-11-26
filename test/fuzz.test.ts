import { describe, expect, it } from 'vitest';
import { LEVELS, LogLine, collapseRepeats, filterLines, parseLog, splitLines } from '../src/lib/logs';
import { findGroups, groupErrors, lineIds } from '../src/lib/insights';
import { findFailedTests } from '../src/lib/tests';
import { findSecrets, maskSecrets } from '../src/lib/secrets';
import { parseQuery } from '../src/lib/fields';
import { buildTimeline } from '../src/lib/timeline';

/**
 * Logs are whatever a program printed, so the parsers get random lines built from the pieces real logs are
 * made of, and must not throw or produce nonsense. The seed is fixed, so a failure is the same every run; the
 * failing input is in the message.
 */

/** A small seeded random generator (mulberry32). */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = [
  '2026-11-26T03:12:01.123Z ',
  '2026-11-26 03:12:01,123 ',
  '10:00:00.250 ',
  'Nov 26 03:12:05 ',
  '[pod/api-6f9c/app] ',
  'api-1  | ',
  '<11>1 ',
  'ERROR ',
  'WARN ',
  'INFO ',
  'DEBUG ',
  'level=error ',
  '[E] ',
  'E/Tag( 12): ',
  '\tat com.example.A.run(A.java:12)',
  '    at fn (file.js:1:2)',
  'Caused by: java.lang.IllegalStateException: boom',
  'Traceback (most recent call last):',
  '  File "/app/a.py", line 3, in <module>',
  'KeyError: "x"',
  'goroutine 1 [running]:',
  '##[group]Run npm test',
  '##[endgroup]',
  '##[error]Process completed with exit code 1.',
  '\u001b[0Ksection_start:1700000000:build\r\u001b[0K',
  '\u001b[0Ksection_end:1700000004:build\r\u001b[0K',
  '[Pipeline] { (Build)',
  '#12 DONE 41.3s',
  '--- ',
  '+++ ',
  '--- FAIL: TestX (0.01s)',
  'FAILED tests/test_a.py::test_x - AssertionError',
  '=== 1 failed, 2 passed in 0.1s ===',
  'Tests:       1 failed, 3 total',
  'Tests run: 3, Failures: 1, Errors: 0, Skipped: 0',
  '{"level":"error","msg":"boom","ts":"2026-11-26T03:12:01Z"}',
  '{"time":1764126721000,"severity":"WARN","message":"x"}',
  '{',
  '}',
  '  "nested": [1, 2, {"a": null}],',
  '-----BEGIN RSA PRIVATE KEY-----',
  'MIIEpAIBAAKCAQEA',
  '-----END RSA PRIVATE KEY-----',
  'password=hunter22 ',
  'token="a b \\" c" ',
  'Authorization: Bearer abcdefghijklmnopqrstuvwxyz ',
  'https://user:secret@db.example.com/x ',
  'traceId=4bf92f3577b34da6a3ce929d0e0e4736 ',
  'request_id=6f1c2d3e-1111-2222-3333-444455556666 ',
  '"GET /orders/1 HTTP/1.1" 502 157 ',
  'status=500 duration=1.2s ',
  '\u001b[31m',
  '\u001b[0m',
  '\u001b[1;33m',
  '\r',
  '\t',
  ' ',
  '',
  '"',
  "'",
  '\\',
  '[',
  ']',
  '=',
  ':',
  '://',
  'é ü 日本 🔥',
  '‮',
  '\u0000',
];

function randomLog(next: () => number): string {
  const lines: string[] = [];
  const count = 1 + Math.floor(next() * 40);
  for (let i = 0; i < count; i++) {
    let line = '';
    const parts = Math.floor(next() * 5);
    for (let j = 0; j < parts; j++) line += PIECES[Math.floor(next() * PIECES.length)];
    if (next() < 0.1) line += 'x'.repeat(Math.floor(next() * 300));
    lines.push(line);
  }
  return lines.join(next() < 0.1 ? '\r\n' : '\n');
}

function checkLines(text: string, lines: LogLine[]): void {
  expect(lines).toHaveLength(splitLines(text).length);
  lines.forEach((line, i) => {
    expect(line.number).toBe(i + 1);
    expect(typeof line.text).toBe('string');
    expect(line.level === null || LEVELS.includes(line.level)).toBe(true);
    if (line.time !== null) expect(Number.isFinite(line.time)).toBe(true);
    if (line.gap !== null) expect(Number.isFinite(line.gap)).toBe(true);
  });
}

function count(text: string, part: string): number {
  return text.split(part).length - 1;
}

const RUNS = 1000;

describe('parsers on random logs', () => {
  it(`${RUNS} random logs parse without throwing and keep every line`, () => {
    const next = random(20261126);
    for (let run = 0; run < RUNS; run++) {
      const text = randomLog(next);
      try {
        const lines = parseLog(text);
        checkLines(text, lines);
        groupErrors(lines);
        findGroups(lines);
        findFailedTests(lines);
        buildTimeline(lines);
        collapseRepeats(lines);
        filterLines(lines, {
          levels: new Set(LEVELS),
          includeUnknown: true,
          query: 'error',
          regex: false,
          caseSensitive: false,
          context: 1,
        });
        for (const line of lines) {
          lineIds(line);
          findSecrets(line.text);
          maskSecrets(line.text);
        }
        parseQuery(text.slice(0, 200));
      } catch (error) {
        throw new Error(`run ${run} failed on ${JSON.stringify(text)}: ${String(error)}`, { cause: error });
      }
    }
  }, 120_000);

  it('a masked line keeps none of the secrets that were found in it', () => {
    const next = random(7);
    for (let run = 0; run < RUNS; run++) {
      const text = randomLog(next);
      for (const line of splitLines(text)) {
        const masked = maskSecrets(line);
        for (const { kind, start, end } of findSecrets(line)) {
          // the BEGIN line of a private key stays readable; its body lines are masked as a block
          if (kind === 'Private key') continue;
          const secret = line.slice(start, end);
          // the same word may stand elsewhere in the line, where it is not a secret: count, don't search
          if (secret.length >= 6) {
            expect(count(masked, secret), JSON.stringify(line)).toBeLessThan(count(line, secret));
          }
        }
      }
    }
  }, 120_000);
});
