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

// The parse worker is inlined into the viewer as a string: a content script can only start
// a worker from a Blob, not from the extension's own URL.
const worker = await esbuild.build({
  entryPoints: ['src/content/parseWorker.ts'],
  bundle: true,
  format: 'iife',
  target: 'chrome110',
  minify: true,
  write: false,
});
const workerCode = worker.outputFiles[0].text;

const options = {
  entryPoints: {
    background: 'src/background.ts',
    popup: 'src/popup/popup.ts',
    logViewer: 'src/content/viewerEntry.ts',
    autoOpen: 'src/content/autoOpen.ts',
    panel: 'src/content/panel.ts',
  },
  define: { __PARSE_WORKER__: JSON.stringify(workerCode) },
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
