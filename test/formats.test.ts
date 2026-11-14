import { describe, expect, it } from 'vitest';
import { detectLevel, formatJsonRecord, parseLog, parseTimeOfDay, parseTimestamp } from '../src/lib/logs';

/** One line of a real log in each format: [name, line, its level, whether it has a time]. */
const FORMATS: [string, string, string | null, boolean][] = [
  ['klog info', 'I1004 10:00:00.123456       1 controller.go:123] Starting controller', 'INFO', true],
  ['klog error', 'E1004 10:00:01.000000       1 reflector.go:138] Failed to watch *v1.Pod', 'ERROR', true],
  ['klog warning', 'W1004 10:00:02.000000       1 warnings.go:70] policy/v1beta1 is deprecated', 'WARN', true],
  ['nginx error', '2026/10/04 10:00:00 [error] 1234#1234: *1 connect() failed (111: Connection refused)', 'ERROR', true],
  ['nginx crit', '2026/10/04 10:00:00 [crit] 1234#1234: *1 SSL_do_handshake() failed', 'ERROR', true],
  ['nginx emerg', '2026/10/04 10:00:00 [emerg] 1#1: bind() to 0.0.0.0:80 failed (98: Address already in use)', 'ERROR', true],
  ['nginx alert', '2026/10/04 10:00:00 [alert] 1#1: worker process 31 exited on signal 9', 'ERROR', true],
  ['nginx notice', '2026/10/04 10:00:00 [notice] 1#1: start worker processes', 'INFO', true],
  [
    'access log 502',
    '192.168.1.1 - - [04/Oct/2026:10:00:00 +0000] "GET /api/orders HTTP/1.1" 502 157 "-" "curl/8.4"',
    'ERROR',
    true,
  ],
  [
    'access log 404',
    '192.168.1.1 - bob [04/Oct/2026:10:00:01 +0000] "GET /missing HTTP/1.1" 404 153 "-" "Mozilla/5.0"',
    'WARN',
    true,
  ],
  ['access log 200', '192.168.1.1 - - [04/Oct/2026:10:00:02 +0000] "GET / HTTP/2.0" 200 612 "-" "Mozilla/5.0"', 'INFO', true],
  ['Envoy access log', '[2026-10-04T10:00:00.000Z] "GET /api HTTP/1.1" 503 UF upstream_reset 0 91 3 - "-" "curl"', 'ERROR', true],
  ['syslog', 'Oct  4 10:00:00 web-1 sshd[123]: Failed password for root from 10.0.0.5 port 22 ssh2', null, true],
  ['journald', 'Oct 04 10:00:00.123456 web-1 app[1]: started', null, true],
  ['syslog RFC 5424', "<34>1 2026-10-04T10:00:00.003Z mymachine su - ID47 - 'su root' failed for lonvick", 'ERROR', true],
  ['syslog RFC 3164', '<28>Oct  4 10:00:00 web-1 kernel: disk almost full', 'WARN', true],
  ['Python logging', '2026-10-04 10:00:00,123 - myapp - ERROR - Something failed', 'ERROR', true],
  ['Python basicConfig', 'WARNING:werkzeug: * Debugger is active!', 'WARN', false],
  ['Go log', '2026/10/04 10:00:00 http: panic serving 10.0.0.1:1234: runtime error', null, true],
  ['Go slog', 'time=2026-10-04T10:00:00.000Z level=WARN msg="slow query" took=1.2s', 'WARN', true],
  ['logrus', 'time="2026-10-04T10:00:00Z" level=fatal msg="cannot start"', 'ERROR', true],
  ['zap console error', '2026-10-04T10:00:00.000Z\terror\thandler/orders.go:42\tcharge failed\t{"order": 7781}', 'ERROR', true],
  ['zap console info', '2026-10-04T10:00:00.000Z\tinfo\tserver/main.go:10\tlistening', 'INFO', true],
  ['winston', '2026-10-04T10:00:00.000Z error: upstream timeout', 'ERROR', true],
  ['winston, no zone', '2026-10-04 10:00:00 warn: retrying', 'WARN', true],
  ['Rust tracing', '2026-10-04T10:00:00.000000Z ERROR my_app::db: connection lost', 'ERROR', true],
  ['.NET fail', 'fail: Microsoft.AspNetCore.Server.Kestrel[13]', 'ERROR', false],
  ['.NET crit', 'crit: Microsoft.AspNetCore.Hosting[6]', 'ERROR', false],
  ['.NET dbug', 'dbug: Microsoft.Extensions.Hosting[1]', 'DEBUG', false],
  ['.NET trce', 'trce: Microsoft.AspNetCore.Routing[1]', 'TRACE', false],
  ['Serilog INF', '[10:00:00 INF] Now listening on: http://localhost:5000', 'INFO', true],
  ['Serilog WRN', '[10:00:01 WRN] Slow request', 'WARN', true],
  ['Serilog FTL', '[10:00:02 FTL] Host terminated unexpectedly', 'ERROR', true],
  ['Serilog VRB', '[10:00:03 VRB] tick', 'TRACE', true],
  ['Logback, time only', '10:00:00.123 [main] ERROR com.example.Pay - charge failed', 'ERROR', true],
  ['Rails', 'I, [2026-10-04T10:00:00.123456 #1234]  INFO -- : Started GET "/"', 'INFO', true],
  ['Monolog', '[2026-10-04 10:00:00] production.ERROR: Undefined variable $x {"exception":"[object]"}', 'ERROR', true],
  ['Monolog warning', '[2026-10-04T10:00:00.123456+00:00] app.WARNING: Cache miss [] []', 'WARN', true],
  ['PHP fatal', '[04-Oct-2026 10:00:00 UTC] PHP Fatal error:  Uncaught Exception: boom in /var/www/a.php:3', 'ERROR', true],
  [
    'PHP warning',
    '[04-Oct-2026 10:00:00 Europe/Kyiv] PHP Warning:  Undefined array key "a" in /var/www/a.php on line 3',
    'WARN',
    true,
  ],
  [
    'PostgreSQL error',
    '2026-10-04 10:00:00.123 UTC [1234] ERROR:  relation "users" does not exist at character 15',
    'ERROR',
    true,
  ],
  ['PostgreSQL log', '2026-10-04 10:00:00.123 UTC [1] LOG:  database system is ready to accept connections', 'INFO', true],
  ['MySQL note', '2026-10-04T10:00:00.123456Z 0 [Note] [MY-010931] [Server] ready for connections', 'INFO', true],
  ['MySQL system', '2026-10-04T10:00:00.123456Z 0 [System] [MY-010116] [Server] mysqld starting', 'INFO', true],
  ['Redis warning', '1234:M 04 Oct 2026 10:00:00.123 # WARNING overcommit_memory is set to 0!', 'WARN', true],
  ['Redis notice', '1234:M 04 Oct 2026 10:00:00.456 * Ready to accept connections tcp', 'INFO', true],
  [
    'Apache error',
    '[Sun Oct 04 10:00:00.123456 2026] [core:error] [pid 1234] [client 10.0.0.1:5] AH00124: Request exceeded the limit',
    'ERROR',
    true,
  ],
  ['Apache notice', '[Sun Oct 04 10:00:00.123456 2026] [mpm_event:notice] [pid 1] AH00489: Apache/2.4 configured', 'INFO', true],
  ['java.util.logging', 'Oct 04, 2026 10:00:00 AM com.example.Main start', null, true],
  [
    'Elasticsearch',
    '[2026-10-04T10:00:00,123][WARN ][o.e.c.r.a.DiskThresholdMonitor] [node-1] high disk watermark',
    'WARN',
    true,
  ],
  [
    'MongoDB error',
    '{"t":{"$date":"2026-10-04T10:00:00.000+00:00"},"s":"E","c":"NETWORK","id":22943,"ctx":"listener","msg":"Connection refused"}',
    'ERROR',
    true,
  ],
  [
    'MongoDB info',
    '{"t":{"$date":"2026-10-04T10:00:00.000+00:00"},"s":"I","c":"NETWORK","id":22943,"ctx":"listener","msg":"Connection accepted"}',
    'INFO',
    true,
  ],
  [
    'MongoDB debug',
    '{"t":{"$date":"2026-10-04T10:00:00.000+00:00"},"s":"D2","c":"QUERY","id":1,"ctx":"conn1","msg":"plan"}',
    'DEBUG',
    true,
  ],
  [
    'Docker json-file',
    '{"log":"2026-10-04 10:00:00 ERROR payment failed\\n","stream":"stderr","time":"2026-10-04T10:00:00.123456789Z"}',
    'ERROR',
    true,
  ],
  ['Google Cloud EMERGENCY', '{"severity":"EMERGENCY","message":"disk gone","timestamp":"2026-10-04T10:00:00Z"}', 'ERROR', true],
  ['Google Cloud ALERT', '{"severity":"ALERT","message":"quota","timestamp":"2026-10-04T10:00:00Z"}', 'ERROR', true],
  ['Google Cloud DEFAULT', '{"severity":"DEFAULT","message":"hello","timestamp":"2026-10-04T10:00:00Z"}', null, true],
  ['AWS Lambda', '2026-10-04T10:00:00.000Z\t8b1c\tERROR\tInvoke Error', 'ERROR', true],
  ['container runtime (CRI)', '2026-10-04T10:00:00.123456789Z stderr F panic: runtime error: index out of range', 'ERROR', true],
  ['npm ERR!', 'npm ERR! code ELIFECYCLE', 'ERROR', false],
  ['npm error (npm 10)', 'npm error code ERESOLVE', 'ERROR', false],
  ['npm warn (npm 10)', 'npm warn deprecated inflight@1.0.6: This module is not supported', 'WARN', false],
  ['npm in a CI log', '2026-10-04T10:00:00.1234567Z npm ERR! code ELIFECYCLE', 'ERROR', true],
  ['GitHub Actions ::error', '::error file=app.js,line=1::Missing semicolon', 'ERROR', false],
  ['GitHub Actions ::warning', '::warning::Node.js 16 actions are deprecated', 'WARN', false],
  ['Maven', '[ERROR] Failed to execute goal org.apache.maven.plugins:maven-compiler-plugin', 'ERROR', false],
  ['Gradle', 'FAILURE: Build failed with an exception.', 'ERROR', false],
  ['Gradle task', '> Task :app:test FAILED', 'ERROR', false],
  ['Jest', 'FAIL src/payments.test.ts', 'ERROR', false],
  ['go test', '--- FAIL: TestCharge (0.01s)', 'ERROR', false],
  ['pytest', 'FAILED tests/test_pay.py::test_refund - AssertionError: assert 500 == 200', 'ERROR', false],
  ['systemd boot', '[FAILED] Failed to start nginx.service - A high performance web server.', 'ERROR', false],
  ['gcc error', "src/main.c:12:5: error: expected ';' before 'return'", 'ERROR', false],
  ['gcc fatal error', 'src/main.c:1:10: fatal error: missing.h: No such file or directory', 'ERROR', false],
  ['gcc warning', 'src/main.c:20:9: warning: unused variable ‘x’ [-Wunused-variable]', 'WARN', false],
  ['tsc', "src/app.ts(12,5): error TS2304: Cannot find name 'foo'.", 'ERROR', false],
  [
    'MSBuild warning',
    'Program.cs(7,13): warning CS0168: The variable is declared but never used [/src/app.csproj]',
    'WARN',
    false,
  ],
  ['rustc', 'error[E0425]: cannot find value `x` in this scope', 'ERROR', false],
  ['ESLint', '  12:5  error  Missing semicolon  semi', 'ERROR', false],
  ['Terraform', '│ Error: Invalid reference', 'ERROR', false],
  ['Celery', '[2026-10-04 10:00:00,123: ERROR/MainProcess] Task app.charge[1a2b] raised unexpected: KeyError', 'ERROR', true],
  ['Gunicorn', '[2026-10-04 10:00:00 +0000] [1234] [INFO] Starting gunicorn 21.2.0', 'INFO', true],
  ['Uvicorn', 'INFO:     127.0.0.1:51000 - "GET / HTTP/1.1" 500 Internal Server Error', 'INFO', false],
  ['Envoy', '[2026-10-04 10:00:00.000][1][warning][config] gRPC config stream closed', 'WARN', true],
];

