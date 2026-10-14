// Generates the PWA icons (team roundel) as PNGs with no dependencies. Run: npm run icons
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT = new URL('../public/icons/', import.meta.url);
const SKY = [22, 49, 79];
const WHITE = [244, 247, 251];
const RED = [224, 68, 58];
const BLUE = [47, 125, 225];

// Roundel: white ring around a disc split red (left) / blue (right) by a slanted seam, with a white centre.
// `scale` shrinks the artwork for maskable icons, whose outer 20% may be cropped.
function pixel(x, y, size, scale) {
  const c = size / 2;
  const dx = (x + 0.5 - c) / (c * scale);
  const dy = (y + 0.5 - c) / (c * scale);
  const r = Math.hypot(dx, dy);
  if (r > 0.92) return SKY;
  if (r > 0.78) return WHITE;
  if (r < 0.2) return WHITE;
  const seam = dx + dy * 0.35;
  if (Math.abs(seam) < 0.045) return WHITE;
  return seam < 0 ? RED : BLUE;
}

function render(size, scale, samples = 4) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const p = pixel(x + (sx + 0.5) / samples - 0.5, y + (sy + 0.5) / samples - 0.5, size, scale);
          r += p[0]; g += p[1]; b += p[2];
        }
      }
      const n = samples * samples;
      row.set([Math.round(r / n), Math.round(g / n), Math.round(b / n), 255], 1 + x * 4);
    }
    rows.push(row);
  }
  return png(size, size, Buffer.concat(rows));
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(w, h, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -50 100 100">
  <rect x="-50" y="-50" width="100" height="100" rx="18" fill="rgb(${SKY})"/>
  <circle r="46" fill="rgb(${WHITE})"/>
  <clipPath id="d"><circle r="39"/></clipPath>
  <g clip-path="url(#d)">
    <polygon points="-60,-60 2.1,-60 -2.1,60 -60,60" fill="rgb(${RED})" transform="rotate(-19.3)"/>
    <polygon points="2.1,-60 60,-60 60,60 -2.1,60" fill="rgb(${BLUE})" transform="rotate(-19.3)"/>
    <rect x="-2.25" y="-60" width="4.5" height="120" fill="rgb(${WHITE})" transform="rotate(-19.3)"/>
  </g>
  <circle r="10" fill="rgb(${WHITE})"/>
</svg>
`;

mkdirSync(OUT, { recursive: true });
const files = [
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['icon-maskable-512.png', 512, 0.72],
  ['apple-touch-icon.png', 180, 0.86],
];
for (const [name, size, scale] of files) {
  writeFileSync(new URL(name, OUT), render(size, scale));
  console.log(`wrote public/icons/${name}`);
}
writeFileSync(new URL('favicon.svg', OUT), svg);
console.log('wrote public/icons/favicon.svg');
