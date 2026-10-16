// Terrain in 2 km chunks, smooth-shaded, with four levels of detail chosen per chunk by the distance from the
// camera to the chunk's nearest point. Changing level never pops: going coarser, the chunk first morphs its
// vertices onto the coarser level's surface (uMorph 0 → 1 over MORPH_S), then swaps to that level; going finer,
// it swaps at once with uMorph = 1 and relaxes to 0. Chunk edges hang short "skirts" so neighbours at different
// levels never show a crack. Shading is in terrainMaterial.ts.
import { BufferAttribute, BufferGeometry, Group, Mesh, Vector3, type Material } from 'three';
import type { GameMap } from '../data/types';
import type { Terrain } from '../game/terrain';

export const CHUNK_M = 2000;
/** Cells per chunk side for each level: 20 m, 40 m, 80 m, 160 m (each half the one before, so morph targets
 *  line up with the next level's vertices). */
const LEVELS = [96, 48, 24, 12] as const;
/** A chunk drops to level i+1 beyond these distances (× the quality tier's lodScale). */
const LOD_DIST = [1400, 3200, 6500] as const;
const SKIRT_M = 40;
const MORPH_S = 0.6;

export interface TerrainMesh {
  group: Group;
  setLodScale(scale: number): void;
  /** Pick levels and advance morphs (call every frame with the camera position). */
  update(camera: Vector3, dt: number): void;
  /** Number of chunks that have land above water (the rest are skipped entirely). */
  chunkCount: number;
  /** Triangles drawn by the terrain this frame (for the perf overlay). */
  readonly triangles: number;
}

interface Chunk {
  x0: number;
  z0: number;
  meshes: Mesh[];
  level: number;
  /** Level being morphed toward (coarser), or −1. */
  target: number;
  morph: number;
  /** Per-chunk morph value written into the shared material just before this chunk draws. */
  uMorph: { value: number };
}

/** `materialFor` makes each chunk's material around that chunk's morph uniform (see terrainMaterial.ts). */
export function createTerrainMesh(map: GameMap, terrain: Terrain, materialFor: (uMorph: { value: number }) => Material, receiveShadow: boolean): TerrainMesh {
  const group = new Group();
  const chunks: Chunk[] = [];
  const n = Math.round(map.sizeM / CHUNK_M);
  const fine = LEVELS[0];
  const cell = CHUNK_M / fine;
  let lodScale = 1;
  let tris = 0;

  for (let cz = 0; cz < n; cz++) {
    for (let cx = 0; cx < n; cx++) {
      const x0 = -map.sizeM / 2 + cx * CHUNK_M;
      const z0 = -map.sizeM / 2 + cz * CHUNK_M;
      // Sample once at full detail (one extra ring for normals); coarser levels reuse every 2nd / 4th / 8th sample.
      const stride = fine + 3;
      const heights = new Float32Array(stride * stride);
      let top = -Infinity;
      for (let j = -1; j <= fine + 1; j++) {
        for (let i = -1; i <= fine + 1; i++) {
          const h = terrain.heightAt(x0 + i * cell, z0 + j * cell);
          heights[(j + 1) * stride + (i + 1)] = h;
          if (h > top) top = h;
        }
      }
      if (top < -2) continue; // all under the (opaque) ocean
      const chunk: Chunk = { x0, z0, meshes: [], level: LEVELS.length - 1, target: -1, morph: 0, uMorph: { value: 0 } };
      const mat = materialFor(chunk.uMorph);
      LEVELS.forEach((seg, level) => {
        const next = LEVELS[level + 1] ?? seg;
        const mesh = new Mesh(buildChunk(heights, fine, seg, next), mat);
        mesh.position.set(x0, 0, z0);
        mesh.receiveShadow = receiveShadow;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        mesh.visible = false;
        group.add(mesh);
        chunk.meshes.push(mesh);
      });
      chunks.push(chunk);
    }
  }

  const levelFor = (c: Chunk, cam: Vector3): number => {
    // Distance to the chunk's nearest point (horizontally), plus some height so high flight coarsens it.
    const dx = Math.max(c.x0 - cam.x, 0, cam.x - (c.x0 + CHUNK_M));
    const dz = Math.max(c.z0 - cam.z, 0, cam.z - (c.z0 + CHUNK_M));
    const d = Math.hypot(dx, dz, Math.max(0, cam.y - 800) * 0.6);
    let level = 0;
    while (level < LOD_DIST.length && d > LOD_DIST[level]! * lodScale) level++;
    return level;
  };

  const show = (c: Chunk): void => {
    c.meshes.forEach((m, i) => (m.visible = i === c.level));
  };
  // Start every chunk at its coarsest level until the first update.
  for (const c of chunks) show(c);

  return {
    group,
    chunkCount: chunks.length,
    get triangles() {
      return tris;
    },
    setLodScale(scale) {
      lodScale = scale;
    },
    update(cam, dt) {
      tris = 0;
      for (const c of chunks) {
        const want = levelFor(c, cam);
        if (c.target >= 0) {
          // Morphing toward a coarser level: finish, then swap.
          if (want <= c.level) {
            c.target = -1; // changed our mind: relax back
          } else {
            c.morph = Math.min(1, c.morph + dt / MORPH_S);
            if (c.morph >= 1) {
              c.level = c.target;
              c.target = -1;
              c.morph = 0;
              show(c);
            }
          }
        } else if (want > c.level) {
          c.target = c.level + 1;
        } else if (want < c.level) {
          // Finer: swap now, starting fully morphed onto the coarser shape we were showing.
          c.level = want === c.level - 1 ? c.level - 1 : want;
          c.morph = 1;
          show(c);
        } else if (c.morph > 0) {
          c.morph = Math.max(0, c.morph - dt / MORPH_S);
        }
        c.uMorph.value = c.morph;
        const seg = LEVELS[c.level]!;
        tris += seg * seg * 2;
      }
    },
  };
}

