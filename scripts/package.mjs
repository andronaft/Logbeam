// Zips the built extensions for the stores (manifest.json must be at the archive root):
//   logbeam-<version>.zip          dist/          Chrome Web Store (also loads in Edge, Opera, Brave)
//   logbeam-firefox-<version>.zip  dist-firefox/  addons.mozilla.org
//   logbeam-source-<version>.zip   the sources, which AMO asks for because the code is bundled
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));

function zipDir(dir, zip) {
  rmSync(zip, { force: true });
  execFileSync('zip', ['-r', '-X', '-q', `../${zip}`, '.'], { cwd: dir, stdio: 'inherit' });
  console.log(`Created ${zip}`);
}

zipDir('dist', `logbeam-${version}.zip`);
if (existsSync('dist-firefox')) {
  zipDir('dist-firefox', `logbeam-firefox-${version}.zip`);
  const source = `logbeam-source-${version}.zip`;
  rmSync(source, { force: true });
  execFileSync('git', ['archive', '--format=zip', '-o', source, 'HEAD'], { stdio: 'inherit' });
  console.log(`Created ${source}`);
}
