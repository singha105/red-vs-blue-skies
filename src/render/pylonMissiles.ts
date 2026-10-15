// Missiles hanging on the pylons, one InstancedMesh per weapon model (at most four draw calls for every plane
// in the match). Each plane shows as many missiles per mount as it has left, so they disappear as they're fired
// and come back on respawn. The weapon models are only downloaded for eras that have missiles.
import { DoubleSide, InstancedMesh, Matrix4, MeshLambertMaterial, Object3D, type BufferGeometry, type Mesh } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { MissileClassId, Plane } from '../data/types';
import type { PlaneState } from '../game/flight';
import { MISSILE_MODEL, pylonSlots, type PylonSlot } from '../game/planeModels';

const MODELS = [...new Set(Object.values(MISSILE_MODEL))];
/** 20 planes × 8 pylons is the most a match can show. */
const MAX_PER_MODEL = 160;

/** What's needed to hang a plane's missiles: a live plane in a match, or the hangar's parked one. */
export type Carrier = Pick<PlaneState, 'id' | 'planeId' | 'alive' | 'missiles'>;

export interface PylonMissiles {
  readonly root: Object3D;
  /** Download the weapon models (once). */
  load(): Promise<void>;
  /** Draw every live plane's remaining missiles; `rootOf` gives the plane's drawn object (or null to skip). */
  update(planes: readonly Carrier[], defs: ReadonlyMap<string, Plane>, rootOf: (p: Carrier) => Object3D | null): void;
  /** Missiles drawn last frame, in total and on one plane (tests). */
  readonly shown: number;
  shownOn(planeId: string): number;
  clear(): void;
}

export function createPylonMissiles(classOf: (missileType: string) => MissileClassId | undefined): PylonMissiles {
  const root = new Object3D();
  const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide });
  const meshes = new Map<string, InstancedMesh>();
  const slotCache = new Map<string, PylonSlot[]>();
  let loading: Promise<void> | null = null;
  let shown = 0;
  const perPlane = new Map<string, number>();
  const local = new Matrix4();
  const world = new Matrix4();

  const slotsFor = (def: Plane): PylonSlot[] => {
    let s = slotCache.get(def.id);
    if (!s) {
      s = pylonSlots(def.id, def.missiles, classOf);
      slotCache.set(def.id, s);
    }
    return s;
  };

  return {
    root,
    get shown() {
      return shown;
    },
    shownOn(planeId) {
      return perPlane.get(planeId) ?? 0;
    },
    load() {
      if (loading) return loading;
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      loading = Promise.all(
        MODELS.map((id) =>
          loader
            .loadAsync(`${import.meta.env.BASE_URL}models/weapons/${id}.glb`)
            .then((gltf) => {
              let geometry: BufferGeometry | null = null;
              gltf.scene.traverse((o) => {
                if (!geometry && (o as Mesh).isMesh) geometry = (o as Mesh).geometry;
              });
              if (!geometry) return;
              const mesh = new InstancedMesh(geometry, material, MAX_PER_MODEL);
              mesh.count = 0;
              mesh.frustumCulled = false;
              mesh.castShadow = false;
              meshes.set(id, mesh);
              root.add(mesh);
            })
            .catch((err: unknown) => console.warn(`Weapon model ${id} failed to load`, err)),
        ),
      ).then(() => undefined);
      return loading;
    },
    update(planes, defs, rootOf) {
      for (const m of meshes.values()) m.count = 0;
      shown = 0;
      perPlane.clear();
      if (meshes.size === 0) return;
      for (const p of planes) {
        if (!p.alive) continue;
        const before = shown;
        const def = defs.get(p.planeId);
        if (!def || def.missiles.length === 0) continue;
        const obj = rootOf(p);
        if (!obj) continue;
        const slots = slotsFor(def);
        const used = def.missiles.map(() => 0);
        for (const s of slots) {
          if (used[s.mount]! >= (p.missiles[s.mount] ?? 0)) continue;
          used[s.mount]!++;
          const mesh = meshes.get(s.model);
          if (!mesh || mesh.count >= MAX_PER_MODEL) continue;
          local.makeTranslation(s.pos[0], s.pos[1], s.pos[2]);
          world.multiplyMatrices(obj.matrixWorld, local);
          mesh.setMatrixAt(mesh.count++, world);
          shown++;
        }
        perPlane.set(p.id, shown - before);
      }
      for (const m of meshes.values()) m.instanceMatrix.needsUpdate = true;
    },
    clear() {
      for (const m of meshes.values()) m.count = 0;
      shown = 0;
      perPlane.clear();
    },
  };
}
