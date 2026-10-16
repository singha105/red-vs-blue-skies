// Distant mountain ranges (Day 11): a ring of low-detail ridges from just outside the map out to 45 km, so the
// horizon never ends in a flat edge. They're drawn first, in a backdrop pass with its own far plane (the main
// camera's far plane is 7–14 km), then the depth buffer is cleared and the map draws over them. Heavy haze turns
// them lighter and bluer with distance (the same exponential fog colour as the map).
import { BufferAttribute, BufferGeometry, Color, Mesh, MeshLambertMaterial } from 'three';
import type { GameMap } from '../data/types';

const INNER_M = 8200;
const OUTER_M = 45000;
const RINGS = 28;
const SEGMENTS = 160;

function hash(x: number, s: number): number {
  let h = Math.imul(x | 0, 2654435761) ^ Math.imul(s, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}
function noise1(x: number, s: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(i, s) * (1 - u) + hash(i + 1, s) * u;
}

/** Ridge height along the ring: angle in turns (0..1, wraps) and radius, 0..1. */
function ridge(turn: number, r: number, seed: number): number {
  let sum = 0;
  let amp = 0.6;
  for (let o = 0; o < 5; o++) {
    const f = 8 * 2 ** o;
    // Wrap the angle so the ring closes; mix in radius so ranges recede in layers.
    const v = 1 - Math.abs(noise1(turn * f + r * 0.00012 * f, seed + o) * 2 - 1);
    sum += v * v * amp;
    amp *= 0.5;
  }
  return sum;
}

export function createHorizon(map: GameMap, haze: Color): Mesh | null {
  if (map.horizonRangeM <= 0) return null;
  const pos: number[] = [];
  const col: number[] = [];
  const rock = new Color(map.colors.rock);
  const forest = new Color(map.forestColor);
  const snow = new Color('#eef3f7');
  const sand = new Color(map.colors.sand);
  const tmp = new Color();
  for (let j = 0; j <= RINGS; j++) {
    // Rings closer together near the map, wider far away.
    const t = j / RINGS;
    const r = INNER_M + (OUTER_M - INNER_M) * t * t;
    for (let i = 0; i <= SEGMENTS; i++) {
      const turn = i / SEGMENTS;
      const a = turn * Math.PI * 2;
      // Rising from below the map's edge to full height a few km out; taller farther away (more ranges stacked).
      // Mountain maps are ringed by more mountains from the very edge; island maps by sea and far islands.
      // Land maps carry on as land (the alpine valley into more mountains, the mesas into more desert);
      // the island map into sea with far islands.
      const land = map.terrain === 'canyon' ? 380 : map.terrain === 'mesas' ? 45 : null;
      const rise = Math.min(1, Math.max(0, (r - INNER_M) / (land !== null ? 1500 : 6000)));
      const h = land !== null
        ? land + map.horizonRangeM * (0.3 + 0.7 * t) * ridge(turn, r, map.seed) * rise
        : map.horizonRangeM * (0.3 + 0.7 * t) * ridge(turn, r, map.seed) * rise - 120 * (1 - rise) - 60 * rise;
      pos.push(Math.sin(a) * r, h, Math.cos(a) * r);
      const k = (h - (land ?? 0)) / Math.max(1, map.horizonRangeM);
      const desert = map.terrain === 'mesas';
      // Far ranges are already pale and blue before the fog adds more (aerial perspective).
      tmp.copy(desert ? (k > 0.25 ? rock : sand) : k > 0.55 ? snow : k > 0.3 ? rock : forest).lerp(haze, 0.45 + 0.4 * t);
      col.push(tmp.r, tmp.g, tmp.b);
    }
  }
  const index: number[] = [];
  for (let j = 0; j < RINGS; j++) {
    for (let i = 0; i < SEGMENTS; i++) {
      const a = j * (SEGMENTS + 1) + i;
      const b = a + 1;
      const c = a + SEGMENTS + 1;
      const d = c + 1;
      index.push(a, b, c, b, d, c);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(index);
  g.computeVertexNormals();
  // Lambert: it's hazed and far away, per-pixel PBR would be wasted on it.
  const mesh = new Mesh(g, new MeshLambertMaterial({ vertexColors: true }));
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/**
 * The whole map at 250 m resolution, vertex-coloured like the terrain shader's palette, in the backdrop pass:
 * beyond the main camera's far plane (7 km on Low) the map carries on into the haze instead of ending.
 */
export function createFarTerrain(map: GameMap, terrain: { heightAt(x: number, z: number): number }): Mesh | null {
  if (map.terrain === 'ocean') return null;
  const n = 64;
  const cell = map.sizeM / n;
  const pos: number[] = [];
  const col: number[] = [];
  const grass = new Color(map.colors.grass);
  const forest = new Color(map.forestColor);
  const rock = new Color(map.colors.rock);
  const sand = new Color(map.colors.sand);
  const snow = new Color('#eef3f7');
  const tmp = new Color();
  const h = (i: number, j: number): number => terrain.heightAt(-map.sizeM / 2 + i * cell, -map.sizeM / 2 + j * cell);
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const y = h(i, j);
      // Sunk a little so the real terrain always wins where both are drawn (they're in different passes anyway).
      pos.push(-map.sizeM / 2 + i * cell, y - 25, -map.sizeM / 2 + j * cell);
      const slope = Math.hypot(h(Math.min(n, i + 1), j) - h(Math.max(0, i - 1), j), h(i, Math.min(n, j + 1)) - h(i, Math.max(0, j - 1))) / (2 * cell);
      if (y < 12) tmp.copy(sand);
      else if (y > map.snowLineM && slope < 0.9) tmp.copy(snow);
      else if (slope > 0.75) tmp.copy(rock);
      else tmp.copy(forest).lerp(grass, 0.35);
      col.push(tmp.r, tmp.g, tmp.b);
    }
  }
  const index: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
      index.push(a, c, d, a, d, b);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(index);
  g.computeVertexNormals();
  // Only beyond the main camera's far plane does this copy show; nearer pixels are the real terrain's, so skip
  // shading them (uNear follows the quality tier's draw distance).
  const material = new MeshLambertMaterial({ vertexColors: true });
  const uNear = { value: 7000 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms['uNear'] = uNear;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFarPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvFarPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFarPos;\nuniform float uNear;')
      .replace('void main() {', 'void main() {\n  if (distance(vFarPos, cameraPosition) < uNear) discard;');
  };
  const mesh = new Mesh(g, material);
  mesh.userData['uNear'] = uNear;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}