/**
 * One level's indexed grid. `heights` is the full-detail grid with a one-sample border; `next` is the coarser
 * level's segment count, used for each vertex's morph target (the coarser surface's height at that point).
 */
function buildChunk(heights: Float32Array, fine: number, seg: number, next: number): BufferGeometry {
  const stride = fine + 3;
  const step = fine / seg;
  const cell = CHUNK_M / seg;
  const H = (i: number, j: number): number => heights[(j + 1) * stride + (i + 1)]!;
  const verts = (seg + 1) * (seg + 1);
  const skirtVerts = seg * 4 * 2;
  const pos = new Float32Array((verts + skirtVerts) * 3);
  const nor = new Float32Array((verts + skirtVerts) * 3);
  const morph = new Float32Array(verts + skirtVerts);
  const nstep = fine / next;
  const coarseAt = (fi: number, fj: number): number => {
    // Bilinear on the coarser grid (in fine-sample units), matching how its triangles would cover this point.
    const gi = Math.min(next - 1e-6, fi / nstep);
    const gj = Math.min(next - 1e-6, fj / nstep);
    const i0 = Math.floor(gi), j0 = Math.floor(gj);
    const u = gi - i0, v = gj - j0;
    const a = H(i0 * nstep, j0 * nstep), b = H((i0 + 1) * nstep, j0 * nstep);
    const c = H(i0 * nstep, (j0 + 1) * nstep), d = H((i0 + 1) * nstep, (j0 + 1) * nstep);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
  for (let j = 0; j <= seg; j++) {
    for (let i = 0; i <= seg; i++) {
      const fi = Math.round(i * step), fj = Math.round(j * step);
      const k = j * (seg + 1) + i;
      const h = H(fi, fj);
      pos[k * 3] = i * cell;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = j * cell;
      morph[k] = next === seg ? h : coarseAt(fi, fj);
      // Smooth normal from the full-detail neighbours one sample away (the border ring makes chunk edges match).
      const nx = H(fi - 1, fj) - H(fi + 1, fj);
      const nz = H(fi, fj - 1) - H(fi, fj + 1);
      const ny = 2 * (CHUNK_M / fine);
      const l = Math.hypot(nx, ny, nz);
      nor[k * 3] = nx / l;
      nor[k * 3 + 1] = ny / l;
      nor[k * 3 + 2] = nz / l;
    }
  }
  const index: number[] = [];
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
      // Alternate the diagonal for a less gridded look. Counter-clockwise seen from above.
      if ((i + j) % 2 === 0) index.push(a, c, d, a, d, b);
      else index.push(a, c, b, b, c, d);
    }
  }
  // Skirts: a copy of each edge vertex hanging SKIRT_M lower, stitched to the edge.
  let v = verts;
  const edge = (k: number): number => {
    pos[v * 3] = pos[k * 3]!;
    pos[v * 3 + 1] = pos[k * 3 + 1]! - SKIRT_M;
    pos[v * 3 + 2] = pos[k * 3 + 2]!;
    nor.set([nor[k * 3]!, nor[k * 3 + 1]!, nor[k * 3 + 2]!], v * 3);
    morph[v] = morph[k]! - SKIRT_M;
    return v++;
  };
  const sides: [number, number][][] = [[], [], [], []];
  for (let i = 0; i < seg; i++) {
    sides[0]!.push([i, i + 1]); // z = 0
    sides[1]!.push([seg * (seg + 1) + i + 1, seg * (seg + 1) + i]); // z = max
    sides[2]!.push([(i + 1) * (seg + 1), i * (seg + 1)]); // x = 0
    sides[3]!.push([i * (seg + 1) + seg, (i + 1) * (seg + 1) + seg]); // x = max
  }
  for (const side of sides) {
    for (const [a, b] of side) {
      const a2 = edge(a);
      const b2 = edge(b);
      index.push(a, b, a2, b, b2, a2);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new BufferAttribute(nor, 3));
  geometry.setAttribute('morphY', new BufferAttribute(morph, 1));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  // Morphing can lift vertices a little: pad the bounds so frustum culling never clips a chunk.
  if (geometry.boundingSphere) geometry.boundingSphere.radius += 80;
  return geometry;
}
