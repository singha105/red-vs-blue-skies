// Plane models: GLTFLoader + meshopt decoder, loaded per era on demand, tinted per team.
// Day 11: every plane has a detailed model (smooth, up to 3,000 / 4,000 triangles) with a baked detail texture
// (KTX2: AO and panel lines in RGB, the team-paint mask in alpha) and the low-poly LOD. Low graphics loads only
// the LOD (phones download ~12 KB a plane); Medium and High load both and switch to the LOD beyond LOD_M.
// Until a model has loaded callers get the box placeholder (or the LOD until the detailed one arrives).
import { Color, DoubleSide, Group, LOD, Mesh, MeshLambertMaterial, MeshStandardMaterial, Object3D, type Material, type Texture, type WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { EraId } from '../data/types';
import type { Team } from '../game/flight';
import { PLANE_MODELS } from '../game/planeModels';
import { ktx2Loader } from './ktx2';
import { createPlaceholderPlane, onTeamPalette, TEAM_COLOURS } from './planeMesh';

/** Beyond this many metres (× the plane's length / 10) a plane draws its low-poly LOD. */
const LOD_M = 380;

export interface PlaneVisual {
  root: Object3D;
  /** Spins with throttle (prop planes only); `props` has every level's propeller. */
  prop: Object3D | null;
  props: Object3D[];
  muzzles: Object3D[];
  exhausts: Object3D[];
  placeholder: boolean;
  /** Which model this visual shows: the placeholder box, the LOD only, or the detailed model (+ LOD far away). */
  level: 'placeholder' | 'lod' | 'high';
}

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

interface Loaded {
  lod?: Group;
  high?: Group;
  detail?: Texture;
}
const loaded = new Map<string, Loaded>();
const pending = new Map<string, Promise<void>>();
const failed = new Set<string>();
let detailMode: 'lod' | 'high' = 'lod';
let renderer: WebGLRenderer | null = null;

// One material per plane, original material and team, shared by every plane using that model.
const materialCache = new Map<string, Material>();
// Settings → Team colours repaints every cached team material in place.
onTeamPalette(() => {
  for (const [key, m] of materialCache) {
    const team = key.split('|')[2] as Team;
    if (m.name === 'TEAM' && m instanceof MeshLambertMaterial) m.color.setHex(TEAM_COLOURS[team]);
    const u = m.userData['team'] as { value: Color } | undefined;
    u?.value.setHex(TEAM_COLOURS[team]);
  }
});

/** Medium/High: detailed models; Low: LODs only. Planes already on screen upgrade as their models arrive. */
export function setModelDetail(mode: 'lod' | 'high', r: WebGLRenderer): void {
  detailMode = mode;
  renderer = r;
}

function lambertFor(planeId: string, src: Material, team: Team): Material {
  const name = src.name || 'BODY';
  const key = `${planeId}|${name}|${team}|lod`;
  const cached = materialCache.get(key);
  if (cached) return cached;
  const m = new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide });
  m.name = name;
  if (name === 'TEAM') m.color = new Color(TEAM_COLOURS[team]);
  if (name === 'GLASS') m.emissive = new Color(0x1d3346);
  materialCache.set(key, m);
  return m;
}

