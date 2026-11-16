import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'public/icons');
mkdirSync(outDir, { recursive: true });

const BG = [0x17, 0x2e, 0x2a]; // #172e2a
const FG = [0xff, 0xff, 0xff];

const GLYPH = [
  '01110',
  '10001',
  '10001',
  '11111',
  '10001',
  '10001',
  '10001',
];

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

function encodePng(size, pixels) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let offset = 0;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const p = y * size + x;
      raw[offset++] = pixels[p * 4];
      raw[offset++] = pixels[p * 4 + 1];
      raw[offset++] = pixels[p * 4 + 2];
      raw[offset++] = pixels[p * 4 + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeIcon(size) {
  const radius = Math.round(size * 0.22);
  const pixels = Buffer.alloc(size * size * 4);
  const glyphW = GLYPH[0].length;
  const glyphH = GLYPH.length;
  const cell = Math.max(1, Math.floor((size * 0.5) / glyphH));
  const gw = cell * glyphW;
  const gh = cell * glyphH;
  const gx0 = Math.floor((size - gw) / 2);
  const gy0 = Math.floor((size - gh) / 2);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const inside = (() => {
        const cx = Math.min(Math.max(x, radius), size - 1 - radius);
        const cy = Math.min(Math.max(y, radius), size - 1 - radius);
        const dx = x - cx;
        const dy = y - cy;
        return dx * dx + dy * dy <= radius * radius;
      })();
      const onGlyph = (() => {
        if (x < gx0 || x >= gx0 + gw || y < gy0 || y >= gy0 + gh) return false;
        const gx = Math.floor((x - gx0) / cell);
        const gy = Math.floor((y - gy0) / cell);
        return GLYPH[gy][gx] === '1';
      })();
      if (inside) {
        pixels[idx] = onGlyph ? FG[0] : BG[0];
        pixels[idx + 1] = onGlyph ? FG[1] : BG[1];
        pixels[idx + 2] = onGlyph ? FG[2] : BG[2];
        pixels[idx + 3] = 255;
      }
    }
  }
  return encodePng(size, pixels);
}

writeFileSync(resolve(outDir, 'icon-192.png'), makeIcon(192));
writeFileSync(resolve(outDir, 'icon-512.png'), makeIcon(512));
console.log('icons written to', outDir);
