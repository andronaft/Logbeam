import { describe, expect, it } from 'vitest';
import { parseLog } from '../src/lib/logs';
import { findFailedTests } from '../src/lib/tests';

const report = (text: string) => findFailedTests(parseLog(text));
/** name, line and reason of each failed test, in the order they are listed */
const brief = (text: string) => report(text).failed.map((t) => [t.name, t.line, t.reason]);

const PYTEST = `============================= test session starts ==============================
platform linux -- Python 3.12.4, pytest-8.3.2, pluggy-1.5.0
rootdir: /home/runner/work/shop/shop
collected 12 items

tests/test_cart.py ....                                                  [ 33%]
tests/test_pay.py ..F.F                                                  [ 75%]
tests/test_users.py ..E                                                  [100%]

==================================== ERRORS ====================================
_____________________ ERROR at setup of test_admin_login _______________________

    @pytest.fixture
    def db():
>       raise ConnectionError("database is not up")
E       ConnectionError: database is not up

tests/conftest.py:8: ConnectionError
=================================== FAILURES ===================================
_________________________________ test_refund __________________________________

    def test_refund():
        payment = charge(100)
>       assert refund(payment) == 100
E       AssertionError: assert 0 == 100
E        +  where 0 = refund(<Payment 1>)

tests/test_pay.py:21: AssertionError
___________________________ TestPay.test_currency[eur] ___________________________

self = <tests.test_pay.TestPay object at 0x7f>, code = 'eur'

>       assert convert(1, code) == 0.92
E       assert 0.91 == 0.92

tests/test_pay.py:40: AssertionError
=========================== short test summary info ============================
FAILED tests/test_pay.py::test_refund - AssertionError: assert 0 == 100
FAILED tests/test_pay.py::TestPay::test_currency[eur] - assert 0.91 == 0.92
ERROR tests/test_users.py::test_admin_login - ConnectionError: database is not up
=================== 2 failed, 9 passed, 1 error in 0.42s ===================`;

const GO = `=== RUN   TestCharge
=== RUN   TestCharge/positive
=== RUN   TestCharge/zero
    charge_test.go:31: expected an error for a zero amount, got nil
--- FAIL: TestCharge (0.02s)
    --- PASS: TestCharge/positive (0.01s)
    --- FAIL: TestCharge/zero (0.00s)
=== RUN   TestRefund
--- PASS: TestRefund (0.00s)
=== RUN   TestCurrency
--- FAIL: TestCurrency (0.00s)
    currency_test.go:12: convert(1, "eur") = 0.91, want 0.92
FAIL
FAIL	github.com/acme/shop/pay	0.031s
FAIL`;

const JEST = `PASS src/cart.test.ts
FAIL src/pay.test.ts (1.234 s)
  ● PaymentService › refunds twice

    expect(received).toBe(expected) // Object.is equality

    Expected: 1
    Received: 2

      40 |     const refunds = await service.refund(payment);
    > 41 |     expect(refunds).toBe(1);
         |                     ^

      at Object.<anonymous> (src/pay.test.ts:41:21)

  ● PaymentService › rejects a negative amount

    TypeError: Cannot read properties of undefined (reading 'amount')

  ● Console

    console.log
      charging 100

FAIL src/broken.test.ts
  ● Test suite failed to run

    Cannot find module './missing' from 'src/broken.test.ts'

Summary of all failing tests
FAIL src/pay.test.ts (1.234 s)
  ● PaymentService › refunds twice

    expect(received).toBe(expected) // Object.is equality

Test Suites: 2 failed, 1 passed, 3 total
Tests:       2 failed, 10 passed, 12 total
Snapshots:   0 total
Time:        2.345 s
Ran all test suites.`;

