// Low-poly clouds: one InstancedMesh (one draw call) of squashed icosahedron puffs, grouped into seeded clusters.
import { IcosahedronGeometry, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3 } from 'three';
import type { GameMap } from '../data/types';
import { createRng, range } from '../game/rng';

const MAX_CLUSTERS = 150;
const PUFFS_PER_CLUSTER = 4;

export interface Clouds {
  mesh: InstancedMesh;
  setCount(clusters: number): void;
}

export function createClouds(map: GameMap): Clouds {
  const geometry = new IcosahedronGeometry(1, 1);
  const material = new MeshLambertMaterial({ color: 0xffffff, emissive: 0x9fb4c8, emissiveIntensity: 0.35, flatShading: true });
  const mesh = new InstancedMesh(geometry, material, MAX_CLUSTERS * PUFFS_PER_CLUSTER);
  const rng = createRng(map.seed ^ 0x51ed);
  const m = new Matrix4();
  const q = new Quaternion();
  const s = new Vector3();
  const p = new Vector3();
  const reach = map.sizeM * 0.65;
  for (let c = 0; c < MAX_CLUSTERS; c++) {
    const cx = range(rng, -reach, reach);
    const cz = range(rng, -reach, reach);
    const cy = range(rng, 1300, 2600);
    const size = range(rng, 160, 420);
    for (let k = 0; k < PUFFS_PER_CLUSTER; k++) {
      p.set(cx + range(rng, -1, 1) * size * 1.2, cy + range(rng, -0.2, 0.3) * size * 0.4, cz + range(rng, -1, 1) * size * 0.8);
      s.set(size * range(rng, 0.7, 1.2), size * range(rng, 0.35, 0.55), size * range(rng, 0.6, 1));
      q.setFromAxisAngle(new Vector3(0, 1, 0), rng() * Math.PI);
      m.compose(p, q, s);
      mesh.setMatrixAt(c * PUFFS_PER_CLUSTER + k, m);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  // Instances are spread over the whole map; skip per-frame culling of the bounding sphere.
  mesh.frustumCulled = false;
  return {
    mesh,
    setCount(clusters) {
      mesh.count = Math.max(0, Math.min(MAX_CLUSTERS, clusters)) * PUFFS_PER_CLUSTER;
    },
  };
}
