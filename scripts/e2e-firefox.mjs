// End-to-end test of the Firefox build: installs dist-firefox/ into a headless Firefox with
// Selenium and runs the log viewer, the text tools, dark mode and the popup in it.
// Exits with code 1 if any check fails. Needs Firefox and geckodriver (GitHub's runners have both).
//
// A test copy of the add-on asks for <all_urls> up front, so it can be driven without the clicks
// that grant activeTab to real users. WebDriver may neither open nor run scripts in moz-extension://
// pages, so the test copy opens its popup in a tab by itself, and a bridge page on the test server
// passes commands to a test-only background script (E2E_HOOK) that does what a click would.
import { Builder, By, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BIG_LINES = 150_000;

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
}

const E2E_HOOK = `
browser.tabs.create({ url: browser.runtime.getURL('popup.html') });
// only commands for this hook; other messages (e.g. Compare) are for the add-on itself
browser.runtime.onMessage.addListener((msg) => (msg && msg.cmd && msg.cmd !== 'page' ? handle(msg) : undefined));
async function handle(msg) {
  // match patterns can't hold a port, so compare whole URLs
  const tab = msg.url && (await browser.tabs.query({})).find((t) => t.url === msg.url);
  const target = tab && { tabId: tab.id };
  const run = async (func, args = []) => (await browser.scripting.executeScript({ target, func, args }))[0].result;
  switch (msg.cmd) {
    case 'commands':
      return Object.fromEntries((await browser.commands.getAll()).map((c) => [c.name, c.shortcut]));
    case 'viewer':
      await browser.scripting.executeScript({ target, files: ['logViewer.js'] });
      return true;
    case 'transform':
      await browser.scripting.executeScript({ target, files: ['panel.js'] });
      return run((id) => window.__logbeamPanel.run(id), [msg.id]);
    case 'dark':
      await browser.scripting.executeScript({ target, files: ['darkApi.js'] });
      await browser.scripting.insertCSS({ target, files: ['dark.css'] });
      return run(() => window.__logbeamDark.set(true));
    case 'paste': {
      // what the popup's "Open text as log" does
      const id = 'e2e' + Date.now();
      await browser.storage.session.set({ ['viewerText:' + id]: { text: msg.text, name: 'Pasted log' } });
      await browser.tabs.create({ url: browser.runtime.getURL('viewer.html?id=' + id) });
      return true;
    }
    case 'remember':
      await browser.scripting.registerContentScripts([{ id: 'e2e-dark', matches: [msg.pattern], css: ['dark.css'],
        js: ['darkAuto.js'], runAt: 'document_start', allFrames: true, persistAcrossSessions: true }]);
      return true;
  }
}`;
// Firefox's WebDriver can't touch moz-extension:// pages, so the test copy's own pages (popup,
// Compare, viewer) get this helper, which runs steps sent through the bridge and answers.
const E2E_PAGE = `
browser.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.cmd !== 'page' || !location.href.includes(msg.page)) return undefined;
  return run(msg.steps);
});
const find = (selector, text) =>
  [...document.querySelectorAll(selector)].find((el) => text === undefined || el.textContent.trim() === text);
async function waitFor(test) {
  for (let i = 0; i < 100; i++) {
    const value = test();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('timed out');
}
async function run(steps) {
  const results = [];
  for (const step of steps) {
    if (step.wait) await waitFor(() => find(step.wait));
    else if (step.fill) {
      const el = await waitFor(() => find(step.fill));
      el.value = step.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (step.click) (await waitFor(() => find(step.click, step.text))).click();
    else if (step.text) results.push((await waitFor(() => find(step.text))).textContent);
    else if (step.until) {
      // the text of an element once it contains the expected part
      results.push(await waitFor(() => { const t = find(step.until)?.textContent; return t && t.includes(step.contains) && t; }));
    }
  }
  return results;
}`;
const E2E_BRIDGE = `
window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data || !event.data.e2eCommand) return;
  const command = event.data.e2eCommand;
  // 'compare' sends what the log viewer's Compare button sends
  const message = command.cmd === 'compare' ? { type: 'logbeam:compare-add', text: command.text, name: command.name } : command;
  browser.runtime.sendMessage(message).then(
    (result) => window.postMessage({ e2eResult: { result } }, '*'),
    (error) => window.postMessage({ e2eResult: { error: String(error) } }, '*'),
  );
});`;

