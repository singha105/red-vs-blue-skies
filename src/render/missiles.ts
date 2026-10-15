// Missiles, their smoke trails and motor flames, flares, chaff and afterburner glow. Two draw calls: missile
// bodies in one InstancedMesh, every glowing thing (motor flames, flares, afterburners) in another. Trails and
// chaff clouds are puffs in the shared effects pool.
import { AdditiveBlending, Color, CylinderGeometry, IcosahedronGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, MeshLambertMaterial, Object3D, Quaternion, Vector3 } from 'three';
import type { WorldState } from '../game/world';
import type { Effects } from './effects';

const MAX_MISSILES = 64;
const MAX_GLOWS = 160;
/** Missiles are 3–4 m long in reality; drawn 2× so they read at combat distances. */
const BODY_SCALE = 2;
const TRAIL_PER_S = 40;
const FLARE_TRAIL_PER_S = 14;

export interface GlowSource {
  /** World position of an afterburning exhaust. */
  x: number;
  y: number;
  z: number;
  size: number;
}

export interface MissileFx {
  readonly root: Object3D;
  /**
   * Draw missiles and decoys from the world, `back` seconds behind the latest tick (solo interpolation), and
   * glows at the given afterburner exhausts.
   */
  update(w: WorldState, back: number, frameDt: number, afterburners: readonly GlowSource[]): void;
  /** Chaff bundles burst into a cloud when released. */
  chaffBurst(x: number, y: number, z: number): void;
  /** Hide everything (leaving a match). */
  clear(): void;
}

export function createMissileFx(effects: Effects): MissileFx {
  const root = new Object3D();
  const body = new CylinderGeometry(0.11, 0.13, 3.2, 6, 1);
  body.rotateX(Math.PI / 2); // along +Z
  const bodies = new InstancedMesh(body, new MeshLambertMaterial({ color: '#eef0f2' }), MAX_MISSILES);
  bodies.frustumCulled = false;
  bodies.count = 0;
  const glows = new InstancedMesh(
    new IcosahedronGeometry(1, 0),
    new MeshBasicMaterial({ blending: AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, fog: false }),
    MAX_GLOWS,
  );
  glows.frustumCulled = false;
  glows.count = 0;
  glows.setColorAt(0, new Color());
  root.add(bodies, glows);

  const FLAME = new Color('#ffb347');
  const FLARE = new Color('#fff2c4');
  const BURNER = new Color('#ff7a2e');
  const m = new Matrix4();
  const q = new Quaternion();
  const p = new Vector3();
  const s = new Vector3();
  const dir = new Vector3();
  const zAxis = new Vector3(0, 0, 1);
  const c = new Color();
  const trailAcc = new Map<number, number>();
  let flicker = 0;

  const glow = (i: number, x: number, y: number, z: number, size: number, colour: Color): number => {
    if (i >= MAX_GLOWS) return i;
    p.set(x, y, z);
    s.setScalar(size);
    m.compose(p, q.identity(), s);
    glows.setMatrixAt(i, m);
    glows.setColorAt(i, colour);
    return i + 1;
  };

  return {
    root,
    update(w, back, frameDt, afterburners) {
      flicker += frameDt * 37;
      let n = 0;
      let g = 0;
      const live = new Set<number>();
      for (const ms of w.missiles) {
        if (n >= MAX_MISSILES) break;
        live.add(ms.id);
        p.set(ms.pos[0] - ms.vel[0] * back, ms.pos[1] - ms.vel[1] * back, ms.pos[2] - ms.vel[2] * back);
        dir.set(ms.vel[0], ms.vel[1], ms.vel[2]);
        const speed = dir.length();
        if (speed > 1) q.setFromUnitVectors(zAxis, dir.multiplyScalar(1 / speed));
        s.setScalar(BODY_SCALE);
        m.compose(p, q, s);
        bodies.setMatrixAt(n++, m);
        // Motor flame and smoke trail out of the back.
        const tx = p.x - dir.x * 3.4, ty = p.y - dir.y * 3.4, tz = p.z - dir.z * 3.4;
        g = glow(g, tx, ty, tz, 1.1 + 0.25 * Math.sin(flicker + ms.id), FLAME);
        let acc = (trailAcc.get(ms.id) ?? 0) + TRAIL_PER_S * effects.density * frameDt;
        while (acc >= 1) {
          acc -= 1;
          effects.emit('trail', tx, ty, tz);
        }
        trailAcc.set(ms.id, acc);
      }
      for (const id of trailAcc.keys()) if (!live.has(id)) trailAcc.delete(id);
      bodies.count = n;
      bodies.instanceMatrix.needsUpdate = true;

      for (const d of w.decoys) {
        if (d.kind !== 'flare') continue;
        const fade = Math.max(0.2, 1 - d.age / 3);
        c.copy(FLARE).multiplyScalar(fade);
        g = glow(g, d.pos[0], d.pos[1], d.pos[2], (2.2 + 0.6 * Math.sin(flicker * 1.7 + d.id)) * fade, c);
        if (Math.random() < FLARE_TRAIL_PER_S * effects.density * frameDt) effects.emit('trail', d.pos[0], d.pos[1], d.pos[2]);
      }
      for (const a of afterburners) {
        c.copy(BURNER).multiplyScalar(0.85 + 0.15 * Math.sin(flicker * 1.3 + a.x));
        g = glow(g, a.x, a.y, a.z, a.size * (0.9 + 0.1 * Math.sin(flicker)), c);
      }
      glows.count = g;
      glows.instanceMatrix.needsUpdate = true;
      if (glows.instanceColor) glows.instanceColor.needsUpdate = true;
    },
    clear() {
      bodies.count = 0;
      glows.count = 0;
      trailAcc.clear();
    },
    chaffBurst(x, y, z) {
      for (let i = 0; i < 4; i++) effects.emit('chaff', x + (Math.random() - 0.5) * 4, y + (Math.random() - 0.5) * 4, z + (Math.random() - 0.5) * 4);
    },
  };
}
