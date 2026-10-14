// Seeded heightmaps. The simulation (crash checks) and the renderer (meshes) both call heightAt, so they always agree.
import type { GameMap } from '../data/types';
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
  };
}

function openOcean(map: GameMap): Terrain {
  return {
    sizeM: map.sizeM,
    half: map.sizeM / 2,
    heightAt: () => SEA_FLOOR,
    surfaceAt: () => SEA_LEVEL,
  };
}

/** Builds the heightmap for a map. Canyon and mesa generators arrive on Day 9; until then they use islands. */
export function createTerrain(map: GameMap): Terrain {
  if (map.terrain === 'ocean') return openOcean(map);
  return islandChain(map);
}
