// Bakes each land map's heightmap: the seeded noise base from src/game/terrain.ts (bundled with rolldown so this
// script runs the exact game code), then a droplet hydraulic-erosion pass (after Hans Theobald Beyer's
// "Implementation of a method for hydraulic erosion" and Sebastian Lague's write-up of it), written as a 16-bit
// greyscale PNG to public/terrain/<map>.png plus src/data/heightfields.json (resolution and height range).
//
//   npm run terrain                 bake every land map
//   npm run terrain -- mountain_valley
//
// Deterministic: the droplets come from a seeded RNG, so a rebake with the same code gives the same files.
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const root = new URL('../', import.meta.url);
const only = process.argv.slice(2);
mkdirSync(new URL('tools/build/', root), { recursive: true });
mkdirSync(new URL('public/terrain/', root), { recursive: true });
// The game's terrain code, bundled to plain JS (its heightfield.json import is empty for the base).
execSync('npx rolldown src/game/terrain.ts --format esm --file tools/build/terrain-bake.mjs --log-level warn', { cwd: root, stdio: 'inherit' });
const { proceduralTerrain } = await import(new URL('tools/build/terrain-bake.mjs', root).href + `?t=${Date.now()}`);
const maps = JSON.parse(readFileSync(new URL('src/data/maps.json', root), 'utf8'));

/** Per terrain kind: samples per side, droplets per cell, erosion strength, how many thermal (talus) passes. */
const SETTINGS = {
  canyon: { res: 1025, droplets: 1.1, erode: 0.3, deposit: 0.3, talus: 4 },
  islands: { res: 513, droplets: 0.8, erode: 0.3, deposit: 0.3, talus: 1 },
  mesas: { res: 513, droplets: 0.25, erode: 0.12, deposit: 0.15, talus: 0 },
};
/** Heights are eroded in units of this many metres (so slopes per cell look like the classic 0..1 maps). */
const UNIT_M = 1500;

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

function erode(h, n, cfg, seed) {
  const P = { inertia: 0.05, capacity: 4, minCapacity: 0.01, deposit: cfg.deposit, erode: cfg.erode, evaporate: 0.015, gravity: 4, life: 40, radius: 3 };
  // Brush: weights for every cell within the radius, normalised.
  const brush = [];
  let wsum = 0;
  for (let dy = -P.radius; dy <= P.radius; dy++) {
    for (let dx = -P.radius; dx <= P.radius; dx++) {
      const d = Math.hypot(dx, dy);
      if (d <= P.radius) {
        const w = 1 - d / P.radius;
        brush.push([dx, dy, w]);
        wsum += w;
      }
    }
  }
  for (const b of brush) b[2] /= wsum;
  const heightGrad = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const u = x - ix, v = y - iy;
    const i = iy * n + ix;
    const a = h[i], b = h[i + 1], c = h[i + n], d = h[i + n + 1];
    return { height: a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v, gx: (b - a) * (1 - v) + (d - c) * v, gy: (c - a) * (1 - u) + (d - b) * u };
  };
  const random = rng(seed);
  const count = Math.round(cfg.droplets * n * n);
  for (let k = 0; k < count; k++) {
    let x = random() * (n - 2), y = random() * (n - 2);
    let dx = 0, dy = 0, speed = 1, water = 1, sediment = 0;
    for (let life = 0; life < P.life; life++) {
      const ix = Math.floor(x), iy = Math.floor(y);
      const u = x - ix, v = y - iy;
      const hg = heightGrad(x, y);
      dx = dx * P.inertia - hg.gx * (1 - P.inertia);
      dy = dy * P.inertia - hg.gy * (1 - P.inertia);
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) break;
      dx /= len;
      dy /= len;
      x += dx;
      y += dy;
      if (x < 1 || y < 1 || x >= n - 2 || y >= n - 2) break;
      const dh = heightGrad(x, y).height - hg.height;
      const capacity = Math.max(-dh * speed * water * P.capacity, P.minCapacity);
      const i = iy * n + ix;
      if (sediment > capacity || dh > 0) {
        const amount = dh > 0 ? Math.min(dh, sediment) : (sediment - capacity) * P.deposit;
        sediment -= amount;
        h[i] += amount * (1 - u) * (1 - v);
        h[i + 1] += amount * u * (1 - v);
        h[i + n] += amount * (1 - u) * v;
        h[i + n + 1] += amount * u * v;
      } else {
        const amount = Math.min((capacity - sediment) * P.erode, -dh);
        for (const [bx, by, w] of brush) {
          const cx = ix + bx, cy = iy + by;
          if (cx < 0 || cy < 0 || cx >= n || cy >= n) continue;
          const j = cy * n + cx;
          const take = Math.min(h[j], amount * w);
          h[j] -= take;
          sediment += take;
        }
      }
      speed = Math.sqrt(Math.max(0, speed * speed - dh * P.gravity));
      water *= 1 - P.evaporate;
    }
  }
}

