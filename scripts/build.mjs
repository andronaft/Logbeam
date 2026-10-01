import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const outdir = 'dist';

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

for (const file of ['manifest.json', 'dark.css', 'popup/popup.html', 'popup/popup.css']) {
  cpSync(`src/${file}`, `${outdir}/${file.split('/').pop()}`);
}
cpSync('icons', `${outdir}/icons`, { recursive: true });

// The workers are inlined into the viewer as strings: a content script can only start
// a worker from a Blob, not from the extension's own URL.
const bundleWorker = async (entry) => {
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    target: 'chrome110',
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
    logViewer: 'src/content/viewerEntry.ts',
    autoOpen: 'src/content/autoOpen.ts',
    panel: 'src/content/panel.ts',
    darkApi: 'src/content/darkApiEntry.ts',
    darkAuto: 'src/content/darkAutoEntry.ts',
  },
  define: {
    __PARSE_WORKER__: JSON.stringify(parseWorkerCode),
    __SEARCH_WORKER__: JSON.stringify(searchWorkerCode),
  },
  outdir,
  bundle: true,
  // injected page scripts can't be ES modules, so everything is bundled as a plain script
  format: 'iife',
  target: 'chrome110',
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
