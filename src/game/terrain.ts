// Seeded heightmaps. The simulation (crash checks) and the renderer (meshes) both call heightAt, so they always agree.
// Day 11: the noise functions below are the *base* that tools/bake-terrain.mjs erodes and bakes into a 16-bit PNG
// per map. At runtime heightAt samples the baked grid (heightfield.ts) plus a little seeded micro-relief; the
// procedural base is only the fallback while a map's PNG hasn't loaded (or in a browser that can't inflate it).
import type { GameMap } from '../data/types';
import { heightfieldFor, sampleHeightfield } from './heightfield';
import { clamp, smoothstep } from './math';
import { createRng, range } from './rng';

export const SEA_LEVEL = 0;
const SEA_FLOOR = -90;

export interface Terrain {
  readonly sizeM: number;
  readonly half: number;
  /** Ground or sea-floor height in metres at world x, z. Water surface is SEA_LEVEL. */
  heightAt(x: number, z: number): number;
  /** The surface a plane hits: the ground, or the water if the ground is below it. */
  surfaceAt(x: number, z: number): number;
  /** Nothing on this map is higher than this, so anything above it can skip surfaceAt (bullets, look-aheads). */
  readonly maxSurfaceM: number;
}

/** 2D value noise with seeded lattice hashing, smoothed. Returns roughly −1..1. */
function makeNoise(seed: number): (x: number, z: number) => number {
  const s = seed | 0;
  const hash = (ix: number, iz: number): number => {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(s, 0x27d4eb2d);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return ((h >>> 0) / 4294967295) * 2 - 1;
  };
  return (x, z) => {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uz = fz * fz * (3 - 2 * fz);
    const a = hash(ix, iz);
    const b = hash(ix + 1, iz);
    const c = hash(ix, iz + 1);
    const d = hash(ix + 1, iz + 1);
    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
  };
}

