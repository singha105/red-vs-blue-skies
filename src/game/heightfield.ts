// Baked heightmaps (Day 11): each land map's terrain is generated at build time (tools/bake-terrain.mjs: the
// seeded noise below in terrain.ts plus a hydraulic-erosion pass) and shipped as a 16-bit greyscale PNG in
// public/terrain/. The game, the host and the tests all sample the same grid, so the simulation and the
// renderer agree everywhere. No DOM or Three.js here: decoding takes already-inflated bytes.
import heightfields from '../data/heightfields.json';

export interface HeightfieldMeta {
  /** Samples per side (the grid covers the whole map, edge to edge). */
  res: number;
  /** Heights are stored as 0..65535 between these. */
  minM: number;
  maxM: number;
  /** File under public/ (BASE_URL-relative). */
  file: string;
}

export interface Heightfield extends HeightfieldMeta {
  data: Uint16Array;
}

export const HEIGHTFIELDS = heightfields as Record<string, HeightfieldMeta>;

const loaded = new Map<string, Heightfield>();

export function registerHeightfield(mapId: string, hf: Heightfield): void {
  if (hf.data.length !== hf.res * hf.res) throw new Error(`heightfield ${mapId}: ${hf.data.length} samples, expected ${hf.res * hf.res}`);
  loaded.set(mapId, hf);
}

export const heightfieldFor = (mapId: string): Heightfield | undefined => loaded.get(mapId);
export const hasBakedTerrain = (mapId: string): boolean => mapId in HEIGHTFIELDS;

/** Bilinear height at world x, z on a map `sizeM` across (clamped at the edges). */
export function sampleHeightfield(hf: Heightfield, sizeM: number, x: number, z: number): number {
  const n = hf.res - 1;
  const fx = Math.min(n, Math.max(0, ((x / sizeM) + 0.5) * n));
  const fz = Math.min(n, Math.max(0, ((z / sizeM) + 0.5) * n));
  const ix = Math.min(n - 1, Math.floor(fx));
  const iz = Math.min(n - 1, Math.floor(fz));
  const tx = fx - ix;
  const tz = fz - iz;
  const d = hf.data;
  const r = hf.res;
  const a = d[iz * r + ix]!;
  const b = d[iz * r + ix + 1]!;
  const c = d[(iz + 1) * r + ix]!;
  const e = d[(iz + 1) * r + ix + 1]!;
  const v = (a + (b - a) * tx) * (1 - tz) + (c + (e - c) * tx) * tz;
  return hf.minM + (v / 65535) * (hf.maxM - hf.minM);
}

/** Reads the IHDR and joins the IDAT chunks of a PNG (16-bit greyscale only): returns the zlib stream to inflate. */
export function pngZlib(png: Uint8Array): { width: number; height: number; zlib: Uint8Array } {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!sig.every((b, i) => png[i] === b)) throw new Error('not a PNG');
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let o = 8;
  let width = 0;
  let height = 0;
  const parts: Uint8Array[] = [];
  while (o < png.length) {
    const len = view.getUint32(o);
    const type = String.fromCharCode(png[o + 4]!, png[o + 5]!, png[o + 6]!, png[o + 7]!);
    const body = png.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      width = view.getUint32(o + 8);
      height = view.getUint32(o + 12);
      if (body[8] !== 16 || body[9] !== 0 || body[12] !== 0) throw new Error('heightmap PNGs must be 16-bit greyscale, not interlaced');
    } else if (type === 'IDAT') parts.push(body);
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  const zlib = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let k = 0;
  for (const p of parts) {
    zlib.set(p, k);
    k += p.length;
  }
  return { width, height, zlib };
}

/** Undoes the PNG scanline filters of inflated 16-bit greyscale data (2 bytes per pixel) into samples. */
export function unfilter16(raw: Uint8Array, width: number, height: number): Uint16Array {
  const bpp = 2;
  const stride = width * bpp;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i]!;
      const a = i >= bpp ? out[dst + i - bpp]! : 0;
      const b = y > 0 ? out[dst - stride + i]! : 0;
      const c = i >= bpp && y > 0 ? out[dst - stride + i - bpp]! : 0;
      let v: number;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[dst + i] = v & 255;
    }
  }
  const samples = new Uint16Array(width * height);
  for (let i = 0; i < samples.length; i++) samples[i] = (out[i * 2]! << 8) | out[i * 2 + 1]!;
  return samples;
}
