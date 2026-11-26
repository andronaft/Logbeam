// Zips the built extensions for the stores (manifest.json must be at the archive root):
//   logbeam-<version>.zip          dist/          Chrome Web Store (also loads in Edge, Opera, Brave)
//   logbeam-firefox-<version>.zip  dist-firefox/  addons.mozilla.org
//   logbeam-source-<version>.zip   the sources, which AMO asks for because the code is bundled
//
// The ZIPs are reproducible: two builds of one commit give byte-identical files, so anyone can rebuild a release
// and compare it with its SHA256SUMS. Entries are sorted, every entry gets the same time (SOURCE_DATE_EPOCH, or the
// time of the last commit) and the same permissions, and nothing about the machine (owner, time zone) goes in.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

const { version } = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));

function sourceDateEpoch() {
  if (process.env.SOURCE_DATE_EPOCH) return Number(process.env.SOURCE_DATE_EPOCH);
  try {
    return Number(execFileSync('git', ['log', '-1', '--format=%ct'], { encoding: 'utf8' }).trim());
  } catch {
    return 315532800; // 1980-01-01, the earliest time a ZIP can hold
  }
}

// MS-DOS date and time as ZIP stores them, from the UTC time so the time zone of the build doesn't matter
function dosTime(seconds) {
  const d = new Date(Math.max(seconds, 315532800) * 1000);
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
    date: ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

// Every directory and file under dir, as ZIP paths ("icons/", "icons/16.png"), sorted
function listEntries(dir, prefix = '') {
  const entries = [];
  for (const item of readdirSync(join(dir, prefix), { withFileTypes: true })) {
    if (item.name === '.DS_Store') continue;
    const path = prefix + item.name;
    if (item.isDirectory()) entries.push(`${path}/`, ...listEntries(dir, `${path}/`));
    else if (item.isFile()) entries.push(path);
  }
  return entries;
}

function zipDir(dir, zip) {
  rmSync(zip, { force: true });
  const { time, date } = dosTime(sourceDateEpoch());
  const names = listEntries(dir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const local = [];
  const central = [];
  let offset = 0;
  for (const name of names) {
    const isDir = name.endsWith('/');
    const data = isDir ? Buffer.alloc(0) : readFileSync(join(dir, name));
    const deflated = data.length ? deflateRawSync(data, { level: 9 }) : data;
    const method = deflated.length < data.length ? 8 : 0;
    const body = method === 8 ? deflated : data;
    const nameBytes = Buffer.from(name, 'utf8');
    const flags = /^[\x20-\x7e]*$/.test(name) ? 0 : 0x0800; // bit 11: the name is UTF-8
    const crc = crc32(data);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed to extract
    header.writeUInt16LE(flags, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28); // no extra fields: no owner, no extended times
    local.push(header, nameBytes, body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix, so the permissions below are read
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(flags, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt16LE(time, 12);
    entry.writeUInt16LE(date, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    // extra field, comment, disk number and internal attributes stay 0
    entry.writeUInt32LE((isDir ? (0o40755 << 16) | 0x10 : 0o100644 << 16) >>> 0, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);

    offset += header.length + nameBytes.length + body.length;
  }
  const centralSize = central.reduce((size, part) => size + part.length, 0);
  if (offset + centralSize > 0xffffffff || names.length > 0xffff) throw new Error(`${zip} is too big for a ZIP`);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(zip, Buffer.concat([...local, ...central, end]));
  console.log(`Created ${zip}`);
}

zipDir('dist', `logbeam-${version}.zip`);
if (existsSync('dist-firefox')) {
  zipDir('dist-firefox', `logbeam-firefox-${version}.zip`);
  // git archive keeps the tree's order and puts the commit's time on every file; it writes that time in the local
  // time zone, so it runs in UTC
  const source = `logbeam-source-${version}.zip`;
  rmSync(source, { force: true });
  execFileSync('git', ['archive', '--format=zip', '-o', source, 'HEAD'], {
    stdio: 'inherit',
    env: { ...process.env, TZ: 'UTC' },
  });
  console.log(`Created ${source}`);
}