/** Lines that only look like one of the above. */
const NOT_LEVELS: [string, string][] = [
  ['"error" in a sentence', '2026-10-04 10:00:00 Retrying after error in upstream call'],
  ['a count of failed tests', 'Tests: 120 passed, 0 failed'],
  ['"info:" inside a sentence', 'For more info: see the docs'],
  ['a level word in a path', 'Downloading https://example.com/error/log.txt'],
  ['numbers that look like a status', '2026-10-04 10:00:00 processed 500 orders in 502 ms'],
  ['a quoted text that is not a request', 'user said "GET lost" 500 times'],
  ['ALERT, which people set up as their own word', 'ALERT disk almost full'],
  ['INF as a number', 'max latency: INF, min latency: 0'],
  ['a word after a timestamp', '2026-10-04 10:00:00 Error handler registered'],
  ['LOG without the two spaces of PostgreSQL', 'LOG: rotated'],
  ['a bracketed word that is no severity', '2026-10-04T10:00:00Z 0 [Server] started'],
];

describe('real-world log formats', () => {
  it.each(FORMATS)('%s', (_name, line, level, hasTime) => {
    const [parsed] = parseLog(line);
    expect(parsed.level).toBe(level);
    expect(parsed.time !== null).toBe(hasTime);
  });

  it.each(NOT_LEVELS)('no level for %s', (_name, line) => {
    expect(parseLog(line)[0].level).toBeNull();
  });

  it('reads the format before the level words in the message', () => {
    expect(detectLevel('2026-10-04 10:00:00 UTC [7] LOG:  statement: SELECT * FROM logs WHERE level = ERROR ')).toBe('INFO');
    expect(detectLevel('[2026-10-04 10:00:00] app.WARNING: got INFO from upstream')).toBe('WARN');
  });

  it('lets a level word win over the status of an access log', () => {
    expect(detectLevel('WARN 10.0.0.1 "GET /health HTTP/1.1" 200 2')).toBe('WARN');
  });

  it('reads a long request path', () => {
    expect(detectLevel(`10.0.0.1 - - [04/Oct/2026:10:00:00 +0000] "GET /${'a'.repeat(900)} HTTP/1.1" 500 12`)).toBe('ERROR');
  });
});

