// End-to-end test: loads the built extension into Chromium, drives the log viewer, the text
// tools and the popup like a user would, checks the results, and saves screenshots to docs/.
// Exits with code 1 if any check fails. Needs a Chromium for Playwright (`npx playwright install chromium`).
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dist = path.resolve('dist');
const sample = readFileSync('docs/sample.log', 'utf8');
const BIG_LINES = 150_000;
const bigLog = Array.from(
  { length: BIG_LINES },
  (_, i) =>
    `2026-09-29 10:${String(Math.floor(i / 6000) % 60).padStart(2, '0')}:00.000 ${i % 97 === 0 ? 'ERROR' : 'INFO'} worker-${i % 8} processed job ${i}`,
).join('\n');

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
}

const redosLog = Array.from({ length: 50 }, () => `${'a'.repeat(34)}b`).join('\n');
const pemLog = [
  '2026-09-29 10:00:00 DEBUG loaded signing key:',
  '-----BEGIN EC PRIVATE KEY-----',
  'MHcCAQEEIFakeKeyBodyLineOneAAAAAAAAAAAAAAAAAAAAAAAA',
  'oAoGCCqGSM49AwEHoUQDQgAEFakeKeyBodyLineTwoBBBBBBBB==',
  '-----END EC PRIVATE KEY-----',
  '2026-09-29 10:00:01 INFO started',
].join('\n');
const prettyLog = [
  '2026-10-04 10:00:00 INFO started',
  '{',
  '  "@timestamp": "2026-10-04T10:00:05.000Z",',
  '  "level": "error",',
  '  "message": "payment failed",',
  '  "order": { "id": 7781, "amount": 12.5 }',
  '}',
  '2026-10-04 10:00:06 INFO next',
].join('\n');
const fieldsLog = [
  '{"time":"2026-10-04T10:00:00Z","level":"info","service":"payments","duration":120,"msg":"charged order 7781"}',
  '{"time":"2026-10-04T10:00:10Z","level":"error","service":"payments","duration":950,"msg":"upstream timeout for order 7781"}',
  '{"time":"2026-10-04T10:05:00Z","level":"error","service":"search","duration":40,"msg":"index missing"}',
  '2026-10-04T10:10:00Z WARN slow request service=payments duration=1.2s userId=42',
  '2026-10-04T10:20:00Z ERROR failed service=payments duration=30ms userId=42',
  '\tat com.example.Pay.charge(Pay.java:42)',
  '2026-10-04T10:30:00Z INFO done service=search duration=5ms',
].join('\n');
const podsLog = [
  '[pod/payments-7d9f8-x2k4p/app] 2026-10-04 10:00:00 INFO started',
  '[pod/payments-7d9f8-q9z1m/app] 2026-10-04 10:00:01 INFO started',
  '[pod/payments-7d9f8-x2k4p/app] 2026-10-04 10:00:02 ERROR connection refused',
  '[pod/payments-7d9f8-q9z1m/app] 2026-10-04 10:00:03 INFO ok',
].join('\n');
const plainPages = {
  '/redos.log': redosLog,
  '/pem.log': pemLog,
  '/pretty.log': prettyLog,
  '/fields.log': fieldsLog,
  '/pods.log': podsLog,
};
const htmlPages = {
  '/light': '<!doctype html><body style="background:#fff;color:#111"><p>Light page</p></body>',
  '/dark': '<!doctype html><body style="background:#0d1117;color:#e6edf3"><p>Already dark</p></body>',
  '/editors': `<!doctype html><body>
    <div id="ce" contenteditable="true">{"a":1,"b":[1,2]}</div>
    <script>window.pageEscapes = 0; document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.pageEscapes++; });</script>
  </body>`,
};

