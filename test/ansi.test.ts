import { describe, expect, it } from 'vitest';
import { parseAnsi, stripAnsi } from '../src/lib/ansi';
import { looksLikeLog, parseLog } from '../src/lib/logs';

const ESC = '\x1b';

describe('parseAnsi', () => {
  it('takes colour codes out and keeps where they were', () => {
    expect(parseAnsi(`${ESC}[31mERROR${ESC}[0m disk full`)).toEqual({
      text: 'ERROR disk full',
      spans: [{ start: 0, end: 5, cls: 'ansi-red' }],
    });
    expect(parseAnsi(`${ESC}[1;92mok${ESC}[22m done${ESC}[39m`).spans).toEqual([
      { start: 0, end: 2, cls: 'ansi-bright-green ansi-bold' },
      { start: 2, end: 7, cls: 'ansi-bright-green' },
    ]);
  });

  it('removes cursor codes, window titles and 256-colour codes without reading their numbers', () => {
    expect(stripAnsi(`${ESC}[2K${ESC}[1Gprogress 50%`)).toBe('progress 50%');
    expect(stripAnsi(`${ESC}]0;title${ESC}\\text`)).toBe('text');
    const { text, spans } = parseAnsi(`${ESC}[38;5;31mblue-ish${ESC}[0m`);
    expect(text).toBe('blue-ish');
    expect(spans).toEqual([]); // 31 here is a palette index, not "red"
  });

  it('leaves plain text alone', () => {
    expect(parseAnsi('plain')).toEqual({ text: 'plain', spans: [] });
  });
});

describe('logs with colour codes', () => {
  it('reads levels and times through the codes', () => {
    const [line] = parseLog(`${ESC}[90m2026-10-10 10:00:00${ESC}[0m ${ESC}[31mERROR${ESC}[0m boom`);
    expect(line).toMatchObject({ level: 'ERROR', text: '2026-10-10 10:00:00 ERROR boom' });
    expect(line.time).not.toBeNull();
    expect(line.ansi).toEqual([
      { start: 0, end: 19, cls: 'ansi-bright-black' },
      { start: 20, end: 25, cls: 'ansi-red' },
    ]);
  });

  it('counts coloured lines when deciding a page is a log', () => {
    const text = Array.from({ length: 5 }, (_, i) => `${ESC}[32mINFO${ESC}[0m step ${i}`).join('\n');
    expect(looksLikeLog(text)).toBe(true);
  });
});

describe('custom level words', () => {
  const customLevels = [
    { word: 'ALERT', level: 'ERROR' as const },
    { word: 'audit', level: 'INFO' as const },
    { word: 'NOTICE', level: 'WARN' as const },
  ];

  it('detects the user’s words', () => {
    const lines = parseLog(
      [
        '2026-10-10 10:00:00 ALERT disk almost full',
        '2026-10-10 10:00:01 [audit] user anna logged in',
        '2026-10-10 10:00:02 level=Alert again',
        '2026-10-10 10:00:03 NOTICE certificate expires soon',
        '{"level":"alert","msg":"json too"}',
        '2026-10-10 10:00:04 an alert in prose stays unknown',
      ].join('\n'),
      { customLevels },
    );
    expect(lines.map((l) => l.level)).toEqual(['ERROR', 'INFO', 'ERROR', 'WARN', 'ERROR', null]);
  });

  it('changes nothing without them, and ignores unusable words', () => {
    expect(parseLog('ALERT x')[0].level).toBeNull();
    expect(parseLog('NOTICE x')[0].level).toBe('INFO');
    expect(parseLog('a+b x', { customLevels: [{ word: 'a+b', level: 'ERROR' }] })[0].level).toBeNull();
  });
});
