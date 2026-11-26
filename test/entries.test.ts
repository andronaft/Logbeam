import { describe, expect, it } from 'vitest';
import { diffErrors, groupErrors } from '../src/lib/insights';
import { LogLine, eachEntry, parseLog } from '../src/lib/logs';
import { excludeWords } from '../src/lib/fields';
import { hideMuted, muteKey } from '../src/lib/mute';

/** The first line of each entry, as eachEntry sees them. */
function heads(lines: LogLine[]): string[] {
  const out: string[] = [];
  eachEntry(lines, (line, starts) => {
    if (starts) out.push(line.text);
  });
  return out;
}

const PYTHON = `2026-11-26 03:12:01,123 ERROR [worker] Task failed
Traceback (most recent call last):
  File "/app/worker.py", line 42, in run
    result = charge(order)
  File "/app/pay.py", line 7, in charge
    raise TimeoutError("gateway")
TimeoutError: gateway

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "/app/worker.py", line 44, in run
    raise RetryError() from e
app.errors.RetryError
2026-11-26 03:12:02,000 INFO [worker] next`;

const NODE = `/app/node_modules/pg/lib/client.js:132
      throw err
      ^

Error: connect ECONNREFUSED 10.0.0.5:5432
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1555:16) {
  errno: -111,
  code: 'ECONNREFUSED',
  syscall: 'connect'
}

Node.js v20.11.0`;

const GO = `panic: runtime error: invalid memory address or nil pointer dereference
[signal SIGSEGV: segmentation violation code=0x1 addr=0x0 pc=0x47a3c2]

goroutine 1 [running]:
main.handler(0x0)
	/app/main.go:12 +0x22
main.main()
	/app/main.go:20 +0x1d
exit status 2`;

const TERRAFORM = `╷
│ Error: creating EC2 Instance: UnauthorizedOperation: You are not authorized to perform this operation.
│
│   with aws_instance.web,
│   on main.tf line 12, in resource "aws_instance" "web":
│   12: resource "aws_instance" "web" {
│
╵`;

describe('one error is one entry', () => {
  it('a Python traceback with a chained exception is one error group', () => {
    const groups = groupErrors(parseLog(PYTHON));
    expect(groups).toHaveLength(1);
    expect(groups[0].sample).toBe('2026-11-26 03:12:01,123 ERROR [worker] Task failed');
  });

  it('every line of a Python traceback continues its entry', () => {
    const lines = parseLog(PYTHON);
    expect(lines.slice(1, 14).every((line) => line.continuation && line.level === 'ERROR')).toBe(true);
    expect(lines[14]).toMatchObject({ level: 'INFO', continuation: false });
  });

  it('a traceback printed on its own is an error', () => {
    const lines = parseLog(`starting worker
Traceback (most recent call last):
  File "/app/main.py", line 3, in <module>
    os.environ["DATABASE_URL"]
KeyError: 'DATABASE_URL'
worker stopped`);
    expect(lines.map((line) => line.level)).toEqual([null, 'ERROR', 'ERROR', 'ERROR', 'ERROR', null]);
    const groups = groupErrors(lines);
    expect(groups).toHaveLength(1);
    expect(groups[0].lines).toEqual([2]);
  });

  it('the traceback ends at the exception line', () => {
    const lines = parseLog(`ERROR job failed
Traceback (most recent call last):
  File "/app/job.py", line 1, in <module>
ValueError: bad input
the next job`);
    expect(lines[3].continuation).toBe(true);
    // the line after the exception is not a traceback line (it still takes the error's level, as before)
    expect(lines[4].continuation).toBe(false);
  });

  it('a Node error with its object dump and the Node version line is one group', () => {
    expect(groupErrors(parseLog(NODE))).toHaveLength(1);
  });

  it('a Go panic with its goroutine dump and exit status is one group', () => {
    const groups = groupErrors(parseLog(GO));
    expect(groups).toHaveLength(1);
    expect(groups[0].sample).toMatch(/^panic: runtime error/);
  });

  it('a Terraform error box is one group', () => {
    expect(groupErrors(parseLog(TERRAFORM))).toHaveLength(1);
  });

  it('a Spring error and the exception under it are one group', () => {
    const groups = groupErrors(
      parseLog(`2026-11-26 03:12:01.123 ERROR 1 --- [nio-8080-exec-1] o.a.c.c.C.[dispatcherServlet] : Servlet.service() threw exception
org.springframework.dao.DataAccessResourceFailureException: Unable to acquire JDBC Connection
	at org.springframework.orm.jpa.vendor.HibernateJpaDialect.convert(HibernateJpaDialect.java:277)
Caused by: java.sql.SQLTransientConnectionException: HikariPool-1 - Connection is not available
2026-11-26 03:12:02.000  INFO 1 --- [main] c.e.App : next`),
    );
    expect(groups).toHaveLength(1);
  });

  it('the same error twice is still counted twice', () => {
    const groups = groupErrors(parseLog(`${NODE}\n${NODE}`));
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(2);
  });

  it('errors with the same message but other stack frames stay apart', () => {
    const groups = groupErrors(
      parseLog(`ERROR boom
	at a.A.run(A.java:1)
ERROR boom
	at b.B.run(B.java:1)`),
    );
    expect(groups).toHaveLength(2);
  });

  it('the lines that only take an error’s level do not split errors with the same frames', () => {
    const groups = groupErrors(
      parseLog(`ERROR boom
	at a.A.run(A.java:1)
  request 1
ERROR boom
	at a.A.run(A.java:1)
  request 2`),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(2);
  });

  it('Compare does not count the parts of one error as new errors', () => {
    const before = parseLog('2026-11-26 03:00:00,000 INFO [worker] started');
    const diff = diffErrors(before, parseLog(PYTHON));
    expect(diff.added).toHaveLength(1);
  });
});

describe('eachEntry', () => {
  it('a line with a level of its own starts an entry, the lines that only take it do not', () => {
    expect(heads(parseLog(NODE))).toEqual([
      '/app/node_modules/pg/lib/client.js:132',
      '      throw err',
      '      ^',
      '',
      'Error: connect ECONNREFUSED 10.0.0.5:5432',
    ]);
  });

  it('in a log with timestamps, a line without one belongs to the entry above', () => {
    expect(
      heads(
        parseLog(`2026-11-26T03:12:01Z ERROR boom
java.lang.IllegalStateException: bad
2026-11-26T03:12:02Z INFO next`),
      ),
    ).toEqual(['2026-11-26T03:12:01Z ERROR boom', '2026-11-26T03:12:02Z INFO next']);
  });

  it('in a log without timestamps or levels every line is an entry', () => {
    expect(heads(parseLog('one\ntwo\nthree'))).toEqual(['one', 'two', 'three']);
  });

  it('hiding a kind of error hides its whole traceback', () => {
    const lines = parseLog(PYTHON);
    const { lines: kept } = hideMuted(lines, new Set([muteKey(lines[0])]));
    expect(kept.map((line) => line.text)).toEqual(['2026-11-26 03:12:02,000 INFO [worker] next']);
  });

  it('-word leaves out a whole Node error, its object dump with it', () => {
    const kept = excludeWords(parseLog(`${NODE}\nINFO done`), ['ECONNREFUSED'], false);
    expect(kept.map((line) => line.text)).toEqual([
      '/app/node_modules/pg/lib/client.js:132',
      '      throw err',
      '      ^',
      '',
      'INFO done',
    ]);
  });
});