// ---- test copy of the add-on --------------------------------------------------------------
const work = mkdtempSync(path.join(tmpdir(), 'logbeam-ff-'));
const addonDir = path.join(work, 'addon');
cpSync('dist-firefox', addonDir, { recursive: true });
const manifest = JSON.parse(readFileSync(path.join(addonDir, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['<all_urls>'];
manifest.background.scripts.push('e2e-hook.js');
manifest.content_scripts = [{ matches: ['http://localhost/e2e-bridge'], js: ['e2e-bridge.js'] }];
writeFileSync(path.join(addonDir, 'manifest.json'), JSON.stringify(manifest));
writeFileSync(path.join(addonDir, 'e2e-hook.js'), E2E_HOOK);
writeFileSync(path.join(addonDir, 'e2e-bridge.js'), E2E_BRIDGE);
writeFileSync(path.join(addonDir, 'e2e-page.js'), E2E_PAGE);
for (const page of ['popup.html', 'diff.html', 'viewer.html']) {
  const file = path.join(addonDir, page);
  writeFileSync(file, readFileSync(file, 'utf8').replace('<script ', '<script src="e2e-page.js"></script>\n    <script '));
}
const xpi = path.join(work, 'logbeam.xpi');
execFileSync('zip', ['-r', '-q', xpi, '.'], { cwd: addonDir });

// ---- pages --------------------------------------------------------------------------------
const bigLog = Array.from(
  { length: BIG_LINES },
  (_, i) => `2026-09-29 10:00:00.000 ${i % 97 === 0 ? 'ERROR' : 'INFO'} worker-${i % 8} processed job ${i}`,
).join('\n');
const text = {
  '/app.log': readFileSync('docs/sample.log', 'utf8'),
  '/big.log': bigLog,
  '/pretty.log': [
    '2026-10-04 10:00:00 INFO started',
    '{',
    '  "level": "error",',
    '  "message": "payment failed",',
    '  "order": { "id": 7781 }',
    '}',
    '2026-10-04 10:00:06 INFO next',
  ].join('\n'),
  '/fields.log': [
    '{"level":"error","service":"payments","duration":950,"msg":"timeout"}',
    '{"level":"error","service":"search","duration":40,"msg":"missing"}',
    '2026-10-04T10:10:00Z WARN slow service=payments duration=1.2s',
    '[pod/api-1/app] 2026-10-04T10:11:00Z INFO from a pod',
    '[pod/api-2/app] 2026-10-04T10:12:00Z INFO from another pod',
  ].join('\n'),
  '/redos.log': Array.from({ length: 50 }, () => `${'a'.repeat(34)}b`).join('\n'),
};
const html = {
  '/e2e-bridge': '<!doctype html><title>bridge</title>',
  '/light': '<!doctype html><body style="background:#fff;color:#111"><p>Light page</p></body>',
  '/light2': '<!doctype html><body style="background:#fff;color:#111"><p>Remembered</p></body>',
  '/dark': '<!doctype html><body style="background:#0d1117;color:#e6edf3"><p>Already dark</p></body>',
  '/editor': `<!doctype html><body><textarea id="cfg" style="width:500px;height:60px">spring.datasource.password=Sup3rS3cretPass
aws.key=AKIAIOSFODNN7EXAMPLE</textarea></body>`,
};
const server = createServer((req, res) => {
  const url = req.url.split('#')[0];
  if (text[url] !== undefined) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(text[url]);
  } else {
    res.writeHead(html[url] !== undefined ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html[url] ?? 'not found');
  }
});
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://localhost:${server.address().port}`;

// ---- browser ------------------------------------------------------------------------------
const options = new firefox.Options()
  .addArguments('-headless')
  // grant the test copy's host permission at install, as if the user had allowed it
  .setPreference('extensions.originControls.grantByDefault', true);
const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
await driver.manage().setTimeouts({ script: 30_000 });

let bridgeHandle;
/** Sends a command to the test copy's background script through the bridge page. */
async function command(cmd) {
  await driver.switchTo().window(bridgeHandle);
  const reply = await driver.executeAsyncScript(
    `const done = arguments[arguments.length - 1];
     window.addEventListener('message', (e) => e.data && e.data.e2eResult && done(e.data.e2eResult), { once: false });
     window.postMessage({ e2eCommand: arguments[0] }, '*');`,
    cmd,
  );
  if (reply.error) throw new Error(`${cmd.cmd}: ${reply.error}`);
  return reply.result;
}

/** Opens a page in a new tab; returns its URL and window handle. */
async function openPage(pagePath) {
  await driver.switchTo().newWindow('tab');
  await driver.get(base + pagePath);
  return { url: base + pagePath, handle: await driver.getWindowHandle() };
}

const status = () => driver.findElement(By.css('.status')).getText();
/** Runs steps on one of the add-on's own pages through E2E_PAGE; returns what they read. */
// a page that is still loading has no listener yet and answers nothing, so ask again
async function onPage(page, steps) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const result = await command({ cmd: 'page', page, steps });
    if (Array.isArray(result)) return result;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${page} didn't answer`);
}

try {
  await driver.installAddon(xpi, true);
  check('add-on installs', true);

  ({ handle: bridgeHandle } = await openPage('/e2e-bridge'));

  // ---- popup (opened in a tab by the test copy) ----------------------------------------------
  const [cron] = await onPage('popup.html', [
    { wait: '#transforms button' },
    { fill: '#input', value: '0 */15 * * * *' },
    { click: 'button', text: 'Explain cron' },
    { until: '#output', contains: 'Every' },
  ]);
  check('popup explains cron', cron === 'Every 15 minutes', cron);
  const shortcuts = await command({ cmd: 'commands' });
  check(
    'shortcuts are assigned',
    shortcuts['open-log-viewer'] === 'Ctrl+Shift+L' && shortcuts['toggle-dark-mode'] === 'Ctrl+Shift+Period',
    JSON.stringify(shortcuts),
  );

  // ---- log viewer -----------------------------------------------------------------------------
  const log = await openPage('/app.log');
  await command({ cmd: 'viewer', url: log.url });
  await driver.switchTo().window(log.handle);
  await driver.wait(until.elementLocated(By.css('.row')), 10_000);
  check('viewer shows every line', (await status()) === '65 / 65 lines', await status());
  check('secrets are counted', (await driver.findElement(By.css('.toggle.secrets')).getText()) === '🔑 2');
  await driver.findElement(By.css('body')).sendKeys('e');
  check('next error opens the inspector', await driver.findElement(By.css('.inspector')).isDisplayed());

  const search = await driver.findElement(By.css('.search'));
  await driver.findElement(By.xpath('//*[contains(@class,"toggle") and normalize-space()=".*"]')).click();
  await search.sendKeys('Connection|refused');
  await driver.sleep(500);
  check('regex search', (await status()) === '2 / 65 lines', await status());

  // ---- big log ------------------------------------------------------------------------------
  const big = await openPage('/big.log');
  await command({ cmd: 'viewer', url: big.url });
  await driver.switchTo().window(big.handle);
  await driver.wait(until.elementLocated(By.css('.row')), 60_000);
  const total = `${BIG_LINES.toLocaleString('en')} / ${BIG_LINES.toLocaleString('en')} lines`;
  const parser = await driver.executeScript('return document.documentElement.dataset.logbeamParser');
  check(`${BIG_LINES.toLocaleString('en')} lines parse`, (await status()) === total, `parsed with: ${parser}`);
  check('only visible rows are in the DOM', (await driver.findElements(By.css('.row'))).length < 200);

  // ---- a slow regex can't freeze the tab ------------------------------------------------------
  const redos = await openPage('/redos.log');
  await command({ cmd: 'viewer', url: redos.url });
  await driver.switchTo().window(redos.handle);
  await driver.wait(until.elementLocated(By.css('.row')), 10_000);
  await driver.findElement(By.xpath('//*[contains(@class,"toggle") and normalize-space()=".*"]')).click();
  await driver.findElement(By.css('.search')).sendKeys('(a|aa)+$');
  const started = Date.now();
  const stopped = await driver.wait(async () => (await status()).includes('took over'), 10_000).catch(() => false);
  check('a catastrophic regex is stopped by the worker timeout', stopped, `${Date.now() - started} ms: ${await status()}`);

  // ---- text tools ---------------------------------------------------------------------------
  const editor = await openPage('/editor');
  await driver.switchTo().window(editor.handle);
  await driver.findElement(By.id('cfg')).click();
  await command({ cmd: 'transform', url: editor.url, id: 'mask-secrets' });
  await driver.switchTo().window(editor.handle);
  const panelText = await driver.wait(
    () => driver.executeScript("return document.querySelector('logbeam-panel')?.shadowRoot?.querySelector('pre')?.textContent"),
    5000,
  );
  // compared in full: GitHub masks password-like text in CI logs, so the printed detail can show ***
  check(
    'Mask secrets on a page',
    panelText === 'spring.datasource.password=********\naws.key=AKIA********',
    JSON.stringify(panelText),
  );

  // ---- dark mode ----------------------------------------------------------------------------
  const setDark = (url) => command({ cmd: 'dark', url });
  const light = await openPage('/light');
  check('dark mode turns a light page dark', (await setDark(light.url)) === 'on');
  await driver.switchTo().window(light.handle);
  check(
    'dark class is on the page',
    await driver.executeScript("return document.documentElement.classList.contains('logbeam-dark')"),
  );
  const dark = await openPage('/dark');
  check('an already dark page is left alone', (await setDark(dark.url)) === 'native-dark');

  // "Remember for this site" registers a content script; the next load must come up dark
  await command({ cmd: 'remember', pattern: 'http://localhost/light2' });
  const remembered = await openPage('/light2');
  await driver.switchTo().window(remembered.handle);
  check(
    'remembered site loads dark',
    await driver.executeScript("return document.documentElement.classList.contains('logbeam-dark')"),
  );

  // ---- multi-line JSON records --------------------------------------------------------------
  const pretty = await openPage('/pretty.log');
  await command({ cmd: 'viewer', url: pretty.url });
  await driver.switchTo().window(pretty.handle);
  await driver.wait(until.elementLocated(By.css('.row')), 10_000);
  const record = await driver.findElement(By.xpath('//*[contains(@class,"row")][contains(., "error payment failed")]'));
  check('a pretty-printed JSON record is read as one entry', Boolean(record));
  check('its lines take the record’s level', (await driver.findElement(By.css('.chip.lvl-ERROR .count')).getText()) === '5');

  // ---- compare ------------------------------------------------------------------------------
  check('first text goes to Before', (await command({ cmd: 'compare', text: 'a\nb\nc', name: 'one' })) === 'left');
  check('second text goes to After', (await command({ cmd: 'compare', text: 'a\nB\nc', name: 'two' })) === 'right');
  const [summary] = await onPage('diff.html', [{ until: '#summary', contains: '+1' }]);
  check('the Compare page opens and shows the difference', summary.includes('+1 −1'), summary);

  // ---- fields, pods ---------------------------------------------------------------------------
  const fieldsPage = await openPage('/fields.log');
  await command({ cmd: 'viewer', url: fieldsPage.url });
  await driver.switchTo().window(fieldsPage.handle);
  await driver.wait(until.elementLocated(By.css('.row')), 10_000);
  await driver.findElement(By.css('.search')).sendKeys('service=payments duration>500');
  await driver.wait(async () => (await status()).startsWith('2 /'), 5000).catch(() => undefined);
  check('field filters', (await status()) === '2 / 5 lines · 2 field conditions', await status());
  check('each pod gets a chip', (await driver.findElements(By.css('.sources .chip'))).length === 2);
  await driver.findElement(By.css('.search')).clear();
  await driver.findElement(By.xpath('//button[normalize-space()="Groups"]')).click();
  check('errors are grouped', (await driver.findElements(By.css('.group-item'))).length === 2);
  await driver.findElement(By.css('.row[data-number="1"] .txt')).click();
  await driver.findElement(By.css('body')).sendKeys('m');
  check('a line can be bookmarked', (await driver.findElement(By.css('.bookmarks')).getText()) === '★ 1');

  // ---- the viewer page for pasted text ---------------------------------------------------------
  await command({ cmd: 'paste', text: 'INFO one\nERROR two timeout\nINFO three missing' });
  const [opened, searched] = await onPage('viewer.html?id=', [
    { until: '.status', contains: '/ 3 lines' },
    { click: '.toggle', text: '.*' },
    { fill: '.search', value: 'timeout|missing' },
    { until: '.status', contains: '2 /' },
  ]);
  check('pasted text opens in the viewer page', opened === '3 / 3 lines', opened);
  check('regex search works on the extension page (worker from a file)', searched === '2 / 3 lines', searched);
} catch (error) {
  check('test run', false, error.stack);
} finally {
  await driver.quit();
  server.close();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
