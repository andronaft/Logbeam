import { describe, expect, it } from 'vitest';
import { findFailedTests } from '../src/lib/tests';
import { findGroups, groupErrors, lineIds } from '../src/lib/insights';
import { parseLog, signature } from '../src/lib/logs';
import { findSecrets, maskSecrets } from '../src/lib/secrets';
import { parseQuery, plainFields } from '../src/lib/fields';
import { parseAnsi } from '../src/lib/ansi';

/**
 * Every line goes through dozens of regular expressions, and a log line can be one minified JSON document of
 * hundreds of kilobytes. A pattern that backtracks on some input turns a 200 KB line into a frozen tab.
 *
 * Each case builds a hostile line of n and 4n characters (and 16n when that looks slow) and times the work on it. Linear work grows about 4×,
 * quadratic work 16×. The check compares the two times instead of using a fixed limit, so a slow CI machine
 * doesn't make it fail.
 */

const PIECES = [
  'a:',
  'a,',
  'a;',
  'a&',
  'a=',
  'a@',
  ':a',
  '://',
  'a ',
  '"a',
  '\\"',
  "'a",
  'a.',
  'a-',
  '%a',
  '=a',
  '{"a":',
  '[a',
  '\u001b[31m',
  '\t',
];

const PREFIXES = [
  '',
  'http://',
  'redis://',
  'password=',
  'password="',
  "token='",
  '"apiKey": "',
  'Authorization: Basic ',
  'Bearer ',
  'Cookie: a=',
  'eyJ',
  '2026-11-26T03:12:01.123Z ERROR ',
  '[pod/api-6f9c/app] ',
  '##[group]',
  'FAILED tests/test_a.py::',
  '--- FAIL: ',
  '{"level":"error","msg":"',
];

type Work = (line: string) => unknown;

const WORK: Record<string, Work> = {
  findSecrets: (line) => findSecrets(line),
  maskSecrets: (line) => maskSecrets(line),
  parseLog: (line) => parseLog(line),
  // The insights that run over every line of a parsed log.
  insights: (line) => {
    const lines = parseLog(`${line}\n${line}`);
    groupErrors(lines);
    findGroups(lines);
    lineIds(lines[0]);
    signature(line);
  },
  findFailedTests: (line) => findFailedTests(parseLog(line)),
  fields: (line) => {
    plainFields(line);
    parseQuery(line);
  },
  parseAnsi: (line) => parseAnsi(line),
};

function time(work: Work, line: string): number {
  // A first run warms the JIT up; the best of three keeps garbage collection out of the measurement.
  work(line);
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    work(line);
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

function hostile(prefix: string, piece: string, length: number): string {
  return prefix + piece.repeat(Math.ceil(length / piece.length));
}

const SMALL = 2_000;
const LARGE = SMALL * 4;

describe('regular expressions stay linear on hostile lines', () => {
  for (const [name, work] of Object.entries(WORK)) {
    it(
      name,
      () => {
        const slow: string[] = [];
        for (const prefix of PREFIXES) {
          for (const piece of PIECES) {
            const small = time(work, hostile(prefix, piece, SMALL));
            const large = time(work, hostile(prefix, piece, LARGE));
            // Below 10 ms the times are noise. Quadratic growth would be 16×; a pause for garbage collection can
            // make one step look like that too, so a suspect is measured once more at 4× the length.
            if (large > 10 && large > small * 10) {
              const larger = time(work, hostile(prefix, piece, LARGE * 4));
              if (larger > large * 10) {
                slow.push(
                  `${JSON.stringify(prefix + piece)}… ${small.toFixed(1)} → ${large.toFixed(1)} → ${larger.toFixed(1)} ms`,
                );
              }
            }
          }
        }
        expect(slow).toEqual([]);
      },
      60_000,
    );
  }
});