describe('timestamps of more formats', () => {
  const iso = (text: string) => new Date(parseTimestamp(text)!).toISOString();

  it('reads the dates of PHP, Redis, Apache and java.util.logging', () => {
    expect(iso('[04-Oct-2026 10:00:00 UTC] PHP Warning:  x')).toBe('2026-10-04T10:00:00.000Z');
    expect(iso('1234:M 04 Oct 2026 10:00:00.123 * Ready')).toBe('2026-10-04T10:00:00.123Z');
    expect(iso('[Sun Oct 04 10:00:00.123456 2026] [core:error] x')).toBe('2026-10-04T10:00:00.123Z');
    expect(iso('Oct 04, 2026 10:00:00 AM com.example.Main start')).toBe('2026-10-04T10:00:00.000Z');
    expect(iso('Oct 04, 2026 12:30:00 AM com.example.Main start')).toBe('2026-10-04T00:30:00.000Z');
    expect(iso('Oct 04, 2026 1:05:09 PM com.example.Main start')).toBe('2026-10-04T13:05:09.000Z');
  });

  it('reads klog in the current year', () => {
    expect(iso('E1004 10:00:01.250000       1 reflector.go:138] x').slice(4)).toBe('-10-04T10:00:01.250Z');
  });

  it('reads a time without a date', () => {
    expect(parseTimeOfDay('10:00:00.123 [main] INFO x')).toBe(36_000_123);
    expect(parseTimeOfDay('[23:59:59 INF] x')).toBe(86_399_000);
    expect(parseTimeOfDay('10:00:00,5 x')).toBe(36_000_500);
    expect(parseTimeOfDay('25:00:00 x')).toBeNull();
    expect(parseTimeOfDay('10:00:00x')).toBeNull();
    expect(parseTimeOfDay('at 10:00:00 it broke')).toBeNull();
  });

  it('counts gaps between time-only lines, also over midnight', () => {
    const lines = parseLog(
      [
        '23:59:58.000 [main] INFO a',
        '23:59:59.500 [main] INFO b',
        '00:00:01.000 [main] WARN c',
        '00:00:01.250 [main] INFO d',
      ].join('\n'),
    );
    expect(lines.map((l) => l.gap)).toEqual([null, 1500, 1500, 250]);
  });

  it('does not take a late line of another thread for the next day', () => {
    const lines = parseLog(['10:00:01.000 [a] INFO a', '10:00:00.900 [b] INFO b', '10:00:02.000 [a] INFO c'].join('\n'));
    expect(lines.map((l) => l.gap)).toEqual([null, -100, 1100]);
  });
});