/** Thermal erosion: material slides off slopes steeper than the talus angle (softens knife-edge noise ridges). */
function talus(h, n, passes) {
  // At most a 0.8 rise per cell (~39°); steeper faces slump a quarter of the excess per pass.
  const limit = 0.8;
  for (let p = 0; p < passes; p++) {
    for (let y = 1; y < n - 1; y++) {
      for (let x = 1; x < n - 1; x++) {
        const i = y * n + x;
        for (const j of [i + 1, i + n]) {
          const d = h[i] - h[j];
          const max = (limit * cellM) / UNIT_M;
          if (Math.abs(d) > max) {
            const move = (Math.abs(d) - max) * 0.25 * Math.sign(d);
            h[i] -= move;
            h[j] += move;
          }
        }
      }
    }
  }
}

let cellM = 0;
function png16(data, n) {
  // Per row, pick the filter that leaves the smallest sum of bytes (standard heuristic): ~30% smaller files.
  const stride = n * 2;
  const bytes = new Uint8Array(stride * n);
  for (let i = 0; i < data.length; i++) {
    bytes[i * 2] = data[i] >> 8;
    bytes[i * 2 + 1] = data[i] & 255;
  }
  const raw = Buffer.alloc((stride + 1) * n);
  const row = new Uint8Array(stride);
  for (let y = 0; y < n; y++) {
    const cur = bytes.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? bytes.subarray((y - 1) * stride, y * stride) : null;
    let best = null;
    let bestScore = Infinity;
    for (let f = 0; f <= 4; f++) {
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= 2 ? cur[i - 2] : 0, b = prev ? prev[i] : 0, c = prev && i >= 2 ? prev[i - 2] : 0;
        let pred = 0;
        if (f === 1) pred = a;
        else if (f === 2) pred = b;
        else if (f === 3) pred = (a + b) >> 1;
        else if (f === 4) {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        row[i] = (cur[i] - pred) & 255;
        score += row[i] < 128 ? row[i] : 256 - row[i];
      }
      if (score < bestScore) {
        bestScore = score;
        best = [f, Uint8Array.from(row)];
      }
    }
    raw[y * (stride + 1)] = best[0];
    raw.set(best[1], y * (stride + 1) + 1);
  }
  const crcTable = new Uint32Array(256).map((_, k) => {
    let c = k;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, body) => {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, 'ascii');
    Buffer.from(body).copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0);
  ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 16; // bit depth
  ihdr[9] = 0; // greyscale
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const metaFile = new URL('src/data/heightfields.json', root);
const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
for (const map of maps) {
  const cfg = SETTINGS[map.terrain];
  if (!cfg || (only.length && !only.includes(map.id))) continue;
  const t0 = Date.now();
  const n = cfg.res;
  cellM = map.sizeM / (n - 1);
  const base = proceduralTerrain(map);
  const h = new Float64Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) h[y * n + x] = base.heightAt((x / (n - 1) - 0.5) * map.sizeM, (y / (n - 1) - 0.5) * map.sizeM) / UNIT_M;
  // Droplets work on land above the sea floor; the flat sea floor stays put (it's under opaque water).
  let floor = Infinity;
  for (const v of h) floor = Math.min(floor, v);
  for (let i = 0; i < h.length; i++) h[i] -= floor;
  erode(h, n, cfg, map.seed);
  talus(h, n, cfg.talus);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < h.length; i++) {
    h[i] = (h[i] + floor) * UNIT_M;
    lo = Math.min(lo, h[i]);
    hi = Math.max(hi, h[i]);
  }
  const minM = Math.floor(lo), maxM = Math.ceil(hi);
  const q = new Uint16Array(n * n);
  for (let i = 0; i < h.length; i++) q[i] = Math.round(((h[i] - minM) / (maxM - minM)) * 65535);
  const file = `terrain/${map.id}.png`;
  const png = png16(q, n);
  writeFileSync(new URL(`public/${file}`, root), png);
  meta[map.id] = { res: n, minM, maxM, file };
  console.log(`${map.id}: ${n}×${n}, ${minM}..${maxM} m, ${(png.length / 1024).toFixed(0)} KB, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
