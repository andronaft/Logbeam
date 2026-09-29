// Loads the built extension into Chromium, exercises the log viewer, the text-tool panel and the
// popup on a sample log, and saves screenshots to docs/. Needs Playwright: `npx playwright install chromium`.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dist = path.resolve('dist');
const sample = readFileSync('docs/sample.log', 'utf8');

const server = createServer((req, res) => {
  if (req.url === '/app.log') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(sample);
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><title>Editor</title><body style="font:16px system-ui;padding:40px;background:#f6f8fa">
      <h2>Deploy config</h2>
      <textarea id="t" style="width:560px;height:90px;font:14px monospace">{"service":"payments","replicas":3,"env":{"LOG_LEVEL":"info"}}</textarea>
      <p>Token: <code id="jwt">eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhbm5hIiwicm9sZXMiOlsiUk9MRV9VU0VSIl0sImlhdCI6MTcwMDAwMDAwMCwiZXhwIjoxNzAwMDAzNjAwfQ.c2lnbmF0dXJl</code></p></body>`);
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const context = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'logbeam-')), {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 720 },
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
const errors = [];
context.on('weberror', (e) => errors.push(String(e.error())));

let [worker] = context.serviceWorkers();
worker ??= await context.waitForEvent('serviceworker');
const extensionId = new URL(worker.url()).host;
console.log('extension loaded:', extensionId);

// ---- log viewer -----------------------------------------------------------------------
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}/app.log`);
await page.addScriptTag({ path: path.join(dist, 'logViewer.js') });
await page.waitForSelector('.row');
const total = await page.locator('.status').textContent();
console.log('viewer status:', total);
await page.screenshot({ path: 'docs/log-viewer.png' });

await page.locator('.chip.lvl-INFO').click();
await page.locator('.chip.lvl-DEBUG').click();
await page.locator('.toggle', { hasText: 'Collapse repeats' }).click();
console.log('after filters:', await page.locator('.status').textContent());
await page.screenshot({ path: 'docs/log-viewer-filtered.png' });
await page.locator('.search').fill('Connection|timeout');
await page.locator('.toggle', { hasText: '.*' }).click();
await page.waitForTimeout(300);
console.log('after regex search:', await page.locator('.status').textContent(), 'marks:', await page.locator('mark').count());

// ---- text tool panel ----------------------------------------------------------------------
const editor = await context.newPage();
editor.on('pageerror', (e) => errors.push(e.message));
await editor.goto(`${base}/editor`);
await editor.addScriptTag({ path: path.join(dist, 'panel.js') });
await editor.locator('#t').click();
await editor.evaluate(() => window.__logbeamPanel.run('json-format'));
await editor.waitForSelector('logbeam-panel .panel');
await editor.screenshot({ path: 'docs/text-tools.png' });
await editor.locator('logbeam-panel button', { hasText: 'Replace selection' }).click();
const value = await editor.locator('#t').inputValue();
console.log('textarea after Replace selection:', JSON.stringify(value.slice(0, 40)), value.includes('\n  "replicas": 3') ? 'OK' : 'NOT REPLACED');

await editor.keyboard.press('Escape');
await editor.evaluate(() => {
  const range = document.createRange();
  range.selectNodeContents(document.getElementById('jwt'));
  getSelection().removeAllRanges();
  getSelection().addRange(range);
  document.activeElement?.blur();
});
await editor.evaluate(() => window.__logbeamPanel.run('jwt-decode'));
await editor.screenshot({ path: 'docs/jwt.png' });

// ---- popup ------------------------------------------------------------------------------
const popup = await context.newPage();
popup.on('pageerror', (e) => errors.push(e.message));
await popup.setViewportSize({ width: 380, height: 600 });
await popup.goto(`chrome-extension://${extensionId}/popup.html`);
await popup.locator('#input').fill('0 */15 * * * *');
await popup.locator('button', { hasText: 'Explain cron' }).click();
console.log('popup cron:', await popup.locator('#output').textContent());
await popup.screenshot({ path: 'docs/popup.png', fullPage: true });

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
await context.close();
server.close();
