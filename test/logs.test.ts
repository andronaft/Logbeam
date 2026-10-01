import { describe, expect, it } from 'vitest';
import {
  LEVELS,
  LogParser,
  splitLines,
  collapseRepeats,
  countByLevel,
  detectLevel,
  filterLines,
  formatGap,
  looksLikeLog,
  parseLog,
  parseTimestamp,
  signature,
} from '../src/lib/logs';

const SPRING_LOG = `2024-03-01 10:00:00.123  INFO 4242 --- [main] c.z.TeamDanceCommunityApplication : Starting application
2024-03-01 10:00:01.500  WARN 4242 --- [main] o.h.e.j.e.i.JdbcEnvironmentInitiator : HHH000342: Could not obtain connection
2024-03-01 10:00:07.000 ERROR 4242 --- [main] o.s.boot.SpringApplication : Application run failed
java.lang.IllegalStateException: Failed to execute CommandLineRunner
\tat org.springframework.boot.SpringApplication.callRunner(SpringApplication.java:771)
\tat org.springframework.boot.SpringApplication.run(SpringApplication.java:315)
Caused by: java.net.ConnectException: Connection refused
\t... 12 common frames omitted
2024-03-01 10:00:07.010 DEBUG 4242 --- [main] o.s.b.a.l.ConditionEvaluationReportLogger : report
`;

describe('detectLevel', () => {
  it('finds common level spellings', () => {
    expect(detectLevel('2024-01-01 12:00:00 ERROR something broke')).toBe('ERROR');
    expect(detectLevel('[warn] disk almost full')).toBe('WARN');
    expect(detectLevel('level=info msg="started"')).toBe('INFO');
    expect(detectLevel('SEVERE: Servlet.service() threw exception')).toBe('ERROR');
    expect(detectLevel('W0301 WARNING: deprecated flag')).toBe('WARN');
    expect(detectLevel('FINE: cache hit')).toBe('DEBUG');
  });

  it('does not match level words inside other words', () => {
    expect(detectLevel('user information updated')).toBeNull();
    expect(detectLevel('ErrorPageFilter registered')).toBeNull();
  });
});

describe('parseTimestamp', () => {
  it('parses ISO and log4j/logback formats', () => {
    expect(parseTimestamp('2024-03-01T10:00:00Z hello')).toBe(Date.UTC(2024, 2, 1, 10, 0, 0));
    expect(parseTimestamp('2024-03-01 10:00:00,250 INFO')).toBe(Date.UTC(2024, 2, 1, 10, 0, 0, 250));
    expect(parseTimestamp('2024/03/01 10:00:00.5 x')).toBe(Date.UTC(2024, 2, 1, 10, 0, 0, 500));
    expect(parseTimestamp('2024-03-01T12:00:00+02:00')).toBe(Date.UTC(2024, 2, 1, 10, 0, 0));
    expect(parseTimestamp('2024-03-01T12:00:00+0200')).toBe(Date.UTC(2024, 2, 1, 10, 0, 0));
  });

  it('returns null without a timestamp', () => {
    expect(parseTimestamp('no time here')).toBeNull();
  });
});

describe('parseLog', () => {
  const lines = parseLog(SPRING_LOG);

  it('keeps every line with its number', () => {
    expect(lines).toHaveLength(9);
    expect(lines[0].number).toBe(1);
    expect(lines[8].number).toBe(9);
  });

  it('assigns stack trace lines to the entry they belong to', () => {
    expect(lines[2].level).toBe('ERROR');
    for (const i of [3, 4, 5, 6, 7]) {
      expect(lines[i].level, lines[i].text).toBe('ERROR');
    }
    expect(lines[4].continuation).toBe(true);
    expect(lines[6].continuation).toBe(true);
    expect(lines[8].level).toBe('DEBUG');
  });

  it('computes pauses between timestamped entries', () => {
    expect(lines[0].gap).toBeNull();
    expect(lines[1].gap).toBe(1377);
    expect(lines[2].gap).toBe(5500);
    expect(lines[4].gap).toBeNull();
    expect(lines[8].gap).toBe(10);
  });

  it('turns JSON records into readable lines with their level and time', () => {
    const [info, error, pino] = parseLog(
      [
        '{"@timestamp":"2024-03-01T10:00:00Z","level":"INFO","message":"started","port":8080}',
        '{"time":"2024-03-01T10:00:02Z","severity":"error","msg":"boom"}',
        '{"level":50,"time":1709287203000,"msg":"pino error"}',
      ].join('\n'),
    );
    expect(info.level).toBe('INFO');
    expect(info.text).toBe('2024-03-01T10:00:00Z INFO started {"port":8080}');
    expect(error.level).toBe('ERROR');
    expect(error.gap).toBe(2000);
    expect(pino.level).toBe('ERROR');
    expect(pino.time).toBe(1709287203000);
  });

  it('handles Windows line endings and a missing final newline', () => {
    expect(parseLog('a INFO\r\nb WARN')).toHaveLength(2);
  });
});

