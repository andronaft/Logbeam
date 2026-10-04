import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

// `node scripts/build.mjs` builds the Chrome/Edge/Opera extension into dist/,
// `--firefox` builds the Firefox one into dist-firefox/.
const watch = process.argv.includes('--watch');
const firefox = process.argv.includes('--firefox');
const outdir = firefox ? 'dist-firefox' : 'dist';
const target = firefox ? 'firefox140' : 'chrome110';

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

for (const file of ['dark.css', 'popup/popup.html', 'popup/popup.css', 'diff/diff.html', 'diff/diff.css']) {
  cpSync(`src/${file}`, `${outdir}/${file.split('/').pop()}`);
}
cpSync('icons', `${outdir}/icons`, { recursive: true });

const manifest = JSON.parse(readFileSync('src/manifest.json', 'utf8'));
if (firefox) {
  // Firefox runs MV3 background scripts as an event page, not a service worker
  manifest.background = { scripts: ['background.js'] };
  delete manifest.minimum_chrome_version;
  // Ctrl+Shift+K opens Firefox's Web Console
  manifest.commands['toggle-dark-mode'].suggested_key = { default: 'Ctrl+Shift+Period', mac: 'MacCtrl+Shift+Period' };
  manifest.browser_specific_settings = {
    gecko: {
      id: 'logbeam@zhukovskyi.space',
      strict_min_version: '140.0',
      // nothing leaves the browser; AMO requires new add-ons to say so
      data_collection_permissions: { required: ['none'] },
    },
    gecko_android: { strict_min_version: '142.0' },
  };
}
writeFileSync(`${outdir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);

// The workers are inlined into the viewer as strings: a content script can only start
// a worker from a Blob, not from the extension's own URL.
const bundleWorker = async (entry) => {
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    target,
    minify: true,
    write: false,
  });
  return result.outputFiles[0].text;
};
const parseWorkerCode = await bundleWorker('src/content/parseWorker.ts');
const searchWorkerCode = await bundleWorker('src/content/searchWorker.ts');

const options = {
  entryPoints: {
    background: 'src/background.ts',
    popup: 'src/popup/popup.ts',
    diff: 'src/diff/diff.ts',
    logViewer: 'src/content/viewerEntry.ts',
    autoOpen: 'src/content/autoOpen.ts',
    panel: 'src/content/panel.ts',
    darkApi: 'src/content/darkApiEntry.ts',
    darkAuto: 'src/content/darkAutoEntry.ts',
  },
  define: {
    __PARSE_WORKER__: JSON.stringify(parseWorkerCode),
    __SEARCH_WORKER__: JSON.stringify(searchWorkerCode),
    // Firefox's chrome.* is callback-based; browser.* has the same API with promises
    ...(firefox ? { chrome: 'browser' } : {}),
  },
  outdir,
  bundle: true,
  // injected page scripts can't be ES modules, so everything is bundled as a plain script
  format: 'iife',
  target,
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  logLevel: 'info',
};

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
} else {
  await esbuild.build(options);
}
