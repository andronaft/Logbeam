// Builds Chrome Web Store images from docs/*.png (run `npm run screenshots` first):
// five captioned 1280x800 screenshots and the 440x280 / 1400x560 promo tiles.
// JPEG output because the store rejects PNGs with an alpha channel.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';

const OUT = 'docs/store';
mkdirSync(OUT, { recursive: true });

const img = (file) => `data:image/png;base64,${readFileSync(file).toString('base64')}`;
const ICON = img('icons/logo512.png');

const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; }
  body {
    width: 100vw; height: 100vh; overflow: hidden; color: #e6e1cf;
    background: radial-gradient(ellipse at top left, #1d2733 0%, #0b0f14 60%);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .accent { color: #ffb454; }
  .shot { border-radius: 10px; box-shadow: 0 18px 50px rgba(0,0,0,.55); border: 1px solid #2d3640; display: block; }
`;

function screenshotPage(title, subtitle, file) {
  return `<style>${BASE_CSS}
    header { height: 132px; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 6px; }
    h1 { font-size: 36px; font-weight: 700; }
    p { font-size: 20px; color: #9aa4ad; }
    .shot { width: 1056px; margin: 0 auto; }
  </style>
  <header><h1>${title}</h1><p>${subtitle}</p></header>
  <img class="shot" src="${img(file)}">`;
}

const SCREENSHOTS = [
  ['1-log-viewer', 'Logs you can <span class="accent">actually read</span>', 'Levels in colour · stack traces grouped with their error · pauses between entries', 'docs/log-viewer.png'],
  ['2-filters', 'Find the problem <span class="accent">in seconds</span>', 'Filter by level · regex search · collapse repeated lines (×6) · jump to next error', 'docs/log-viewer-filtered.png'],
  ['3-json', 'Right-click → <span class="accent">Format JSON</span>', 'Works on any page · “Replace selection” writes the result back into inputs and editors', 'docs/text-tools.png'],
  ['4-jwt', 'Decode a JWT <span class="accent">without pasting it anywhere</span>', 'Header, payload, dates and expiry, computed locally in your browser', 'docs/jwt.png'],
];

const POPUP_PAGE = `<style>${BASE_CSS}
  body { display: flex; align-items: center; justify-content: center; gap: 80px; }
  .text { width: 560px; }
  h1 { font-size: 44px; line-height: 1.15; margin-bottom: 24px; }
  li { font-size: 22px; color: #c9ced4; margin: 0 0 14px 0; list-style: none; }
  li::before { content: "▸ "; color: #ffb454; }
  .shot { height: 655px; }
</style>
<div class="text">
  <h1>Dark mode and <span class="accent">15 dev tools</span> in one click</h1>
  <ul>
    <li>Dark mode for any site, per tab or remembered</li>
    <li>JSON · JWT · Base64 · URL · timestamps</li>
    <li>Explain cron: 0 */15 * * * * → “Every 15 minutes”</li>
    <li>camelCase ⇄ snake_case ⇄ kebab-case</li>
    <li>100% local: no server, no analytics</li>
  </ul>
</div>
<img class="shot" src="${img('docs/popup.png')}">`;

const SMALL_PROMO = `<style>${BASE_CSS}
  body { display: flex; align-items: center; gap: 22px; padding: 0 34px; }
  img { width: 104px; height: 104px; }
  h1 { font-size: 44px; font-weight: 800; letter-spacing: -.5px; }
  p { font-size: 17px; color: #9aa4ad; margin-top: 6px; line-height: 1.35; }
</style>
<img src="${ICON}">
<div><h1>Log<span class="accent">beam</span></h1><p>Readable logs, dark mode<br>&amp; dev tools for Chrome</p></div>`;

const MARQUEE = `<style>${BASE_CSS}
  body { display: flex; align-items: center; gap: 56px; padding-left: 90px; }
  .brand { display: flex; align-items: center; gap: 22px; margin-bottom: 22px; }
  .brand img { width: 96px; height: 96px; }
  h1 { font-size: 64px; font-weight: 800; letter-spacing: -1px; }
  p { font-size: 26px; color: #9aa4ad; line-height: 1.4; }
  .shot { width: 760px; height: 470px; object-fit: cover; object-position: left top; }
</style>
<div>
  <div class="brand"><img src="${ICON}"><h1>Log<span class="accent">beam</span></h1></div>
  <p>Make logs readable again.<br>Dark mode &amp; dev tools, 100% local.</p>
</div>
<img class="shot" src="${img('docs/log-viewer.png')}">`;

const browser = await chromium.launch();
async function render(name, html, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(html);
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 92 });
  await page.close();
  console.log(`${OUT}/${name}.jpg  ${width}x${height}`);
}

for (const [name, title, subtitle, file] of SCREENSHOTS) {
  await render(name, screenshotPage(title, subtitle, file), 1280, 800);
}
await render('5-popup', POPUP_PAGE, 1280, 800);
await render('promo-small-440x280', SMALL_PROMO, 440, 280);
await render('promo-marquee-1400x560', MARQUEE, 1400, 560);
await browser.close();
