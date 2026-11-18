import { describe, expect, it } from 'vitest';
import { parseLog } from '../src/lib/logs';
import { countKind, hideMuted, makeMute, muteKey } from '../src/lib/mute';

const log = parseLog(
  [
    '2026-10-04 10:00:00 INFO  GET /healthz 200 in 3ms',
    '2026-10-04 10:00:01 INFO  GET /healthz 200 in 4ms',
    '2026-10-04 10:00:02 ERROR GET /healthz 503 in 5012ms',
    '2026-10-04 10:00:03 ERROR charge failed for order 7',
    'java.lang.IllegalStateException: card declined',
    '\tat Payments.charge(Payments.java:42)',
    '2026-10-04 10:00:04 ERROR charge failed for order 8',
    'java.lang.IllegalStateException: card declined',
    '2026-10-04 10:00:05 INFO  GET /healthz 200 in 2ms',
  ].join('\n'),
);
const text = (lines: { text: string }[]) => lines.map((line) => line.text.slice(20));

describe('hiding a kind of line', () => {
  it('hides every line like the chosen one, but not the same text at another level', () => {
    const { lines, hidden } = hideMuted(log, new Set([muteKey(log[0])]));
    expect(hidden).toBe(3);
    expect(text(lines)[0]).toBe('ERROR GET /healthz 503 in 5012ms');
    expect(lines).toHaveLength(6);
  });

  it('hides a stack trace with its entry', () => {
    const { lines } = hideMuted(log, new Set([muteKey(log[3])]));
    expect(text(lines)).toEqual([
      'INFO  GET /healthz 200 in 3ms',
      'INFO  GET /healthz 200 in 4ms',
      'ERROR GET /healthz 503 in 5012ms',
      'INFO  GET /healthz 200 in 2ms',
    ]);
  });

  it('counts the entries of a kind', () => {
    expect(countKind(log, muteKey(log[0]))).toBe(3);
    expect(countKind(log, muteKey(log[3]))).toBe(2);
  });

  it('names a kind by its text without numbers', () => {
    expect(makeMute(log[0])).toEqual({
      line: 1,
      key: 'INFO INFO  GET /healthz # in #ms',
      level: 'INFO',
      label: 'INFO  GET /healthz # in #ms',
    });
  });

  it('treats the lines of every pod alike', () => {
    const pods = parseLog('[pod/api-1/app] INFO ready on :8080\n[pod/api-2/app] INFO ready on :8081\n[pod/api-2/app] INFO bye\n');
    expect(hideMuted(pods, new Set([muteKey(pods[0])])).lines.map((line) => line.number)).toEqual([3]);
  });

  it("leaves a JSON record's other fields out of its kind", () => {
    const json = parseLog(
      '{"level":"info","msg":"login","user":"ann","id":"a1"}\n{"level":"info","msg":"login","user":"bob","id":"b2"}\n{"level":"info","msg":"logout","user":"ann"}\n',
    );
    expect(hideMuted(json, new Set([muteKey(json[0])])).lines.map((line) => line.number)).toEqual([3]);
  });

  it('keeps a long label short', () => {
    const [line] = parseLog(`INFO ${'word '.repeat(40)}`);
    expect(makeMute(line).label.length).toBeLessThanOrEqual(48);
  });
});

describe('a log without timestamps', () => {
  it('takes each line as an entry of its own', () => {
    const plain = parseLog('ERROR boom\nERROR boom again\nERROR boom\n');
    expect(hideMuted(plain, new Set([muteKey(plain[0])])).lines.map((line) => line.number)).toEqual([2]);
  });
});
