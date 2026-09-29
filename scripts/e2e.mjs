// End-to-end test: loads the built extension into Chromium, drives the log viewer, the text
// tools and the popup like a user would, checks the results, and saves screenshots to docs/.
// Exits with code 1 if any check fails. Needs a Chromium for Playwright (`npx playwright install chromium`).
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
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

const server = createServer((req, res) => {
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
const popup = await context.newPage();
watch(popup);
await popup.setViewportSize({ width: 380, height: 700 });
await popup.goto(`chrome-extension://${extensionId}/popup.html`);
await popup.locator('#input').fill('0 */15 * * * *');
await popup.locator('button', { hasText: 'Explain cron' }).click();
check('popup explains cron', (await popup.locator('#output').textContent()) === 'Every 15 minutes');
await popup.screenshot({ path: 'docs/popup.png', fullPage: true });

check('no page errors', errors.length === 0, errors.join('; '));
await context.close();
server.close();

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