describe('LogParser', () => {
  it('gives the same result when fed in chunks as in one go', () => {
    const rawLines = splitLines(SPRING_LOG);
    const parser = new LogParser();
    const chunked = [
      ...parser.push(rawLines.slice(0, 4)),
      ...parser.push(rawLines.slice(4, 5)),
      ...parser.push(rawLines.slice(5)),
    ];
    expect(chunked).toEqual(parseLog(SPRING_LOG));
  });

  it('flags lines that show credentials', () => {
    const [clean, leaked, placeholder] = parseLog(
      [
        '2024-03-01 10:00:00 INFO connecting to database',
        '2024-03-01 10:00:01 DEBUG url=jdbc:postgresql://app:Sup3rS3cret@db:5432/app',
        '2024-03-01 10:00:02 DEBUG spring.datasource.password=${DB_PASSWORD}',
      ].join('\n'),
    );
    expect(clean.secret).toBe(false);
    expect(leaked.secret).toBe(true);
    expect(placeholder.secret).toBe(false);
  });
});

describe('filterLines', () => {
  const lines = parseLog(SPRING_LOG);
  const all = { levels: new Set(LEVELS), includeUnknown: true, query: '', regex: false, caseSensitive: false };

  it('filters by level, keeping stack traces with their error', () => {
    const errors = filterLines(lines, { ...all, levels: new Set(['ERROR'] as const) });
    expect(errors).toHaveLength(6);
    expect(errors.every((l) => l.level === 'ERROR')).toBe(true);
  });

  it('searches as plain text, case-insensitive by default', () => {
    expect(filterLines(lines, { ...all, query: 'connection' })).toHaveLength(2);
    expect(filterLines(lines, { ...all, query: 'connection', caseSensitive: true })).toHaveLength(1);
  });

  it('supports regular expressions and reports invalid ones', () => {
    expect(filterLines(lines, { ...all, query: 'SpringApplication\\.java:\\d+', regex: true })).toHaveLength(2);
    expect(() => filterLines(lines, { ...all, query: '([', regex: true })).toThrow(SyntaxError);
  });
});

describe('collapseRepeats', () => {
  it('merges lines that differ only in timestamps and numbers', () => {
    const lines = parseLog(
      [
        '2024-03-01 10:00:00 WARN retry 1 of 5 for job 123',
        '2024-03-01 10:00:01 WARN retry 2 of 5 for job 123',
        '2024-03-01 10:00:02 WARN retry 3 of 5 for job 123',
        '2024-03-01 10:00:03 INFO done',
      ].join('\n'),
    );
    const collapsed = collapseRepeats(lines);
    expect(collapsed).toHaveLength(2);
    expect(collapsed[0].repeat).toBe(3);
    expect(collapsed[1].repeat).toBe(1);
  });

  it('ignores thread names', () => {
    expect(signature('10:00:01 WARN [main] Retry 1 of 10')).toBe(signature('10:00:02 WARN [scheduling-1] Retry 2 of 10'));
  });

  it('normalizes UUIDs', () => {
    expect(signature('request 0f8fad5b-d9cb-469f-a165-70867728950e done')).toBe(
      signature('request 7c9e6679-7425-40de-944b-e07fc1f90ae7 done'),
    );
  });
});

