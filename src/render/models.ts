// Plane models: GLTFLoader + meshopt decoder, loaded per era on demand, tinted per team.
// Until a model has loaded (or if a plane has no model yet) callers get the box placeholder.
import { Color, DoubleSide, Group, Mesh, MeshLambertMaterial, Object3D, type Material } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { EraId } from '../data/types';
import type { Team } from '../game/flight';
import { PLANE_MODELS } from '../game/planeModels';
import { createPlaceholderPlane, onTeamPalette, TEAM_COLOURS } from './planeMesh';

export interface PlaneVisual {
  root: Object3D;
  /** Spins with throttle (prop planes only). */
  prop: Object3D | null;
  muzzles: Object3D[];
  exhausts: Object3D[];
  placeholder: boolean;
}

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const templates = new Map<string, Group>();
const pending = new Map<string, Promise<void>>();
const failed = new Set<string>();
// One Lambert material per original material per team, shared by every plane using that model.
const materialCache = new Map<string, Material>();
// Settings → Team colours repaints every cached TEAM material in place.
onTeamPalette(() => {
  for (const [key, m] of materialCache) {
    const team = key.split('|')[2] as Team;
    if (m.name === 'TEAM' && m instanceof MeshLambertMaterial) m.color.setHex(TEAM_COLOURS[team]);
  }
});

function lambertFor(planeId: string, src: Material, team: Team): Material {
  const name = src.name || 'BODY';
  const key = `${planeId}|${name}|${team}`;
  const cached = materialCache.get(key);
  if (cached) return cached;
  const m = new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide });
  m.name = name;
  if (name === 'TEAM') m.color = new Color(TEAM_COLOURS[team]);
  if (name === 'GLASS') m.emissive = new Color(0x1d3346);
  materialCache.set(key, m);
  return m;
}

/** Starts loading one plane's model (no-op if there is none or it is already loaded). */
export function loadPlane(planeId: string): Promise<void> {
  const info = PLANE_MODELS[planeId];
  if (!info || templates.has(planeId) || failed.has(planeId)) return Promise.resolve();
  let p = pending.get(planeId);
  if (!p) {
    p = loader
      .loadAsync(`${import.meta.env.BASE_URL}${info.file}`)
      .then((gltf) => {
        templates.set(planeId, gltf.scene);
      })
      .catch((err: unknown) => {
        failed.add(planeId);
        console.warn(`Model for ${planeId} failed to load; using the placeholder`, err);
      });
    pending.set(planeId, p);
  }
  return p;
}

/** Loads every model of one era: only the era being played is downloaded. */
export function loadEra(era: EraId, planeIds: readonly string[]): Promise<void> {
  return Promise.all(planeIds.filter((id) => PLANE_MODELS[id]?.file.includes(`/${era}/`)).map(loadPlane)).then(() => undefined);
}

export const isModelReady = (planeId: string): boolean => templates.has(planeId);

export function createPlaneVisual(planeId: string, team: Team): PlaneVisual {
  const template = templates.get(planeId);
  if (!template) {
    return { root: createPlaceholderPlane(team), prop: null, muzzles: [], exhausts: [], placeholder: true };
  }
  const root = template.clone(true);
  let prop: Object3D | null = null;
  const muzzles: Object3D[] = [];
  const exhausts: Object3D[] = [];
  root.traverse((o) => {
    if (o.name === 'prop') prop = o;
    else if (o.name.startsWith('muzzle_')) muzzles.push(o);
    else if (o.name.startsWith('exhaust_')) exhausts.push(o);
    if ((o as Mesh).isMesh) {
      const mesh = o as Mesh;
      mesh.castShadow = true;
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((m) => lambertFor(planeId, m, team))
        : lambertFor(planeId, mesh.material, team);
    }
  });
  muzzles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { root, prop, muzzles, exhausts, placeholder: false };
}
