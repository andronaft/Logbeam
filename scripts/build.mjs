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

const options = {
  entryPoints: {
    background: 'src/background.ts',
    popup: 'src/popup/popup.ts',
    logViewer: 'src/content/logViewer.ts',
    panel: 'src/content/panel.ts',
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
