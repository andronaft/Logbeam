import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findGroups, groupErrors } from '../src/lib/insights';
import { LogLine, parseLog } from '../src/lib/logs';
import { findFailedTests } from '../src/lib/tests';

/**
 * Real-looking logs of many formats (test/corpus/*.log) and what Logbeam reads in them (the .expected.json next
 * to each): the level of every line, which lines continue an entry, the error groups, the CI steps and the
 * failed tests. A change to a parser shows up as a diff here, for every format at once.
 *
 * After a deliberate change, look at the diff and write the new results with
 * `UPDATE_CORPUS=1 npx vitest run test/corpus.test.ts`. A new format is a new .log file.
 */

const DIR = path.join(__dirname, 'corpus');

/** One short line per log line: "12 ERROR +" is a continuation of an error, "~" takes the level above. */
function describeLine(line: LogLine): string {
  const parts = [String(line.number), line.level ?? '-'];
  if (line.continuation) parts.push('+');
  if (line.inherited) parts.push('~');
  if (line.time !== null) parts.push('@');
  if (line.gap !== null) parts.push(`gap ${line.gap}ms`);
  if (line.source !== null) parts.push(`[${line.source}]`);
  if (line.secret) parts.push('secret');
  return parts.join(' ');
}

function read(text: string) {
  const lines = parseLog(text);
  const { failed, totals } = findFailedTests(lines);
  return {
    lines: lines.map(describeLine),
    errorGroups: groupErrors(lines).map(({ sample, count, lines: at }) => ({ sample, count, lines: at })),
    steps: findGroups(lines).map(({ title, start, end, errors, depth, durationMs, failed: stepFailed }) => ({
      title,
      start,
      end,
      errors,
      depth,
      durationMs,
      failed: stepFailed,
    })),
    failedTests: failed.map(({ runner, name, line, reason }) => ({ runner, name, line, reason })),
    totals,
  };
}

const files = fs
  .readdirSync(DIR)
  .filter((file) => file.endsWith('.log'))
  .sort();

describe('the corpus of log formats', () => {
  it('has logs to read', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const file of files) {
    it(file, () => {
      const actual = read(fs.readFileSync(path.join(DIR, file), 'utf8'));
      const expectedPath = path.join(DIR, file.replace(/\.log$/, '.expected.json'));
      if (process.env.UPDATE_CORPUS || !fs.existsSync(expectedPath)) {
        fs.writeFileSync(expectedPath, `${JSON.stringify(actual, null, 2)}\n`);
        if (!process.env.UPDATE_CORPUS) throw new Error(`${expectedPath} was missing and is written now: check it`);
      }
      expect(actual).toEqual(JSON.parse(fs.readFileSync(expectedPath, 'utf8')));
    });
  }
});
