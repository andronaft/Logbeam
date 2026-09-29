// Draws the Logbeam icon (a lamp whose beam lights up log lines) and writes PNGs, without dependencies.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [15, 20, 25];
const DIM = [58, 69, 80];
const AMBER = [255, 180, 84];
const SIZES = [16, 32, 48, 128];
const SAMPLES = 4; // 4x4 supersampling for antialiasing

const APEX = { x: 0.17, y: 0.5 };
const BEAM_HALF_ANGLE = 0.42; // radians
const LINES = [
  { y: 0.33, to: 0.82 },
  { y: 0.5, to: 0.66 },
  { y: 0.67, to: 0.76 },
];

function insideRoundedSquare(x, y, r = 0.22) {
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function inBeam(x, y) {
  const dx = x - APEX.x;
  return dx > 0 && Math.abs(Math.atan2(y - APEX.y, dx)) <= BEAM_HALF_ANGLE;
}

/** Colour and opacity of one sample point. */
function shade(x, y) {
  if (!insideRoundedSquare(x, y)) return null;
  let color = BG;
  if (inBeam(x, y)) {
    color = mix(BG, AMBER, 0.16);
  }
  for (const line of LINES) {
    const h = 0.055;
    if (Math.abs(y - line.y) <= h && x >= 0.36 && x <= line.to) {
      // rounded line ends
      const endDist = Math.min(x - 0.36, line.to - x);
      if (endDist < h && (h - endDist) ** 2 + (y - line.y) ** 2 > h * h) continue;
      color = inBeam(x, y) ? AMBER : DIM;
    }
  }
  if ((x - APEX.x) ** 2 + (y - APEX.y) ** 2 <= 0.085 ** 2) {
    color = AMBER;
  }
  return color;
}

function mix(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0,
        g = 0,
        b = 0,
        covered = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const c = shade((px + (sx + 0.5) / SAMPLES) / size, (py + (sy + 0.5) / SAMPLES) / size);
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            covered++;
          }
        }
      }
      const i = (py * size + px) * 4;
      if (covered > 0) {
        pixels[i] = Math.round(r / covered);
        pixels[i + 1] = Math.round(g / covered);
        pixels[i + 2] = Math.round(b / covered);
      }
      pixels[i + 3] = Math.round((covered / (SAMPLES * SAMPLES)) * 255);
    }
  }
  return encodePng(size, size, pixels);
}

// ---- minimal PNG encoder (RGBA, 8 bit, no interlace) ------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('icons', { recursive: true });
for (const size of SIZES) {
  writeFileSync(`icons/icon${size}.png`, render(size));
}
writeFileSync('icons/logo512.png', render(512));
console.log(`Wrote icons for ${SIZES.join(', ')} and 512 px`);