/** Detailed model: PBR paint × baked AO and panel lines, team colour where the mask says so; glossy glass. */
function standardFor(planeId: string, src: Material, team: Team, detail: Texture | undefined): Material {
  const name = src.name || 'BODY';
  const glass = name === 'GLASS';
  const key = `${planeId}|${glass ? 'GLASS' : 'PAINT'}|${team}|high`;
  const cached = materialCache.get(key);
  if (cached) return cached;
  if (glass) {
    const m = new MeshStandardMaterial({ color: 0x9fc9e8, roughness: 0.08, metalness: 0.4, envMapIntensity: 1.4, side: DoubleSide });
    m.name = 'GLASS';
    materialCache.set(key, m);
    return m;
  }
  const jet = PLANE_MODELS[planeId]?.engine === 'jet';
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: jet ? 0.5 : 0.62, metalness: jet ? 0.25 : 0.1, side: DoubleSide });
  m.name = 'PAINT';
  const teamColour = { value: new Color(TEAM_COLOURS[team]) };
  m.userData['team'] = teamColour;
  if (detail) {
    const uDetail = { value: detail };
    m.onBeforeCompile = (shader) => {
      shader.uniforms['uTeam'] = teamColour;
      shader.uniforms['uDetail'] = uDetail;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vDetailUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvDetailUv = uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uTeam;\nuniform sampler2D uDetail;\nvarying vec2 vDetailUv;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          vec4 det = texture2D(uDetail, vDetailUv);
          diffuseColor.rgb = mix(diffuseColor.rgb, uTeam, det.a) * det.rgb;`,
        );
    };
    m.customProgramCacheKey = () => 'plane-detail';
  } else {
    // No texture (it failed to load): the TEAM faces still get their colour from the material.
    if (name === 'TEAM') m.color = teamColour.value;
  }
  materialCache.set(key, m);
  return m;
}

/** Starts loading one plane's model(s) for the current detail mode (no-op if loaded or loading). */
export function loadPlane(planeId: string): Promise<void> {
  const info = PLANE_MODELS[planeId];
  if (!info || failed.has(planeId)) return Promise.resolve();
  const have = loaded.get(planeId) ?? {};
  const wantHigh = detailMode === 'high' && Boolean(info.detailFile);
  if (have.lod && (!wantHigh || have.high)) return Promise.resolve();
  const key = `${planeId}|${wantHigh}`;
  let p = pending.get(key);
  if (!p) {
    const base = import.meta.env.BASE_URL;
    p = (async () => {
      try {
        const entry = loaded.get(planeId) ?? {};
        loaded.set(planeId, entry);
        if (!entry.lod) entry.lod = (await loader.loadAsync(`${base}${info.lodFile ?? info.file}`)).scene;
        if (wantHigh && !entry.high && renderer) {
          const [gltf, tex] = await Promise.all([
            loader.loadAsync(`${base}${info.file}`),
            ktx2Loader(renderer)
              .loadAsync(`${base}${info.detailFile}`)
              .catch(() => undefined),
          ]);
          if (tex) tex.flipY = false; // glTF UVs
          entry.detail = tex;
          entry.high = gltf.scene;
        }
      } catch (err: unknown) {
        if (!loaded.get(planeId)?.lod) failed.add(planeId);
        console.warn(`Model for ${planeId} failed to load`, err);
      }
    })();
    pending.set(key, p);
  }
  return p;
}

/** Loads every model of one era: only the era being played is downloaded. */
export function loadEra(era: EraId, planeIds: readonly string[]): Promise<void> {
  return Promise.all(planeIds.filter((id) => PLANE_MODELS[id]?.file.includes(`/${era}/`)).map(loadPlane)).then(() => undefined);
}

/** The best visual for the current detail mode that has loaded. */
function bestLevel(planeId: string): PlaneVisual['level'] {
  const e = loaded.get(planeId);
  if (e?.high && detailMode === 'high') return 'high';
  return e?.lod ? 'lod' : 'placeholder';
}

export const isModelReady = (planeId: string): boolean => bestLevel(planeId) !== 'placeholder';
/** A visual made earlier can now be replaced by a better one (its model arrived, or the detail mode changed). */
export const visualOutdated = (v: PlaneVisual, planeId: string): boolean => v.level !== bestLevel(planeId);

function dress(source: Group, planeId: string, team: Team, high: boolean, detail: Texture | undefined): { root: Object3D; props: Object3D[]; muzzles: Object3D[]; exhausts: Object3D[] } {
  const root = source.clone(true);
  const props: Object3D[] = [];
  const muzzles: Object3D[] = [];
  const exhausts: Object3D[] = [];
  root.traverse((o) => {
    if (o.name === 'prop') props.push(o);
    else if (o.name.startsWith('muzzle_')) muzzles.push(o);
    else if (o.name.startsWith('exhaust_')) exhausts.push(o);
    if ((o as Mesh).isMesh) {
      const mesh = o as Mesh;
      mesh.castShadow = true;
      const pick = (m: Material): Material => (high && o.name !== 'prop' && o.parent?.name !== 'prop' ? standardFor(planeId, m, team, detail) : lambertFor(planeId, m, team));
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(pick) : pick(mesh.material);
    }
  });
  muzzles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { root, props, muzzles, exhausts };
}

export function createPlaneVisual(planeId: string, team: Team): PlaneVisual {
  const level = bestLevel(planeId);
  const e = loaded.get(planeId);
  if (level === 'placeholder' || !e?.lod) {
    return { root: createPlaceholderPlane(team), prop: null, props: [], muzzles: [], exhausts: [], placeholder: true, level: 'placeholder' };
  }
  const low = dress(e.lod, planeId, team, false, undefined);
  if (level === 'lod' || !e.high) {
    return { root: low.root, prop: low.props[0] ?? null, props: low.props, muzzles: low.muzzles, exhausts: low.exhausts, placeholder: false, level: 'lod' };
  }
  const high = dress(e.high, planeId, team, true, e.detail);
  const lod = new LOD();
  const length = PLANE_MODELS[planeId]?.lengthM ?? 10;
  lod.addLevel(high.root, 0);
  lod.addLevel(low.root, LOD_M * Math.max(0.8, length / 10));
  // Muzzles and exhausts are the same points in both models; the detailed model's are used.
  return { root: lod, prop: high.props[0] ?? low.props[0] ?? null, props: [...high.props, ...low.props], muzzles: high.muzzles, exhausts: high.exhausts, placeholder: false, level: 'high' };
}
