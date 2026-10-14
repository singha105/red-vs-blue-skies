// Flat-shaded low-poly terrain in 2 km chunks, each with three levels of detail (THREE.LOD picks by distance).
// Chunk edges get short "skirts" hanging down so cracks between neighbouring detail levels are never visible.
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Group, LOD, Mesh, MeshLambertMaterial } from 'three';
import type { GameMap } from '../data/types';
import type { Terrain } from '../game/terrain';

export const CHUNK_M = 2000;
const SEGMENTS = [40, 20, 10] as const; // 50 m, 100 m, 200 m cells
const LOD_DIST = [0, 2600, 5200] as const;
const SKIRT_M = 60;

export interface TerrainMesh {
  group: Group;
  setLodScale(scale: number): void;
  /** Number of chunks that have land above water (the rest are skipped entirely). */
  chunkCount: number;
}

export function createTerrainMesh(map: GameMap, terrain: Terrain, receiveShadow: boolean): TerrainMesh {
  const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide });
  const palette = {
    sand: new Color(map.colors.sand),
    grass: new Color(map.colors.grass),
    grassDark: new Color(map.colors.grass).multiplyScalar(0.72),
    rock: new Color(map.colors.rock),
    snow: new Color('#eef2f4'),
    seabed: new Color(map.colors.sand).multiplyScalar(0.55),
  };

  const group = new Group();
  const lods: LOD[] = [];
  const n = Math.round(map.sizeM / CHUNK_M);
  const maxSeg = SEGMENTS[0];
  const cell = CHUNK_M / maxSeg;

  for (let cz = 0; cz < n; cz++) {
    for (let cx = 0; cx < n; cx++) {
      const x0 = -map.sizeM / 2 + cx * CHUNK_M;
      const z0 = -map.sizeM / 2 + cz * CHUNK_M;
      // Sample once at full detail; coarser levels reuse every 2nd / 4th sample.
      const heights = new Float32Array((maxSeg + 1) * (maxSeg + 1));
      let top = -Infinity;
      for (let j = 0; j <= maxSeg; j++) {
        for (let i = 0; i <= maxSeg; i++) {
          const h = terrain.heightAt(x0 + i * cell, z0 + j * cell);
          heights[j * (maxSeg + 1) + i] = h;
          if (h > top) top = h;
        }
      }
      if (top < -2) continue; // all under the (opaque) ocean

      const lod = new LOD();
      lod.position.set(x0, 0, z0);
      SEGMENTS.forEach((seg, level) => {
        const mesh = new Mesh(buildChunk(heights, maxSeg, seg, palette), material);
        mesh.receiveShadow = receiveShadow;
        mesh.matrixAutoUpdate = false;
        lod.addLevel(mesh, LOD_DIST[level]);
      });
      lod.matrixAutoUpdate = false;
      lod.updateMatrix();
      group.add(lod);
      lods.push(lod);
    }
  }

  return {
    group,
    chunkCount: lods.length,
    setLodScale(scale) {
      for (const lod of lods) {
        lod.levels.forEach((level, i) => {
          level.distance = (LOD_DIST[i] ?? 0) * scale;
        });
      }
    },
  };
}

type Palette = Record<'sand' | 'grass' | 'grassDark' | 'rock' | 'snow' | 'seabed', Color>;

function buildChunk(heights: Float32Array, maxSeg: number, seg: number, pal: Palette): BufferGeometry {
  const step = maxSeg / seg;
  const cell = CHUNK_M / seg;
  const stride = maxSeg + 1;
  const h = (i: number, j: number): number => heights[j * step * stride + i * step]!;

  const tris = seg * seg * 2 + seg * 4 * 2;
  const pos = new Float32Array(tris * 9);
  const col = new Float32Array(tris * 9);
  let v = 0;
  const tmp = new Color();

  const pushTri = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, c: Color): void => {
    pos.set([ax, ay, az, bx, by, bz, cx, cy, cz], v * 3);
    for (let k = 0; k < 3; k++) c.toArray(col, (v + k) * 3);
    v += 3;
  };

  const colourFor = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): Color => {
    // Face normal's y tells how steep the face is.
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const wx = cx - ax, wy = cy - ay, wz = cz - az;
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const steep = Math.abs(ny) / Math.hypot(nx, ny, nz);
    const y = (ay + by + cy) / 3;
    if (y < -4) return tmp.copy(pal.seabed);
    if (y < 14) return tmp.copy(pal.sand);
    if (y > 560) return tmp.copy(steep > 0.8 ? pal.snow : pal.rock);
    if (steep < 0.78 || y > 340) return tmp.copy(pal.rock);
    // Grass darkens with height, with a little per-face variation (deterministic from position).
    const t = Math.min(1, y / 340);
    tmp.copy(pal.grass).lerp(pal.grassDark, t);
    return tmp.offsetHSL(0, 0, (Math.sin(ax * 12.9898 + az * 78.233) * 0.5) * 0.04);
  };

  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const x0 = i * cell, x1 = x0 + cell, z0 = j * cell, z1 = z0 + cell;
      const h00 = h(i, j), h10 = h(i + 1, j), h01 = h(i, j + 1), h11 = h(i + 1, j + 1);
      // Alternate the diagonal for a less gridded look. Winding is counter-clockwise seen from above.
      if ((i + j) % 2 === 0) {
        pushTri(x0, h00, z0, x0, h01, z1, x1, h11, z1, colourFor(x0, h00, z0, x0, h01, z1, x1, h11, z1));
        pushTri(x0, h00, z0, x1, h11, z1, x1, h10, z0, colourFor(x0, h00, z0, x1, h11, z1, x1, h10, z0));
      } else {
        pushTri(x0, h00, z0, x0, h01, z1, x1, h10, z0, colourFor(x0, h00, z0, x0, h01, z1, x1, h10, z0));
        pushTri(x1, h10, z0, x0, h01, z1, x1, h11, z1, colourFor(x1, h10, z0, x0, h01, z1, x1, h11, z1));
      }
    }
  }

  // Skirts along the four edges.
  const skirt = (ax: number, az: number, ah: number, bx: number, bz: number, bh: number): void => {
    pushTri(ax, ah, az, bx, bh, bz, ax, ah - SKIRT_M, az, pal.rock);
    pushTri(bx, bh, bz, bx, bh - SKIRT_M, bz, ax, ah - SKIRT_M, az, pal.rock);
  };
  for (let i = 0; i < seg; i++) {
    const a = i * cell, b = a + cell;
    skirt(a, 0, h(i, 0), b, 0, h(i + 1, 0));
    skirt(b, CHUNK_M, h(i + 1, seg), a, CHUNK_M, h(i, seg));
    skirt(0, b, h(0, i + 1), 0, a, h(0, i));
    skirt(CHUNK_M, a, h(seg, i), CHUNK_M, b, h(seg, i + 1));
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(pos, 3));
  geometry.setAttribute('color', new BufferAttribute(col, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