const MAVEN = `[INFO] -------------------------------------------------------
[INFO]  T E S T S
[INFO] -------------------------------------------------------
[INFO] Running com.acme.shop.CartTest
[INFO] Tests run: 5, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 0.08 s -- in com.acme.shop.CartTest
[INFO] Running com.acme.shop.PayTest
[ERROR] Tests run: 7, Failures: 1, Errors: 1, Skipped: 0, Time elapsed: 0.11 s <<< FAILURE! -- in com.acme.shop.PayTest
[ERROR] com.acme.shop.PayTest.refund -- Time elapsed: 0.012 s <<< FAILURE!
org.opentest4j.AssertionFailedError: expected: <1> but was: <2>
	at org.junit.jupiter.api.AssertionFailureBuilder.build(AssertionFailureBuilder.java:151)
	at com.acme.shop.PayTest.refund(PayTest.java:42)

[ERROR] charge(com.acme.shop.PayTest)  Time elapsed: 0.003 s  <<< ERROR!
java.lang.NullPointerException: Cannot invoke "Payment.amount()" because "p" is null
	at com.acme.shop.PayTest.charge(PayTest.java:17)

[INFO]
[INFO] Results:
[INFO]
[ERROR] Failures:
[ERROR]   PayTest.refund:42 expected: <1> but was: <2>
[ERROR] Errors:
[ERROR]   PayTest.charge:17 » NullPointer Cannot invoke "Payment.amount()" because "p" is null
[INFO]
[ERROR] Tests run: 12, Failures: 1, Errors: 1, Skipped: 0
[INFO]
[INFO] ------------------------------------------------------------------------
[INFO] BUILD FAILURE
[INFO] ------------------------------------------------------------------------`;

const GRADLE = `> Task :app:compileJava
> Task :app:test

com.acme.shop.PayTest > refund() FAILED
    org.opentest4j.AssertionFailedError: expected: <1> but was: <2>
        at app//com.acme.shop.PayTest.refund(PayTest.java:42)

com.acme.shop.PayTest > Currency > converts euros() FAILED
    java.lang.ArithmeticException at PayTest.java:61

12 tests completed, 2 failed

> Task :app:test FAILED

FAILURE: Build failed with an exception.`;

const RSPEC = `Randomized with seed 4242
..F..F.

Failures:

  1) Pay refunds twice
     Failure/Error: expect(pay.refunds.count).to eq(1)

       expected: 1
            got: 2

       (compared using ==)
     # ./spec/pay_spec.rb:12:in \`block (2 levels) in <top (required)>'

  2) Pay converts euros
     Failure/Error: Currency.convert(1, :eur)

     NoMethodError:
       undefined method \`rate' for nil
     # ./spec/pay_spec.rb:20:in \`block (2 levels) in <top (required)>'

Finished in 0.0612 seconds (files took 0.31 seconds to load)
7 examples, 2 failures

Failed examples:

rspec ./spec/pay_spec.rb:12 # Pay refunds twice
rspec ./spec/pay_spec.rb:19 # Pay converts euros`;

