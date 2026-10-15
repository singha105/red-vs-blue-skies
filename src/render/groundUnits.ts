// Ground targets and Air Domination zones. Each unit kind is one merged low-poly geometry built here from
// boxes and cylinders (no download), drawn as one InstancedMesh per kind; one more InstancedMesh carries a
// team-coloured pennant over every unit. Destroyed units go dark and smoke. Zones are open cylinders as tall as
// the capture altitude, coloured by owner. Everything is reused between matches; nothing allocates per frame.
import {
  BoxGeometry,
  BufferAttribute,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { UnitKind } from '../data/types';
import type { Team } from '../game/flight';
import type { GroundUnit, ZoneState } from '../game/objectives';
import type { Terrain } from '../game/terrain';
import type { Effects } from './effects';
import { TEAM_COLOURS } from './planeMesh';

type Part = { size: [number, number, number]; at: [number, number, number]; colour: string; rotY?: number; rotX?: number; cyl?: boolean };

const GREY = '#7d858c';
const DARK = '#3a3f45';
const OLIVE = '#5d6447';
const CANVAS = '#8c8a6a';
const CONCRETE = '#a29d92';
const DECK = '#4a4f55';

/** Unit shapes in metres, facing +Z, sitting on y = 0 (ships float with the waterline at 0). */
const SHAPES: Record<UnitKind, Part[]> = {
  truck: [
    { size: [2.4, 1, 6], at: [0, 0.9, 0], colour: DARK },
    { size: [2.3, 1.6, 1.7], at: [0, 2, 2.1], colour: OLIVE },
    { size: [2.5, 2.1, 3.8], at: [0, 2.4, -1], colour: CANVAS },
    { size: [2.7, 0.9, 1], at: [0, 0.45, 2], colour: DARK },
    { size: [2.7, 0.9, 1], at: [0, 0.45, -1.8], colour: DARK },
  ],
  tank: [
    { size: [3.3, 1.3, 6.4], at: [0, 1, 0], colour: OLIVE },
    { size: [3.6, 0.9, 6.6], at: [0, 0.45, 0], colour: DARK },
    { size: [2.3, 1, 2.8], at: [0, 2.1, -0.3], colour: OLIVE },
    { size: [0.3, 0.3, 4], at: [0, 2.2, 2.9], colour: DARK },
  ],
  bunker: [
    { size: [14, 3.2, 12], at: [0, 1.6, 0], colour: CONCRETE },
    { size: [10, 1.6, 8], at: [0, 4, -0.5], colour: CONCRETE },
    { size: [8, 0.7, 0.4], at: [0, 2.4, 6.05], colour: DARK },
  ],
  aa: [
    { size: [7, 1, 7], at: [0, 0.5, 0], colour: CANVAS },
    { size: [1.4, 1.4, 1.4], at: [0, 1.7, 0], colour: OLIVE },
    { size: [0.18, 0.18, 3.4], at: [0.35, 3, 1], colour: DARK, rotX: -0.75 },
    { size: [0.18, 0.18, 3.4], at: [-0.35, 3, 1], colour: DARK, rotX: -0.75 },
  ],
  ship: [
    { size: [10, 8, 70], at: [0, 0, -3], colour: GREY },
    { size: [7.07, 8, 7.07], at: [0, 0, 32], colour: GREY, rotY: Math.PI / 4 },
    { size: [7, 6, 16], at: [0, 7, 6], colour: GREY },
    { size: [3, 7, 4], at: [0, 10, -4], colour: DARK },
    { size: [3.2, 2, 4], at: [0, 5, 22], colour: GREY },
    { size: [0.4, 0.4, 5], at: [0, 5.2, 26], colour: DARK },
    { size: [3.2, 2, 4], at: [0, 5, -26], colour: GREY },
  ],
  carrier: [
    { size: [26, 16, 180], at: [0, 2, -6], colour: GREY },
    { size: [18.4, 16, 18.4], at: [0, 2, 84], colour: GREY, rotY: Math.PI / 4 },
    { size: [36, 1.2, 200], at: [0, 10.6, 0], colour: DECK },
    { size: [0.8, 0.15, 170], at: [0, 11.25, -5], colour: '#e8e8e8' },
    { size: [7, 14, 26], at: [-15, 18, -12], colour: GREY },
    { size: [4, 8, 6], at: [-15, 28, -14], colour: DARK },
  ],
  depot: [
    { size: [22, 9, 32], at: [-18, 4.5, 0], colour: '#8b6f55' },
    { size: [22, 9, 32], at: [12, 4.5, 6], colour: '#7c6a58' },
    { size: [16, 2.5, 34], at: [-18, 9.5, 0], colour: DARK, rotX: 0 },
    { size: [10, 10, 10], at: [0, 5, -26], colour: '#c9c3b6', cyl: true },
    { size: [10, 10, 10], at: [14, 5, -24], colour: '#c9c3b6', cyl: true },
    { size: [4, 18, 4], at: [30, 9, -20], colour: '#9a6b55', cyl: true },
  ],
};

const MAX_PER_KIND = 24;
const FLAG_Y: Record<UnitKind, number> = { truck: 6, tank: 6, bunker: 9, aa: 7, ship: 22, carrier: 42, depot: 26 };

function buildShape(parts: Part[]): BufferGeometry {
  const geos = parts.map((p) => {
    const g = (p.cyl ? new CylinderGeometry(p.size[0] / 2, p.size[0] / 2, p.size[1], 8) : new BoxGeometry(p.size[0], p.size[1], p.size[2])).toNonIndexed();
    const m = new Matrix4().makeRotationFromQuaternion(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), p.rotY ?? 0).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), p.rotX ?? 0)));
    m.setPosition(p.at[0], p.at[1], p.at[2]);
    g.applyMatrix4(m);
    const c = new Color(p.colour);
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(col, i * 3);
    g.setAttribute('color', new BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    return g;
  });
  return mergeGeometries(geos)!;
}

