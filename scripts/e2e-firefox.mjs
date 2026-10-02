// End-to-end test of the Firefox build: installs dist-firefox/ into a headless Firefox with
// Selenium and runs the log viewer, the text tools, dark mode and the popup in it.
// Exits with code 1 if any check fails. Needs Firefox and geckodriver (GitHub's runners have both).
//
// A test copy of the add-on asks for <all_urls> up front, so the extension can be driven from its
// own popup page without the clicks that grant activeTab to real users.
import { Builder, By, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ADDON_ID = 'logbeam@zhukovskyi.space';
const UUID = '6f1c1c55-5f2e-4b55-9d7e-0123456789ab';
const BIG_LINES = 150_000;

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
}

// ---- test copy of the add-on --------------------------------------------------------------
const work = mkdtempSync(path.join(tmpdir(), 'logbeam-ff-'));
const addonDir = path.join(work, 'addon');
cpSync('dist-firefox', addonDir, { recursive: true });
const manifest = JSON.parse(readFileSync(path.join(addonDir, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['<all_urls>'];
writeFileSync(path.join(addonDir, 'manifest.json'), JSON.stringify(manifest));
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
  '/redos.log': Array.from({ length: 50 }, () => `${'a'.repeat(34)}b`).join('\n'),
};
const html = {
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
  .setPreference('extensions.webextensions.uuids', JSON.stringify({ [ADDON_ID]: UUID }))
  // grant the test copy's host permission at install, as if the user had allowed it
  .setPreference('extensions.originControls.grantByDefault', true);
const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
await driver.manage().setTimeouts({ script: 30_000 });

/** Runs code with the extension's privileges, in its popup page. */
let popupHandle;
async function inExtension(code, ...args) {
  await driver.switchTo().window(popupHandle);
  const result = await driver.executeAsyncScript(
    `const done = arguments[arguments.length - 1];
     const args = Array.from(arguments).slice(0, -1);
     (async (...args) => { ${code} })(...args).then(done, (e) => done({ error: String(e && e.message || e) }));`,
    ...args,
  );
  if (result && result.error) throw new Error(result.error);
  return result;
}

/** Opens a page in a new tab and returns its tab id and window handle. */
async function openPage(pagePath) {
  await driver.switchTo().newWindow('tab');
  await driver.get(base + pagePath);
  const handle = await driver.getWindowHandle();
  const tabId = await inExtension(
    'const [tab] = await browser.tabs.query({ url: args[0] }); return tab.id;',
    `${base}${pagePath}`.replace(/#.*/, ''),
  );
  return { tabId, handle };
}

const status = () => driver.findElement(By.css('.status')).getText();

try {
  await driver.installAddon(xpi, true);
  check('add-on installs', true);

  // ---- popup --------------------------------------------------------------------------------
  await driver.get(`moz-extension://${UUID}/popup.html`);
  popupHandle = await driver.getWindowHandle();
  await driver.wait(until.elementLocated(By.css('#transforms button')), 5000);
  await driver.findElement(By.id('input')).sendKeys('0 */15 * * * *');
  await driver.findElement(By.xpath('//button[normalize-space()="Explain cron"]')).click();
  check('popup explains cron', (await driver.findElement(By.id('output')).getText()) === 'Every 15 minutes');
  const shortcuts = await inExtension(
    'return Object.fromEntries((await browser.commands.getAll()).map((c) => [c.name, c.shortcut]));',
  );
  check(
    'shortcuts are assigned',
    shortcuts['open-log-viewer'] === 'Ctrl+Shift+L' && shortcuts['toggle-dark-mode'] === 'Ctrl+Shift+Period',
    JSON.stringify(shortcuts),
  );

  // ---- log viewer -----------------------------------------------------------------------------
  const log = await openPage('/app.log');
  await inExtension("await browser.scripting.executeScript({ target: { tabId: args[0] }, files: ['logViewer.js'] });", log.tabId);
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
  await inExtension("await browser.scripting.executeScript({ target: { tabId: args[0] }, files: ['logViewer.js'] });", big.tabId);
  await driver.switchTo().window(big.handle);
  await driver.wait(until.elementLocated(By.css('.row')), 60_000);
  const total = `${BIG_LINES.toLocaleString('en')} / ${BIG_LINES.toLocaleString('en')} lines`;
  const parser = await driver.executeScript('return document.documentElement.dataset.logbeamParser');
  check(`${BIG_LINES.toLocaleString('en')} lines parse`, (await status()) === total, `parsed with: ${parser}`);
  check('only visible rows are in the DOM', (await driver.findElements(By.css('.row'))).length < 200);

  // ---- a slow regex can't freeze the tab ------------------------------------------------------
  const redos = await openPage('/redos.log');
  await inExtension(
    "await browser.scripting.executeScript({ target: { tabId: args[0] }, files: ['logViewer.js'] });",
    redos.tabId,
  );
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
  await inExtension(
    `const target = { tabId: args[0] };
     await browser.scripting.executeScript({ target, files: ['panel.js'] });
     await browser.scripting.executeScript({ target, func: (id) => window.__logbeamPanel.run(id), args: ['mask-secrets'] });`,
    editor.tabId,
  );
  await driver.switchTo().window(editor.handle);
  const panelText = await driver.wait(
    () => driver.executeScript("return document.querySelector('logbeam-panel')?.shadowRoot?.querySelector('pre')?.textContent"),
    5000,
  );
  check(
    'Mask secrets on a page',
    panelText.includes('AKIA********') && !panelText.includes('Sup3rS3cretPass'),
    panelText.replace('\n', ' | '),
  );

  // ---- dark mode ----------------------------------------------------------------------------
  const setDark = (tabId) =>
    inExtension(
      `const target = { tabId: args[0] };
       await browser.scripting.executeScript({ target, files: ['darkApi.js'] });
       await browser.scripting.insertCSS({ target, files: ['dark.css'] });
       const [result] = await browser.scripting.executeScript({ target, func: () => window.__logbeamDark.set(true) });
       return result.result;`,
      tabId,
    );
  const light = await openPage('/light');
  check('dark mode turns a light page dark', (await setDark(light.tabId)) === 'on');
  await driver.switchTo().window(light.handle);
  check(
    'dark class is on the page',
    await driver.executeScript("return document.documentElement.classList.contains('logbeam-dark')"),
  );
  const dark = await openPage('/dark');
  check('an already dark page is left alone', (await setDark(dark.tabId)) === 'native-dark');

  // "Remember for this site" registers a content script; the next load must come up dark
  await inExtension(
    `await browser.scripting.registerContentScripts([{ id: 'e2e-dark', matches: [args[0]], css: ['dark.css'],
       js: ['darkAuto.js'], runAt: 'document_start', allFrames: true, persistAcrossSessions: true }]);`,
    `${base}/light2`,
  );
  const remembered = await openPage('/light2');
  await driver.switchTo().window(remembered.handle);
  check(
    'remembered site loads dark',
    await driver.executeScript("return document.documentElement.classList.contains('logbeam-dark')"),
  );
} catch (error) {
  check('test run', false, error.stack);
} finally {
  await driver.quit();
  server.close();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