describe('JSON records of more formats', () => {
  it("shows Docker's json-file line as the line it wraps", () => {
    const [line] = parseLog(
      '{"log":"2026-10-04 10:00:00 ERROR payment failed\\n","stream":"stderr","time":"2026-10-04T10:00:00.5Z"}',
    );
    expect(line.text).toBe('2026-10-04T10:00:00.5Z 2026-10-04 10:00:00 ERROR payment failed {"stream":"stderr"}');
    expect(line.time).toBe(Date.parse('2026-10-04T10:00:00.5Z'));
  });

  it('shows a MongoDB record with its time and level', () => {
    const record = JSON.parse('{"t":{"$date":"2026-10-04T10:00:00.000+00:00"},"s":"W","c":"NETWORK","msg":"slow"}');
    expect(formatJsonRecord(record)).toBe('2026-10-04T10:00:00.000+00:00 WARN slow {"c":"NETWORK"}');
  });

  it('leaves a record alone that only has a key called t or s', () => {
    expect(formatJsonRecord({ t: 5, s: 'I', msg: 'x' })).toBe('x {"t":5,"s":"I"}');
  });

  it('keeps a message with line breaks on one row', () => {
    const text = formatJsonRecord({ level: 'error', message: 'boom\n  at a.js:1\r\n  at b.js:2\n' });
    expect(text).toBe('error boom ⏎   at a.js:1 ⏎   at b.js:2');
    expect(text).not.toContain('\n');
  });

  it('takes the level from the message only when the record has no level field', () => {
    expect(parseLog('{"message":"ERROR in the text","level":"info"}')[0].level).toBe('INFO');
    expect(parseLog('{"message":"ERROR in the text"}')[0].level).toBe('ERROR');
    expect(parseLog('{"message":"all fine"}')[0].level).toBeNull();
  });
});