// a log that is still being written, for Follow
const growing = ['2026-10-04T10:00:00Z INFO job started', '2026-10-04T10:00:01Z INFO step 1'];
const server = createServer((req, res) => {
  const path = req.url.split('#')[0];
  if (path === '/growing.log') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(growing.join('\n') + '\n');
    return;
  }
  if (plainPages[path] !== undefined) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(plainPages[path]);
    return;
  }
  if (htmlPages[path] !== undefined) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(htmlPages[path]);
    return;
  }
  const url = req.url.split('#')[0];
  if (url === '/csp-big.log') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Security-Policy': "worker-src 'none'" });
    res.end(bigLog);
    return;
  }
  if (url === '/app.log' || url === '/big.log') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(url === '/app.log' ? sample : bigLog);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><title>Editor</title><body style="font:16px system-ui;padding:40px;background:#f6f8fa">
    <h2>Deploy config</h2>
    <textarea id="t" style="width:560px;height:90px;font:14px monospace">{"service":"payments","replicas":3,"env":{"LOG_LEVEL":"info"}}</textarea>
    <p>Token: <code id="jwt">eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhbm5hIiwicm9sZXMiOlsiUk9MRV9VU0VSIl0sImlhdCI6MTcwMDAwMDAwMCwiZXhwIjoxNzAwMDAzNjAwfQ.c2lnbmF0dXJl</code></p>
    <textarea id="cfg" style="width:560px;height:60px;font:14px monospace">spring.datasource.password=Sup3rS3cretPass
aws.key=AKIAIOSFODNN7EXAMPLE</textarea></body>`);
});
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://localhost:${server.address().port}`;

const context = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'logbeam-')), {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 800 },
  // a time zone other than UTC, so "Local time" visibly changes the times
  timezoneId: 'Europe/Kyiv',
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
const errors = [];
const watch = (page) => page.on('pageerror', (e) => errors.push(e.message));

let [worker] = context.serviceWorkers();
worker ??= await context.waitForEvent('serviceworker');
const extensionId = new URL(worker.url()).host;
check('extension loads', Boolean(extensionId), extensionId);

// ---- log viewer ---------------------------------------------------------------------------
const page = await context.newPage();
watch(page);
await page.goto(`${base}/app.log`);
await page.addScriptTag({ path: path.join(dist, 'logViewer.js') });
await page.waitForSelector('.row');
const status = () => page.locator('.status').textContent();
check('viewer shows every line', (await status()) === '65 / 65 lines', await status());
check('timeline is drawn', (await page.locator('.bucket').count()) === 80);
check('secrets are counted', (await page.locator('.toggle.secrets').textContent()) === '🔑 2');
check('secret values are highlighted', (await page.locator('.secret').count()) >= 1);
await page.screenshot({ path: 'docs/log-viewer.png' });

await page.locator('.chip.lvl-INFO').click();
await page.locator('.chip.lvl-DEBUG').click();
await page.locator('.toggle', { hasText: 'Collapse' }).click();
check('level filter + collapse', (await status()) === '13 / 65 lines', await status());
await page.screenshot({ path: 'docs/log-viewer-filtered.png' });

await page.locator('.search').fill('Connection|refused');
await page.locator('.toggle', { hasText: '.*' }).click();
await page.waitForTimeout(300);
check('regex search', (await status()) === '2 / 65 lines', await status());
check('matches highlighted', (await page.locator('.match').count()) === 3);
await page.locator('.search').fill('');
await page.locator('.toggle', { hasText: '.*' }).click();
await page.locator('.chip.lvl-INFO').click();
await page.locator('.chip.lvl-DEBUG').click();
await page.locator('.toggle', { hasText: 'Collapse' }).click();
await page.waitForTimeout(300);

