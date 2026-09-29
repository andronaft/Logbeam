// Zips dist/ for upload to the Chrome Web Store (manifest.json must be at the archive root).
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));
const zip = `logbeam-${version}.zip`;
rmSync(zip, { force: true });
execFileSync('zip', ['-r', '-X', `../${zip}`, '.'], { cwd: 'dist', stdio: 'inherit' });
console.log(`Created ${zip}`);