/** 2D gradient (Perlin) noise with seeded gradients: no value-noise grid in the ridges. Roughly −0.7..0.7. */
function makeGradientNoise(seed: number): (x: number, z: number) => number {
  const s = seed | 0;
  const grad = (ix: number, iz: number, fx: number, fz: number): number => {
    let h = Math.imul(ix, 1619) ^ Math.imul(iz, 31337) ^ Math.imul(s, 1013);
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    h ^= h >>> 13;
    const a = ((h >>> 0) / 4294967296) * Math.PI * 2;
    return Math.cos(a) * fx + Math.sin(a) * fz;
  };
  const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, z) => {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const u = fade(fx);
    const v = fade(fz);
    const a = grad(ix, iz, fx, fz);
    const b = grad(ix + 1, iz, fx - 1, fz);
    const c = grad(ix, iz + 1, fx, fz - 1);
    const d = grad(ix + 1, iz + 1, fx - 1, fz - 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

function fbm(noise: (x: number, z: number) => number, x: number, z: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, z * freq);
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

interface Island {
  x: number;
  z: number;
  r: number;
  peak: number;
}

/** Island Chain: a scatter of seeded islands with noisy coasts and peaks, kept clear of both spawn sides. */
function islandChain(map: GameMap): Terrain {
  const rng = createRng(map.seed);
  const noise = makeNoise(map.seed);
  const half = map.sizeM / 2;
  const islands: Island[] = [];
  const spawnClear = [map.spawns.red, map.spawns.blue];
  let attempts = 0;
  while (islands.length < 14 && attempts++ < 600) {
    const r = range(rng, 800, 2200);
    const x = range(rng, -half + r + 600, half - r - 600);
    const z = range(rng, -half + r + 600, half - r - 600);
    if (spawnClear.some((s) => Math.hypot(s[0] - x, s[2] - z) < r + 1200)) continue;
    if (islands.some((o) => Math.hypot(o.x - x, o.z - z) < (o.r + r) * 0.75)) continue;
    islands.push({ x, z, r, peak: range(rng, 140, 420) * (r / 2200 + 0.5) });
  }

  const heightAt = (x: number, z: number): number => {
    let land = 0;
    // Coast wobble pushes the shoreline in and out; detail noise adds ridges.
    const wobble = fbm(noise, x / 900 + 31.7, z / 900 - 12.3, 3) * 0.35;
    for (const isl of islands) {
      const d = Math.hypot(x - isl.x, z - isl.z) / isl.r;
      if (d >= 1.25) continue;
      const shape = smoothstep(1.05, 0.15, d + wobble);
      land = Math.max(land, shape * isl.peak);
    }
    const detail = fbm(noise, x / 420, z / 420, 4);
    const h = SEA_FLOOR + land * (1.15 + detail * 0.5) + 35 * smoothstep(0, 25, land) + detail * 18;
    return clamp(h, SEA_FLOOR - 20, 900);
  };

  return {
    sizeM: map.sizeM,
    half,
    heightAt,
    surfaceAt: (x, z) => Math.max(SEA_LEVEL, heightAt(x, z)),
    maxSurfaceM: 900,
  };
}

function openOcean(map: GameMap): Terrain {
  return {
    sizeM: map.sizeM,
    half: map.sizeM / 2,
    heightAt: () => SEA_FLOOR,
    surfaceAt: () => SEA_LEVEL,
    maxSurfaceM: SEA_LEVEL,
  };
}

/** The canyon's centreline in Mountain Valley: a meander that passes through x = 0 and ±3,500 m (the zones). */
export function canyonCentreZ(x: number): number {
  return 900 * (1 + 0.3 * Math.cos(x / 2600)) * Math.sin((Math.PI * x) / 3500) + 260 * Math.sin((2 * Math.PI * x) / 3500);
}

/** Ridged multifractal: sharp crests where the noise crosses zero, each octave weighted by the one above, so
 *  ridges branch into smaller ridges (the alpine look) instead of being uniformly bumpy. 0..~1. */
function ridged(noise: (x: number, z: number) => number, x: number, z: number, octaves: number): number {
  let sum = 0;
  let amp = 0.6;
  let freq = 1;
  let weight = 1;
  // Each octave is rotated ~37° so no two line up with the lattice.
  let px = x;
  let pz = z;
  for (let i = 0; i < octaves; i++) {
    let r = 1 - Math.abs(noise(px * freq, pz * freq) * 2.4);
    r = Math.max(0, r) ** 2;
    r *= weight;
    weight = clamp(r * 1.8, 0, 1);
    sum += r * amp;
    freq *= 2.1;
    amp *= 0.48;
    const rx = px * 0.8 - pz * 0.6;
    pz = px * 0.6 + pz * 0.8;
    px = rx + 7.3;
  }
  return sum;
}

/**
 * Mountain Valley (alpine since Day 11): ridged peaks to ~1,950 m with snow on the high ground, steep forested
 * walls and one winding canyon carved through them from west to east, deep enough to fly along below the rims,
 * with a river on its floor. The three zones sit on the canyon floor.
 */
function canyonValley(map: GameMap): Terrain {
  const noise = makeNoise(map.seed);
  const gnoise = makeGradientNoise(map.seed);
  const half = map.sizeM / 2;
  const heightAt = (x: number, z: number): number => {
    // Big ridged massifs plus branching ridges (domain-warped so they wander); a low-frequency swell keeps
    // some broad valleys between them.
    const wx = x / 4600 + 4.1 + fbm(noise, x / 5000, z / 5000, 2) * 0.45;
    const wz = z / 4600 - 7.7 + fbm(noise, x / 5000 + 9.1, z / 5000 - 3.3, 2) * 0.45;
    const massif = ridged(gnoise, wx, wz, 6);
    const swell = 0.5 + 0.5 * fbm(noise, x / 6000 - 1.3, z / 6000 + 2.9, 2);
    const r2 = 1 - Math.abs(fbm(noise, x / 900 - 2.3, z / 900 + 5.2, 3) * 1.6);
    const mountains = 340 + 1200 * clamp(massif, 0, 1.1) * (0.55 + 0.6 * swell) + 90 * clamp(r2, 0, 1) ** 2;
    // Distance to the centreline, corrected for its slope so the canyon keeps its width through the bends.
    const zc = canyonCentreZ(x);
    const slope = (canyonCentreZ(x + 5) - canyonCentreZ(x - 5)) / 10;
    const d = Math.abs(z - zc) / Math.sqrt(1 + slope * slope);
    const wobble = fbm(noise, x / 700 + 13.3, 0.5, 2) * 90;
    const floorHalf = 280 + wobble;
    const rimHalf = 820 + wobble;
    const floor = 45 + fbm(noise, x / 1500, z / 1500 + 3.3, 2) * 20;
    // Steep walls: most of the drop happens near the floor, with a ledge halfway up.
    const t = smoothstep(rimHalf, floorHalf, d);
    const wall = t < 0.5 ? smoothstep(0, 0.5, t) * 0.55 : 0.55 + smoothstep(0.62, 1, t) * 0.45;
    let h = mountains + (floor - mountains) * wall;
    // The river: a narrow channel below sea level in the middle of the floor.
    const river = smoothstep(70, 25, d);
    h = h + (-14 - h) * river;
    return clamp(h, SEA_FLOOR, 2000);
  };
  return { sizeM: map.sizeM, half, heightAt, surfaceAt: (x, z) => Math.max(SEA_LEVEL, heightAt(x, z)), maxSurfaceM: 2000 };
}

/** Desert Mesas: terraced noise. Each band of the noise becomes a flat step with a cliff up to the next, so
 *  plateaus come out flat-topped, on a desert floor around 45 m. */
function desertMesas(map: GameMap): Terrain {
  const noise = makeNoise(map.seed);
  const half = map.sizeM / 2;
  const STEP_M = 115;
  const heightAt = (x: number, z: number): number => {
    const v = fbm(noise, x / 2100 + 1.7, z / 2100 - 4.4, 4) * 1.9 + fbm(noise, x / 600, z / 600, 2) * 0.25 + 0.25;
    const level = Math.max(0, v) * 3.6;
    const k = Math.floor(level);
    const f = level - k;
    const terrace = k + smoothstep(0.8, 0.95, f);
    const dunes = fbm(noise, x / 350 - 9.1, z / 350 + 2.2, 2) * 6;
    return 45 + terrace * STEP_M + dunes;
  };
  // fbm stays inside ±1, so v < 2.4, level < 8.7 and the top terrace is 9 steps up.
  return { sizeM: map.sizeM, half, heightAt, surfaceAt: (x, z) => Math.max(SEA_LEVEL, heightAt(x, z)), maxSurfaceM: 45 + 9 * STEP_M + 6 };
}

/** The seeded noise terrain before erosion: what tools/bake-terrain.mjs starts from, and the fallback. */
export function proceduralTerrain(map: GameMap): Terrain {
  if (map.terrain === 'ocean') return openOcean(map);
  if (map.terrain === 'canyon') return canyonValley(map);
  if (map.terrain === 'mesas') return desertMesas(map);
  return islandChain(map);
}

/** Metres of seeded micro-relief added on top of the baked grid (finer than its ~31 m cells). Mesas stay flat. */
const MICRO_M: Record<GameMap['terrain'], number> = { islands: 2.5, canyon: 5, mesas: 0, ocean: 0 };

/** Builds the heightmap for a map: the baked, eroded grid if it has loaded, else the procedural base. */
export function createTerrain(map: GameMap): Terrain {
  const base = proceduralTerrain(map);
  const hf = heightfieldFor(map.id);
  if (!hf || map.terrain === 'ocean') return base;
  const noise = makeNoise(map.seed ^ 0x5eed);
  const micro = MICRO_M[map.terrain];
  const heightAt = (x: number, z: number): number => {
    const h = sampleHeightfield(hf, map.sizeM, x, z);
    // Micro-relief fades out at the waterline so beaches and the river keep their shape.
    return micro > 0 ? h + fbm(noise, x / 140, z / 140, 2) * micro * smoothstep(2, 30, h) : h;
  };
  const top = hf.maxM + micro;
  return {
    sizeM: map.sizeM,
    half: map.sizeM / 2,
    heightAt,
    surfaceAt: (x, z) => Math.max(SEA_LEVEL, heightAt(x, z)),
    maxSurfaceM: Math.ceil(top),
  };
}