export interface GroundRenderer {
  readonly root: Group;
  /** Draw this frame's units and zones. `captureAltitudeM` sets the zone columns' height. */
  update(units: readonly GroundUnit[], zones: readonly ZoneState[], zoneRadiusM: number, captureAltitudeM: number, terrain: Terrain, dt: number): void;
  clear(): void;
  /** Units drawn last frame (tests). */
  readonly shown: number;
}

export function createGroundRenderer(effects: Effects): GroundRenderer {
  const root = new Group();
  const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const meshes = new Map<UnitKind, InstancedMesh>();
  for (const kind of Object.keys(SHAPES) as UnitKind[]) {
    const mesh = new InstancedMesh(buildShape(SHAPES[kind]), material, MAX_PER_KIND);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.setColorAt(0, new Color(1, 1, 1));
    meshes.set(kind, mesh);
    root.add(mesh);
  }
  // Pennants: a flat triangle on a pole, team-coloured per instance.
  const flagGeo = mergeGeometries([
    new BoxGeometry(0.25, 6, 0.25).translate(0, 3, 0).toNonIndexed(),
    new BoxGeometry(0.1, 2.2, 3.6).translate(0, 4.9, -1.8).toNonIndexed(),
  ])!;
  flagGeo.deleteAttribute('uv');
  const flags = new InstancedMesh(flagGeo, new MeshBasicMaterial({ side: DoubleSide }), MAX_PER_KIND * 8);
  flags.count = 0;
  flags.frustumCulled = false;
  flags.setColorAt(0, new Color(1, 1, 1));
  root.add(flags);

  // Zones: open cylinders, one per zone (three at most), sides only.
  const zoneGeo = new CylinderGeometry(1, 1, 1, 48, 1, true).translate(0, 0.5, 0);
  const zoneMeshes: Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const m = new Mesh(zoneGeo, new MeshBasicMaterial({ transparent: true, opacity: 0.16, depthWrite: false, side: DoubleSide, fog: true }));
    m.visible = false;
    m.renderOrder = 2;
    zoneMeshes.push(m);
    root.add(m);
  }
  const neutral = new Color('#f4f7fb');
  const teamColour: Record<Team, Color> = { red: new Color(TEAM_COLOURS.red), blue: new Color(TEAM_COLOURS.blue) };
  const live = new Color(1, 1, 1);
  const wrecked = new Color(0.22, 0.2, 0.19);
  const m4 = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const p = new Vector3();
  const one = new Vector3(1, 1, 1);
  const flagScale = new Vector3(1, 1, 1);
  const smokeAcc = new Float32Array(256);
  let shown = 0;

  return {
    root,
    get shown() {
      return shown;
    },
    update(units, zones, zoneRadiusM, captureAltitudeM, terrain, dt) {
      for (const mesh of meshes.values()) mesh.count = 0;
      flags.count = 0;
      shown = 0;
      for (const u of units) {
        const mesh = meshes.get(u.kind);
        if (!mesh || mesh.count >= MAX_PER_KIND) continue;
        q.setFromAxisAngle(up, u.heading);
        // A wreck sits a little lower and darker.
        p.set(u.pos[0], u.pos[1] - (u.alive ? 0 : u.kind === 'ship' || u.kind === 'carrier' ? 3 : 0.6), u.pos[2]);
        m4.compose(p, q, one);
        const i = mesh.count++;
        mesh.setMatrixAt(i, m4);
        mesh.setColorAt(i, u.alive ? live : wrecked);
        shown++;
        if (u.alive && flags.count < MAX_PER_KIND * 8) {
          p.set(u.pos[0], u.pos[1] + FLAG_Y[u.kind] - 6, u.pos[2]);
          m4.compose(p, q, flagScale.setScalar(u.kind === 'carrier' || u.kind === 'depot' ? 2.5 : 1));
          flags.setMatrixAt(flags.count, m4);
          flags.setColorAt(flags.count, teamColour[u.team]);
          flags.count++;
        }
        // Burning wrecks: a column of smoke (half as much on low graphics) and a little fire.
        if (!u.alive && u.target && u.id < smokeAcc.length) {
          smokeAcc[u.id]! += dt * 6 * effects.density;
          while (smokeAcc[u.id]! >= 1) {
            smokeAcc[u.id]! -= 1;
            const big = u.kind === 'ship' || u.kind === 'carrier' || u.kind === 'bunker' ? 3 : 1;
            const ox = (Math.random() - 0.5) * 4 * big;
            const oz = (Math.random() - 0.5) * 4 * big;
            effects.emit(Math.random() < 0.25 ? 'fire' : 'darkSmoke', u.pos[0] + ox, u.pos[1] + 3 * big, u.pos[2] + oz, 0, 4 + Math.random() * 4, 0);
          }
        }
      }
      for (const mesh of meshes.values()) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      flags.instanceMatrix.needsUpdate = true;
      if (flags.instanceColor) flags.instanceColor.needsUpdate = true;

      zoneMeshes.forEach((m, i) => {
        const z = zones[i];
        m.visible = Boolean(z);
        if (!z) return;
        const ground = terrain.surfaceAt(z.x, z.z);
        m.position.set(z.x, ground - 20, z.z);
        m.scale.set(zoneRadiusM, captureAltitudeM + 20, zoneRadiusM);
        const mat = m.material as MeshBasicMaterial;
        mat.color.copy(z.owner ? teamColour[z.owner] : neutral);
        // Being captured: blend toward the capturing side.
        if (!z.owner && Math.abs(z.progress) > 0.02) mat.color.lerp(teamColour[z.progress > 0 ? 'blue' : 'red'], Math.abs(z.progress) * 0.7);
      });
    },
    clear() {
      for (const mesh of meshes.values()) mesh.count = 0;
      flags.count = 0;
      for (const m of zoneMeshes) m.visible = false;
      smokeAcc.fill(0);
      shown = 0;
    },
  };
}