await page.keyboard.press('e');
check('next error opens the inspector', await page.locator('.inspector').isVisible());
check('inspector shows the error line', (await page.locator('.facts').textContent()).includes('ERROR'));
check('selection is in the address', /#L\d+$/.test(page.url()), page.url());

await page.keyboard.press('s');
check('next secret selects a secret line', (await page.locator('.facts').textContent()).includes('contains a secret'));
await page.locator('.toggle', { hasText: 'Mask' }).click();
const inspected = await page.locator('.full-text').textContent();
check(
  'mask hides the secret value',
  !inspected.includes('Sup3rS3cretPass') && !inspected.includes('IOSFODNN7EXAMPLE'),
  inspected.slice(-70),
);
await page.screenshot({ path: 'docs/secrets.png' });

// JSON record in the inspector
const jsonRow = page.locator('.row', { hasText: 'payment webhook signature mismatch' });
await jsonRow.locator('.txt').click();
check('JSON records show their fields', (await page.locator('.inspector .json').textContent()).includes('"requestId"'));
await page.keyboard.press('Escape');
check('Esc closes the inspector', await page.locator('.inspector').isHidden());

// ---- link to a line -----------------------------------------------------------------------
const linked = await context.newPage();
watch(linked);
await linked.goto(`${base}/app.log#L13`);
await linked.addScriptTag({ path: path.join(dist, 'logViewer.js') });
await linked.waitForSelector('.row.selected');
check('#L13 opens on line 13', (await linked.locator('.row.selected .ln').textContent()) === '13');
await linked.close();

// ---- big log in the Web Worker ----------------------------------------------------------
const big = await context.newPage();
watch(big);
await big.goto(`${base}/big.log`);
const started = Date.now();
await big.addScriptTag({ path: path.join(dist, 'logViewer.js') });
await big.waitForSelector('.row', { timeout: 60_000 });
check(
  `${BIG_LINES.toLocaleString('en')} lines parse`,
  (await big.locator('.status').textContent()) === `${BIG_LINES.toLocaleString()} / ${BIG_LINES.toLocaleString()} lines`,
  `${Date.now() - started} ms`,
);
check('big log parsed in a Web Worker', (await big.evaluate(() => document.documentElement.dataset.logbeamParser)) === 'worker');
check('only visible rows are in the DOM', (await big.locator('.row').count()) < 200);
await big.keyboard.press('e');
check('next error works on the big log', (await big.locator('.facts').textContent()).includes('ERROR'));
await big.close();

const strict = await context.newPage();
watch(strict);
await strict.goto(`${base}/csp-big.log`);
// evaluate() instead of addScriptTag(): the latter reports the CSP violation itself, although the viewer catches it
await strict.evaluate(readFileSync(path.join(dist, 'logViewer.js'), 'utf8'));
await strict.waitForSelector('.row', { timeout: 60_000 });
check(
  'CSP without workers falls back to chunked parsing',
  (await strict.evaluate(() => document.documentElement.dataset.logbeamParser)) === 'chunks',
);
check(
  'fallback parses everything',
  (await strict.locator('.status').textContent()) === `${BIG_LINES.toLocaleString()} / ${BIG_LINES.toLocaleString()} lines`,
);
await strict.close();

// ---- regex searches can't freeze the tab --------------------------------------------------
const redos = await context.newPage();
watch(redos);
await redos.goto(`${base}/redos.log`);
await redos.addScriptTag({ path: path.join(dist, 'logViewer.js') });
await redos.waitForSelector('.row');
await redos.locator('.toggle', { hasText: '.*' }).click();
await redos.locator('.search').fill('(a+)+$');
await redos.waitForTimeout(400);
check('nested quantifiers are refused at once', (await redos.locator('.status').textContent()).includes('Nested quantifiers'));
await redos.locator('.search').fill('(a|aa)+$');
const slowStarted = Date.now();
await redos.waitForFunction(() => document.querySelector('.status').textContent.includes('took over'), null, {
  timeout: 10_000,
});
check('a catastrophic regex is stopped by the worker timeout', true, `${Date.now() - slowStarted} ms`);
const pingStarted = Date.now();
await redos.evaluate(() => 1 + 1);
check('the tab stays responsive', Date.now() - pingStarted < 500, `${Date.now() - pingStarted} ms`);
await redos.locator('.search').fill('a{3}b');
await redos.waitForTimeout(500);
check('normal regex search still works after a stopped one', (await redos.locator('.status').textContent()) === '50 / 50 lines');
await redos.close();

// ---- private keys are masked as a whole ----------------------------------------------------
const pem = await context.newPage();
watch(pem);
await pem.goto(`${base}/pem.log`);
await pem.addScriptTag({ path: path.join(dist, 'logViewer.js') });
await pem.waitForSelector('.row');
check('the key header and every body line are flagged', (await pem.locator('.row.has-secret').count()) === 3);
await pem.locator('.toggle', { hasText: 'Mask' }).click();
const pemText = await pem.locator('.rows').textContent();
check('Mask hides the whole key body', !pemText.includes('FakeKeyBody'), pemText.slice(0, 120));
await pem.close();

// ---- dark mode leaves already-dark pages alone ----------------------------------------------
const darkCss = readFileSync(path.join(dist, 'dark.css'), 'utf8');
for (const [page, expected] of [
  ['/light', 'on'],
  ['/dark', 'native-dark'],
]) {
  const tab = await context.newPage();
  watch(tab);
  await tab.goto(`${base}${page}`);
  await tab.addStyleTag({ content: darkCss });
  await tab.addScriptTag({ path: path.join(dist, 'darkApi.js') });
  const state = await tab.evaluate(() => window.__logbeamDark.set(true));
  const filtered = await tab.evaluate(() => getComputedStyle(document.documentElement).filter !== 'none');
  check(`dark mode on ${page}: ${expected}`, state === expected && filtered === (expected === 'on'), `${state}`);
  const off = await tab.evaluate(() => window.__logbeamDark.set(false));
  check(
    `dark mode turns off on ${page} without a reload`,
    off === 'off' && (await tab.evaluate(() => getComputedStyle(document.documentElement).filter)) === 'none',
  );
  await tab.close();
}

// ---- panel: editors without a selection, Esc stays in the panel -----------------------------
const editors = await context.newPage();
watch(editors);
await editors.goto(`${base}/editors`);
await editors.addScriptTag({ path: path.join(dist, 'panel.js') });
await editors.locator('#ce').click();
await editors.evaluate(() => {
  const sel = getSelection();
  sel.collapse(document.getElementById('ce').firstChild, 0);
});
await editors.evaluate(() => window.__logbeamPanel.run('json-format'));
await editors.waitForSelector('logbeam-panel .panel');
check(
  'contenteditable without a selection uses all its text',
  (await editors.locator('logbeam-panel pre').textContent()).includes('"b": ['),
);
await editors.keyboard.press('Escape');
check('Esc closes the panel', (await editors.locator('logbeam-panel').count()) === 0);
check("Esc doesn't reach the page", (await editors.evaluate(() => window.pageEscapes)) === 0);
await editors.close();

// ---- text tools ---------------------------------------------------------------------------
const editor = await context.newPage();
watch(editor);
await editor.goto(`${base}/editor`);
await editor.addScriptTag({ path: path.join(dist, 'panel.js') });
await editor.locator('#t').click();
await editor.evaluate(() => window.__logbeamPanel.run('json-format'));
await editor.waitForSelector('logbeam-panel .panel');
await editor.screenshot({ path: 'docs/text-tools.png' });
await editor.locator('logbeam-panel button', { hasText: 'Replace selection' }).click();
check('Replace selection formats JSON in place', (await editor.locator('#t').inputValue()).includes('\n  "replicas": 3'));

await editor.locator('#cfg').click();
await editor.evaluate(() => window.__logbeamPanel.run('mask-secrets'));
await editor.locator('logbeam-panel button', { hasText: 'Replace selection' }).click();
const cfg = await editor.locator('#cfg').inputValue();
check('Mask secrets in a textarea', !cfg.includes('Sup3rS3cretPass') && cfg.includes('AKIA****'), cfg.replace('\n', ' | '));

await editor.evaluate(() => {
  const range = document.createRange();
  range.selectNodeContents(document.getElementById('jwt'));
  getSelection().removeAllRanges();
  getSelection().addRange(range);
  document.activeElement?.blur();
});
await editor.evaluate(() => window.__logbeamPanel.run('jwt-decode'));
check('JWT decoded from a page selection', (await editor.locator('logbeam-panel pre').textContent()).includes('"sub": "anna"'));
await editor.screenshot({ path: 'docs/jwt.png' });

// ---- popup ------------------------------------------------------------------------------
let popup = await context.newPage();
watch(popup);
await popup.setViewportSize({ width: 380, height: 700 });
await popup.goto(`chrome-extension://${extensionId}/popup.html`);
await popup.locator('#input').fill('0 */15 * * * *');
await popup.locator('button', { hasText: 'Explain cron' }).click();
check('popup explains cron', (await popup.locator('#output').textContent()) === 'Every 15 minutes');
await popup.screenshot({ path: 'docs/popup.png', fullPage: true });

// ---- multi-line JSON records ----------------------------------------------------------------
const pretty = await context.newPage();
watch(pretty);
await pretty.goto(`${base}/pretty.log`);
await pretty.addScriptTag({ path: path.join(dist, 'logViewer.js') });
await pretty.waitForSelector('.row');
// the chips count lines, like the lines of a stack trace
check('every line of the record takes its level', (await pretty.locator('.chip.lvl-ERROR .count').textContent()) === '6');
await pretty.locator('.chip.lvl-INFO').click();
check(
  'filtering keeps the whole record',
  (await pretty.locator('.status').textContent()) === '6 / 8 lines',
  await pretty.locator('.status').textContent(),
);
await pretty.locator('.row', { hasText: 'error payment failed' }).locator('.txt').click();
check(
  'the record’s fields are in the inspector',
  (await pretty.locator('.inspector .json').textContent()).includes('"amount": 12.5'),
);
check('Compare is hidden outside the extension', await pretty.locator('.toggle', { hasText: 'Compare' }).isHidden());
await pretty.close();

// ---- field filters, highlights, time range, export, files ------------------------------------
const logs = await context.newPage();
watch(logs);
await logs.goto(`${base}/fields.log`);
await logs.addScriptTag({ path: path.join(dist, 'logViewer.js') });
await logs.waitForSelector('.row');
const logStatus = () => logs.locator('.status').textContent();
await logs.locator('.search').fill('level=error service=payments');
await logs.waitForFunction(() => document.querySelector('.status').textContent.includes('field'));
check(
  'fields filter JSON and key=value lines alike',
  (await logStatus()) === '3 / 7 lines · 2 field conditions',
  await logStatus(),
);
await logs.locator('.search').fill('duration>500');
await logs.waitForFunction(() => document.querySelector('.status').textContent.startsWith('2 /'));
check('numeric comparisons understand units (1.2s > 500)', true, await logStatus());
await logs.locator('.search').fill('');

await logs.locator('.search').fill('7781');
await logs.locator('.search').press('Enter');
await logs.locator('.search').fill('userId=42');
await logs.locator('.search').press('Enter');
check(
  'two highlights in their own colours',
  (await logs.locator('.hl-0').count()) === 2 + 1 && (await logs.locator('.txt .hl-1').count()) === 2,
);
check('highlights are listed as chips', (await logs.locator('.hl-chip').allTextContents()).join(',') === '7781 ×,userId=42 ×');
await logs.screenshot({ path: 'docs/highlights.png' });
await logs.locator('.hl-chip').first().click();
check('a highlight chip removes it', (await logs.locator('.hl-chip').count()) === 1);

const buckets = logs.locator('.bucket');
const firstBox = await buckets.nth(0).boundingBox();
const middleBox = await buckets.nth(30).boundingBox();
await logs.mouse.move(firstBox.x + 1, firstBox.y + 10);
await logs.mouse.down();
await logs.mouse.move(middleBox.x + 1, middleBox.y + 10, { steps: 8 });
await logs.mouse.up();
await logs.waitForSelector('.range:not([hidden])');
check(
  'dragging across the timeline keeps that time range',
  (await logStatus()).startsWith('4 /') && (await logs.locator('.range').textContent()).startsWith('⏱ 10:00:00'),
  `${await logStatus()} ${await logs.locator('.range').textContent()}`,
);
await logs.locator('.range').click();
check('the range chip shows everything again', (await logStatus()).startsWith('7 /'), await logStatus());

const download = logs.waitForEvent('download');
await logs.locator('.chip.lvl-INFO').click();
await logs.locator('.toggle', { hasText: 'Save' }).click();
const saved = await download;
const savedText = readFileSync(await saved.path(), 'utf8');
check(
  'Save downloads the visible lines',
  saved.suggestedFilename() === 'fields.filtered.log' && savedText.trim().split('\n').length === 5,
  `${saved.suggestedFilename()}: ${savedText.trim().split('\n').length} lines`,
);

// drop a gzipped log onto the viewer
const gz = gzipSync('2026-10-04 10:00:00 INFO from a gzip file\n2026-10-04 10:00:01 ERROR it works\n').toString('base64');
await logs.evaluate((data) => {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const transfer = new DataTransfer();
  transfer.items.add(new File([bytes], 'app.log.gz'));
  document.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
}, gz);
await logs.waitForFunction(() => document.title.startsWith('app.log'));
await logs.waitForSelector('.row');
check(
  'a dropped .gz file is unpacked and opened',
  (await logStatus()) === '2 / 2 lines',
  `${await logs.title()}: ${await logStatus()}`,
);
await logs.close();

// ---- bookmarks, field statistics, error groups, table, time zone -----------------------------
const insights = await context.newPage();
watch(insights);
await insights.goto(`${base}/fields.log`);
await insights.addScriptTag({ path: path.join(dist, 'logViewer.js') });
await insights.waitForSelector('.row');
await insights.evaluate(() => {
  // keep what Report copies (the clipboard isn't readable in a headless test)
  navigator.clipboard.writeText = async (text) => void (window.__copied = text);
});
const insightStatus = () => insights.locator('.status').textContent();

await insights.locator('.row[data-number="2"] .txt').click();
await insights.keyboard.press('m');
await insights.locator('.inspector .note').fill('the timeout starts here');
await insights.locator('.row[data-number="5"] .txt').click();
await insights.locator('.inspector button', { hasText: 'Bookmark' }).click();
check('bookmarks are counted', (await insights.locator('.bookmarks').textContent()) === '★ 2');
check('bookmarked rows are marked', (await insights.locator('.row.bookmarked').count()) === 2);
await insights.locator('.toggle', { hasText: 'Report' }).click();
const report = await insights.evaluate(() => window.__copied);
check(
  'Report copies the bookmarks with times and notes',
  report.startsWith('### fields') &&
    report.includes('#L2)** · 2026-10-04 10:00:10.000Z — the timeout starts here') &&
    report.includes('#L5)'),
  report.split('\n')[2],
);

await insights.locator('.inspector .field', { hasText: 'service' }).click();
const stats = await insights.locator('.inspector .stat').allTextContents();
check('field statistics list the top values', stats.join(' | ') === 'payments×4 | search×2', stats.join(' | '));
await insights.locator('.inspector .stat').first().click();
check('a value filters by it', (await insights.locator('.search').inputValue()) === 'service=payments');
await insights.locator('.search').fill('');
await insights.keyboard.press('Escape');

await insights.locator('.toggle', { hasText: 'Groups' }).click();
const groupItems = await insights.locator('.group-item .n').allTextContents();
check('errors are grouped', groupItems.join(',') === '×1,×1,×1', groupItems.join(','));
await insights.locator('.group-item').nth(2).click();
await insights.waitForSelector('.group-chip:not([hidden])');
check('a group shows only its error and stack trace', (await insightStatus()).startsWith('2 /'), await insightStatus());
await insights.locator('.group-chip').click();
await insights.locator('.toggle', { hasText: 'Groups' }).click();

await insights.locator('.toggle', { hasText: 'Table' }).click();
check(
  'the table picks time, level, service and message',
  (await insights.locator('.columns').inputValue()) === 'time, level, service, msg',
);
check('JSON records become table rows', (await insights.locator('.row[data-number="1"] .cell').count()) === 4);
await insights.screenshot({ path: 'docs/table.png' });
await insights.locator('.toggle', { hasText: 'Table' }).click();

await insights.locator('.toggle', { hasText: 'UTC' }).click();
const firstRow = await insights.locator('.row[data-number="4"] .txt').textContent();
check('Local time shows timestamps in the browser’s zone', firstRow.startsWith('2026-10-04 13:10:00.000+03:00 WARN'), firstRow);
await insights.locator('.toggle', { hasText: 'Local time' }).click();
await insights.close();

// ---- Follow -------------------------------------------------------------------------------
const tail = await context.newPage();
watch(tail);
await tail.goto(`${base}/growing.log`);
await tail.addScriptTag({ path: path.join(dist, 'logViewer.js') });
await tail.waitForSelector('.row');
await tail.locator('.toggle', { hasText: 'Follow' }).click();
growing.push('2026-10-04T10:00:05Z ERROR step 2 failed', '\tat Job.run(Job.java:7)', '2026-10-04T10:00:06Z INFO retrying');
await tail.waitForFunction(() => document.querySelector('.status').textContent.startsWith('5 /'), null, { timeout: 10_000 });
check('Follow adds new lines as they are written', true, await tail.locator('.status').textContent());
check('their levels and stack traces are read', (await tail.locator('.chip.lvl-ERROR .count').textContent()) === '2');
growing.splice(0, growing.length, 'a different log');
await tail.waitForTimeout(3500);
check(
  'Follow stops when the log is replaced',
  !(await tail.locator('.toggle', { hasText: 'Follow' }).getAttribute('class')).includes(' on'),
);
await tail.close();

// ---- pods ---------------------------------------------------------------------------------
const pods = await context.newPage();
watch(pods);
await pods.goto(`${base}/pods.log`);
await pods.addScriptTag({ path: path.join(dist, 'logViewer.js') });
await pods.waitForSelector('.row');
const podChips = await pods.locator('.sources .chip').allTextContents();
check('each pod gets a chip', podChips.join(',') === 'payments-7d9f8-x2k4p/app,payments-7d9f8-q9z1m/app', podChips.join(','));
check('a pod prefix is coloured', (await pods.locator('.txt .src.src-1').count()) === 2);
check('levels are read after the prefix', (await pods.locator('.chip.lvl-ERROR .count').textContent()) === '1');
await pods.locator('.sources .chip').nth(1).click();
check('a pod chip hides its lines', (await pods.locator('.status').textContent()) === '2 / 4 lines');
await pods.screenshot({ path: 'docs/pods.png' });
await pods.close();

// ---- settings, pasted text ----------------------------------------------------------------
const options = await context.newPage();
watch(options);
await options.goto(`chrome-extension://${extensionId}/options.html`);
await options.locator('#gap').fill('5');
await options.locator('#add-pattern').click();
await options.locator('.pattern input').nth(0).fill('Acme token');
await options.locator('.pattern input').nth(1).fill('acme_[a-z0-9]{8}');
await options.locator('#test').fill('key acme_12ab34cd used');
check(
  'settings test a custom secret pattern',
  (await options.locator('#test-result').textContent()) === 'key ********  used'.replace('  ', ' '),
);
await options.locator('#add-pattern').click();
await options.locator('.pattern input').nth(3).fill('(a+)+$');
check('a risky pattern is refused', (await options.locator('#problems').textContent()).includes('Nested quantifiers'));
await options.locator('.pattern button').nth(1).click();
await options.locator('.tools label', { hasText: 'Sort lines' }).locator('input').uncheck();
await options.waitForTimeout(600);
const stored = await options.evaluate(() => chrome.storage.sync.get('settings'));
check(
  'settings are saved',
  stored.settings.gapThresholdMs === 5000 &&
    stored.settings.customSecrets.length === 1 &&
    stored.settings.hiddenTools.includes('sort-lines'),
  JSON.stringify(stored.settings),
);
await options.screenshot({ path: 'docs/settings.png', fullPage: true });

// "Open text as log" in the popup: the viewer on the extension's own page
const pastedPage = context.waitForEvent('page');
await popup.bringToFront();
await popup
  .locator('#input')
  .fill(`${fieldsLog}\n2026-10-04T10:31:00Z INFO token acme_12ab34cd\n2026-10-04T10:40:00Z INFO later`);
await popup.locator('#open-pasted').click();
const pasted = await pastedPage;
watch(pasted);
await pasted.waitForSelector('.row');
check(
  'pasted text opens in the viewer',
  (await pasted.locator('.status').textContent()) === '9 / 9 lines',
  await pasted.locator('.status').textContent(),
);
check('the custom secret pattern is used', (await pasted.locator('.toggle.secrets').textContent()) === '🔑 1');
check(
  'the pause threshold comes from the settings',
  (await pasted.locator('.toggle', { hasText: 'Gaps' }).getAttribute('title')).includes('5s'),
);
check('no Raw button on the extension page', await pasted.locator('.toggle', { hasText: 'Raw' }).isHidden());
await pasted.locator('.toggle', { hasText: '.*' }).click();
await pasted.locator('.search').fill('timeout|missing');
await pasted.waitForFunction(() => document.querySelector('.status').textContent.startsWith('2 /'));
check('regex search runs in a worker on the extension page too', true, await pasted.locator('.status').textContent());
await pasted.close();
// the popup closes itself after opening the viewer
popup = await context.newPage();
watch(popup);
await popup.goto(`chrome-extension://${extensionId}/popup.html`);

// ---- compare ----------------------------------------------------------------------------
const runLog = (stamp, result) =>
  [
    `${stamp}:01.123Z Checking out 9f8e7d6c5b4a3f2e1d0c`,
    `${stamp}:05.456Z Installing dependencies took 3.2s`,
    `${stamp}:20.000Z Tests: ${result}`,
    `${stamp}:21.000Z Done`,
  ].join('\n');
const passing = runLog('2026-10-03T09:00', '120 passed');
const failing = runLog('2026-10-04T11:30', '119 passed, 1 failed').replace('9f8e7d6c5b4a3f2e1d0c', '0a1b2c3d4e5f60718293');

// what the log viewer's Compare button sends to the background
const send = (text, name) =>
  popup.evaluate(([text, name]) => chrome.runtime.sendMessage({ type: 'logbeam:compare-add', text, name }), [text, name]);
const badge = () => popup.evaluate(() => chrome.action.getBadgeText({}));
check('first log goes to Before', (await send(passing, 'run #41')) === 'left');
check('the icon shows a text is waiting', (await badge()) === '1');
const comparePage = context.waitForEvent('page');
check('second log goes to After', (await send(failing, 'run #42')) === 'right');
const compare = await comparePage;
watch(compare);
await compare.waitForSelector('#summary:not([hidden])');
check('Compare opens with both logs', compare.url().endsWith('/diff.html'), compare.url());
check('the waiting badge is cleared', (await badge()) === '');
const summary = () => compare.locator('#summary').textContent();
check('every line differs before ignoring timestamps', (await summary()).includes('+4 −4'), await summary());
await compare.locator('#ignore-volatile').check();
await compare.waitForFunction(() => document.querySelector('#summary').textContent.includes('+1 −1'));
check('only the test result differs after ignoring timestamps, IDs and durations', true, await summary());
const marked = (await compare.locator('.line.add mark').allTextContents()).join(' | ');
check('only the changed words are marked', marked === '119 | , 1 failed', marked);
check('the log names are shown', (await summary()).includes('run #41 → run #42'));
await compare.setViewportSize({ width: 1280, height: 800 });
await compare.screenshot({ path: 'docs/compare.png' });

await compare.locator('#clear').click();
await compare.locator('#left').fill('{"service":"payments","replicas":3,"env":{"LOG_LEVEL":"info"},"id":12345678901234567890}');
await compare.locator('#right').fill('{"env":{"LOG_LEVEL":"debug"},"id":12345678901234567891,"service":"payments","replicas":3}');
await compare.waitForSelector('#changes:not([hidden]) tr');
const paths = await compare.locator('#changes .path').allTextContents();
check('JSON is compared by key, not by order', paths.join(',') === '$.env.LOG_LEVEL,$.id', paths.join(','));
check(
  'big numbers are compared exactly',
  (await compare.locator('#changes .after').last().textContent()) === '12345678901234567891',
);

// a tab's own badge, once cleared, falls back to the global one (used while a compare waits)
const fallback = await popup.evaluate(async () => {
  const [tab] = await chrome.tabs.query({});
  await chrome.action.setBadgeText({ text: 'G' });
  await chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
  await chrome.action.setBadgeText({ tabId: tab.id, text: null });
  const text = await chrome.action.getBadgeText({ tabId: tab.id });
  await chrome.action.setBadgeText({ text: '' });
  return text;
});
check('clearing a tab badge shows the global one again', fallback === 'G', fallback);

// ---- Ukrainian --------------------------------------------------------------------------------
const ukContext = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'logbeam-uk-')), {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, '--lang=uk'],
});
let [ukWorker] = ukContext.serviceWorkers();
ukWorker ??= await ukContext.waitForEvent('serviceworker');
const ukPopup = await ukContext.newPage();
await ukPopup.goto(`chrome-extension://${new URL(ukWorker.url()).host}/popup.html`);
await ukPopup.waitForSelector('#transforms button');
check(
  'the popup speaks Ukrainian',
  (await ukPopup.locator('h2').first().textContent()) === 'Ця сторінка',
  await ukPopup.locator('h2').first().textContent(),
);
check('text tools are translated', (await ukPopup.locator('#transforms button').first().textContent()) === 'Маскувати');
await ukPopup.screenshot({ path: 'docs/popup-uk.png', fullPage: true });
await ukContext.close();

check('no page errors', errors.length === 0, errors.join('; '));
await context.close();
server.close();

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