describe('helpers', () => {
  it('counts lines per level', () => {
    const counts = countByLevel(parseLog(SPRING_LOG));
    expect(counts).toEqual({ ERROR: 6, WARN: 1, INFO: 1, DEBUG: 1, TRACE: 0, UNKNOWN: 0 });
  });

  it('recognizes logs and rejects prose', () => {
    expect(looksLikeLog(SPRING_LOG)).toBe(true);
    expect(looksLikeLog('Once upon a time\nthere was a cat\nwho liked milk\nthe end')).toBe(false);
  });

  it('formats gaps compactly', () => {
    expect(formatGap(250)).toBe('+250ms');
    expect(formatGap(5500)).toBe('+5.5s');
    expect(formatGap(125_000)).toBe('+2m5s');
    expect(formatGap(5_400_000)).toBe('+1.5h');
  });

  it('parses a 100k line log quickly', () => {
    const big = Array.from(
      { length: 100_000 },
      (_, i) => `2024-03-01 10:00:00.${String(i % 1000).padStart(3, '0')} INFO line ${i}`,
    ).join('\n');
    const started = performance.now();
    expect(parseLog(big)).toHaveLength(100_000);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('fixes from the 0.2.0 bug report', () => {
  it('flags and masks the body of a PEM private key, not just its header', () => {
    const lines = parseLog(
      [
        '2024-03-01 10:00:00 DEBUG loaded key:',
        '-----BEGIN EC PRIVATE KEY-----',
        'MHcCAQEEIBase64BodyLine1',
        'MoreBase64Body==',
        '-----END EC PRIVATE KEY-----',
        '2024-03-01 10:00:01 INFO next',
      ].join('\n'),
    );
    expect(lines.map((l) => [l.secret, l.secretBlock])).toEqual([
      [false, false],
      [true, false],
      [true, true],
      [true, true],
      [false, false],
      [false, false],
    ]);
    expect(lines[2].level).toBe('DEBUG');
  });

  it('shows pino and zap records with a date and a level name', () => {
    const [pino, zap] = parseLog(
      ['{"level":30,"time":1700000000000,"msg":"started"}', '{"level":"warn","ts":1700000000.25,"msg":"slow"}'].join('\n'),
    );
    expect(pino.text).toBe('2023-11-14T22:13:20.000Z INFO started');
    expect(zap.text).toBe('2023-11-14T22:13:20.250Z warn slow');
  });

  it('collapses repeated entries together with their stack traces', () => {
    const entry = (n: number) => [
      `2024-03-01 10:00:0${n} ERROR Failed job ${n}`,
      '\tat com.example.Job.run(Job.java:42)',
      '\tat java.lang.Thread.run(Thread.java:833)',
    ];
    const lines = parseLog([1, 2, 3, 4, 5, 6].flatMap(entry).join('\n'));
    const collapsed = collapseRepeats(lines);
    expect(collapsed).toHaveLength(3);
    expect(collapsed[0].repeat).toBe(6);
  });

  it('reads syslog, nginx, Android and epoch timestamps', () => {
    expect(parseTimestamp('Sep 29 10:00:00 host sshd[1]: ok')).toBe(Date.UTC(new Date().getUTCFullYear(), 8, 29, 10, 0, 0));
    expect(parseTimestamp('1.2.3.4 - - [29/Sep/2026:10:00:00 +0200] "GET / HTTP/1.1" 200')).toBe(Date.UTC(2026, 8, 29, 8, 0, 0));
    expect(parseTimestamp('09-29 10:00:00.123  123  456 W Tag: msg')).toBe(
      Date.UTC(new Date().getUTCFullYear(), 8, 29, 10, 0, 0, 123),
    );
    expect(parseTimestamp('1700000000 job done')).toBe(1700000000000);
    expect(parseTimestamp('1700000000123 job done')).toBe(1700000000123);
    expect(parseTimestamp('1234567890123456 not a time')).toBeNull();
  });

  it('detects levels in context only, so prose stays neutral', () => {
    expect(detectLevel('no error here')).toBeNull();
    expect(detectLevel('the information desk')).toBeNull();
    expect(detectLevel('Error: ENOENT: no such file')).toBe('ERROR');
    expect(detectLevel('<warn> disk')).toBe('WARN');
    expect(detectLevel('E/ActivityManager( 123): crash')).toBe('ERROR');
    expect(detectLevel('09-29 10:00:00.123  123  456 W Tag: low memory')).toBe('WARN');
    expect(detectLevel('[W] disk almost full')).toBe('WARN');
    expect(detectLevel('10:00:00 DBG cache hit')).toBe('DEBUG');
  });

  it('formats gaps without rounding artefacts', () => {
    expect(formatGap(59_999)).toBe('+59.9s');
    expect(formatGap(3_599_999)).toBe('+59m59s');
    expect(formatGap(-5)).toBe('−5ms');
    expect(formatGap(-3000)).toBe('−3.0s');
    expect(formatGap(NaN)).toBe('');
    expect(formatGap(Infinity)).toBe('');
  });
});