describe('findFailedTests', () => {
  it('reads pytest: failures and errors, each once, with the assertion', () => {
    const { failed, totals } = report(PYTEST);
    expect(failed.map((t) => [t.runner, t.name, t.where, t.reason])).toEqual([
      ['pytest', 'test_admin_login', 'tests/test_users.py', 'ConnectionError: database is not up'],
      ['pytest', 'test_refund', 'tests/test_pay.py', 'AssertionError: assert 0 == 100'],
      ['pytest', 'TestPay::test_currency[eur]', 'tests/test_pay.py', 'assert 0.91 == 0.92'],
    ]);
    // the "___ header ___" is where it fails, not the summary line at the end
    expect(failed.map((t) => t.line)).toEqual([11, 20, 29]);
    expect(totals).toEqual({ failed: 3, total: 12 });
  });

  it('reads pytest -v lines and a summary without the long report', () => {
    const text = `tests/test_pay.py::test_charge PASSED                                    [ 50%]
tests/test_pay.py::test_refund FAILED                                    [100%]

=========================== short test summary info ============================
FAILED tests/test_pay.py::test_refund - AssertionError: assert 0 == 100
========================= 1 failed, 1 passed in 0.10s ==========================`;
    expect(brief(text)).toEqual([['test_refund', 2, 'AssertionError: assert 0 == 100']]);
  });

  it('keeps two failed tests with the same name in different files apart', () => {
    const text = `=================================== FAILURES ===================================
___________________________________ test_init ___________________________________
E       assert False
___________________________________ test_init ___________________________________
E       assert None
=========================== short test summary info ============================
FAILED tests/test_a.py::test_init - assert False
FAILED tests/test_b.py::test_init - assert None`;
    expect(report(text).failed.map((t) => [t.where, t.line, t.reason])).toEqual([
      ['tests/test_a.py', 2, 'assert False'],
      ['tests/test_b.py', 4, 'assert None'],
    ]);
  });

  it('reads Go: the failed subtest instead of its parent, and what the test logged', () => {
    const { failed, totals } = report(GO);
    expect(failed.map((t) => [t.runner, t.name, t.where, t.line, t.reason])).toEqual([
      ['go', 'TestCharge/zero', 'charge_test.go:31', 7, 'expected an error for a zero amount, got nil'],
      ['go', 'TestCurrency', 'currency_test.go:12', 11, 'convert(1, "eur") = 0.91, want 0.92'],
    ]);
    expect(totals).toBeNull();
  });

  it('reads Jest: tests under FAIL files once, a suite that failed to run as its file', () => {
    const { failed, totals } = report(JEST);
    expect(failed.map((t) => [t.runner, t.name, t.where, t.line, t.reason])).toEqual([
      ['jest', 'PaymentService › refunds twice', 'src/pay.test.ts', 3, 'expect(received).toBe(expected) // Object.is equality'],
      [
        'jest',
        'PaymentService › rejects a negative amount',
        'src/pay.test.ts',
        16,
        "TypeError: Cannot read properties of undefined (reading 'amount')",
      ],
      ['jest', 'src/broken.test.ts', null, 26, "Cannot find module './missing' from 'src/broken.test.ts'"],
    ]);
    expect(totals).toEqual({ failed: 2, total: 12 });
  });

  it('lists a Jest file with no test under it (the output was cut short) as the file', () => {
    expect(brief('FAIL src/pay.test.ts\nnpm ERR! Test failed.')).toEqual([['src/pay.test.ts', 1, '']]);
  });

  it('reads Vitest', () => {
    const text = ` FAIL  src/pay.test.ts > PaymentService > refunds twice
AssertionError: expected 2 to be 1`;
    expect(report(text).failed.map((t) => [t.runner, t.name, t.where])).toEqual([
      ['vitest', 'PaymentService › refunds twice', 'src/pay.test.ts'],
    ]);
  });

  it('reads Maven surefire: each test once, with the message and the totals', () => {
    const { failed, totals } = report(MAVEN);
    expect(failed.map((t) => [t.runner, t.name, t.line, t.reason])).toEqual([
      ['maven', 'PayTest.refund', 8, 'AssertionFailedError: expected: <1> but was: <2>'],
      ['maven', 'PayTest.charge', 13, 'NullPointerException: Cannot invoke "Payment.amount()" because "p" is null'],
    ]);
    expect(totals).toEqual({ failed: 2, total: 12 });
  });

  it('reads the Maven results section on its own', () => {
    const text = `[ERROR] Failures:
[ERROR]   PayTest.refund:42 expected:<1> but was:<2>
[ERROR]   PayTest.currency:61->assertRate:12 rate
[ERROR] Errors:
[ERROR]   PayTest.charge:17 » NullPointer
[INFO]
[ERROR] Tests run: 12, Failures: 2, Errors: 1, Skipped: 0`;
    expect(brief(text)).toEqual([
      ['PayTest.refund', 2, 'expected:<1> but was:<2>'],
      ['PayTest.currency', 3, 'rate'],
      ['PayTest.charge', 5, 'NullPointer'],
    ]);
    expect(report(text).totals).toEqual({ failed: 3, total: 12 });
  });

  it('reads Gradle, nested classes too', () => {
    const { failed, totals } = report(GRADLE);
    expect(failed.map((t) => [t.runner, t.name, t.line, t.reason])).toEqual([
      ['gradle', 'PayTest > refund()', 4, 'AssertionFailedError: expected: <1> but was: <2>'],
      ['gradle', 'PayTest > Currency > converts euros()', 8, 'ArithmeticException at PayTest.java:61'],
    ]);
    expect(totals).toEqual({ failed: 2, total: 12 });
  });

  it('reads RSpec: the failures with expected and got, the rerun lines for the file', () => {
    const { failed, totals } = report(RSPEC);
    expect(failed.map((t) => [t.runner, t.name, t.where, t.line, t.reason])).toEqual([
      ['rspec', 'Pay refunds twice', 'spec/pay_spec.rb:12', 6, 'expected: 1 got: 2'],
      ['rspec', 'Pay converts euros', 'spec/pay_spec.rb:19', 15, "NoMethodError: undefined method `rate' for nil"],
    ]);
    expect(totals).toEqual({ failed: 2, total: 7 });
  });

  it('lists the tests of several runners in one log in the order they failed', () => {
    const text = `${GO}\n${PYTEST}`;
    const { failed } = report(text);
    expect(failed.map((t) => t.name)).toEqual([
      'TestCharge/zero',
      'TestCurrency',
      'test_admin_login',
      'test_refund',
      'TestPay::test_currency[eur]',
    ]);
    expect(failed[2].line).toBe(GO.split('\n').length + 11);
  });

  it('reads lines with GitHub Actions timestamps, ANSI colours and pod prefixes', () => {
    const stamped = (text: string) =>
      text
        .split('\n')
        .map((line, i) => `2026-10-04T10:00:${String(i % 60).padStart(2, '0')}.1234567Z ${line}`)
        .join('\n');
    expect(report(stamped(GO)).failed.map((t) => [t.name, t.where, t.reason])).toEqual(
      report(GO).failed.map((t) => [t.name, t.where, t.reason]),
    );
    expect(report(stamped(MAVEN)).failed.map((t) => t.name)).toEqual(['PayTest.refund', 'PayTest.charge']);

    const coloured = '\x1b[31mFAILED\x1b[0m tests/test_pay.py::test_refund - \x1b[1mAssertionError: assert 0 == 100\x1b[0m';
    expect(brief(coloured)).toEqual([['test_refund', 1, 'AssertionError: assert 0 == 100']]);
    const jest =
      '\x1b[0m\x1b[7m\x1b[1m\x1b[31m FAIL \x1b[39m\x1b[22m\x1b[27m\x1b[0m src/pay.test.ts\n  \x1b[1m● PaymentService › refunds twice\x1b[22m';
    expect(brief(jest)).toEqual([['PaymentService › refunds twice', 2, '']]);

    const pods = `[pod/ci-runner-7d9f8-x2k4p/test] --- FAIL: TestCharge (0.02s)
[pod/ci-runner-7d9f8-x2k4p/test]     charge_test.go:31: expected an error
tests-1  | FAILED tests/test_pay.py::test_refund - AssertionError
[2026-10-04T10:00:00.123Z] com.acme.PayTest > refund() FAILED
[2026-10-04T10:00:00.124Z]     java.lang.AssertionError at PayTest.java:42`;
    expect(brief(pods)).toEqual([
      ['TestCharge', 1, 'expected an error'],
      ['test_refund', 3, 'AssertionError'],
      ['PayTest > refund()', 4, 'AssertionError at PayTest.java:42'],
    ]);
  });

  it('finds no tests in app logs that say FAILED or FAIL in prose', () => {
    const text = `2026-10-04T10:00:00Z ERROR payment FAILED for order 1234 - card declined
2026-10-04T10:00:01Z WARN retry 2/3: upload FAILED (timeout)
2026-10-04T10:00:02Z INFO Health check > db FAILED
Deploy > production FAILED
> Task :app:test FAILED
FAIL
FAIL	github.com/acme/shop/pay	0.031s
FAILED: some job
ERROR app::db - connection reset
--- FAIL: something went wrong
Failures:
  1) the disk is full
  2) the network is down
===== FAILURES =====
____ not a test ____
Tests run: abc`;
    expect(report(text)).toEqual({ failed: [], totals: null });
  });

  it('finds nothing in an empty log or a log of passing tests', () => {
    expect(report('')).toEqual({ failed: [], totals: null });
    const passing = `PASS src/pay.test.ts
Tests:       12 passed, 12 total
--- PASS: TestCharge (0.02s)
ok  	github.com/acme/shop/pay	0.031s
[INFO] Tests run: 12, Failures: 0, Errors: 0, Skipped: 0
========================= 12 passed in 0.10s ==========================`;
    expect(report(passing)).toEqual({ failed: [], totals: null });
  });

  it('reads a 100k line CI log quickly', () => {
    const chunk = `${GO}\n${PYTEST}\n${JEST}\n${MAVEN}\n${GRADLE}\n${RSPEC}\n`;
    const filler = Array.from({ length: 1000 }, (_, i) => `2026-10-04T10:00:00Z INFO step ${i} ok`).join('\n');
    const lines = parseLog(`${filler}\n`.repeat(100) + chunk);
    expect(lines.length).toBeGreaterThan(100_000);
    const started = performance.now();
    const { failed } = findFailedTests(lines);
    expect(performance.now() - started).toBeLessThan(500);
    expect(failed.length).toBe(14);
  });
});
