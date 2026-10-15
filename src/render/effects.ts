// Pooled particle puffs (smoke, fire, explosions, hit sparks) in one InstancedMesh. No allocation per particle.
// Day 9 replaces these with nicer effects; the emit API stays the same.
import { Color, IcosahedronGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from 'three';

const MAX = 900;

export type PuffKind = 'smoke' | 'darkSmoke' | 'fire' | 'flash' | 'spark' | 'muzzle';

const KINDS: Record<PuffKind, { colour: Color; life: number; size: number; grow: number; rise: number }> = {
  smoke: { colour: new Color('#9aa1a8'), life: 2.4, size: 2, grow: 3.2, rise: 2 },
  darkSmoke: { colour: new Color('#3b3f45'), life: 3, size: 3, grow: 4, rise: 3 },
  fire: { colour: new Color('#ff8a2a'), life: 0.6, size: 1.8, grow: 1.5, rise: 1 },
  flash: { colour: new Color('#ffd27a'), life: 0.7, size: 6, grow: 22, rise: 0 },
  spark: { colour: new Color('#ffe9a8'), life: 0.25, size: 1, grow: 2, rise: 0 },
  muzzle: { colour: new Color('#fff0b0'), life: 0.05, size: 0.35, grow: 8, rise: 0 },
};

export interface Effects {
  mesh: InstancedMesh;
  emit(kind: PuffKind, x: number, y: number, z: number, vx?: number, vy?: number, vz?: number): void;
  explosion(x: number, y: number, z: number): void;
  update(dt: number): void;
  /** 0.5 on low graphics: half the smoke. */
  density: number;
}

export function createEffects(): Effects {
  const geometry = new IcosahedronGeometry(1, 0);
  const material = new MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false });
  const mesh = new InstancedMesh(geometry, material, MAX);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.setColorAt(0, new Color());

  // Struct-of-arrays pool; live particles are packed at the front.
  const px = new Float32Array(MAX), py = new Float32Array(MAX), pz = new Float32Array(MAX);
  const vx = new Float32Array(MAX), vy = new Float32Array(MAX), vz = new Float32Array(MAX);
  const age = new Float32Array(MAX), life = new Float32Array(MAX), size = new Float32Array(MAX), grow = new Float32Array(MAX);
  const kind = new Uint8Array(MAX);
  const kindList = Object.keys(KINDS) as PuffKind[];
  let live = 0;

  const m = new Matrix4();
  const q = new Quaternion();
  const p = new Vector3();
  const s = new Vector3();
  const c = new Color();

  const api: Effects = {
    mesh,
    density: 1,
    emit(k, x, y, z, ivx = 0, ivy = 0, ivz = 0) {
      if (live >= MAX) return;
      const def = KINDS[k];
      const i = live++;
      px[i] = x; py[i] = y; pz[i] = z;
      vx[i] = ivx; vy[i] = ivy + def.rise; vz[i] = ivz;
      age[i] = 0;
      life[i] = def.life * (0.8 + Math.random() * 0.4);
      size[i] = def.size * (0.8 + Math.random() * 0.4);
      grow[i] = def.grow;
      kind[i] = kindList.indexOf(k);
    },
    explosion(x, y, z) {
      api.emit('flash', x, y, z);
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2;
        const e = (Math.random() - 0.3) * Math.PI;
        const sp = 8 + Math.random() * 18;
        api.emit(i < 5 ? 'fire' : 'darkSmoke', x, y, z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp, Math.sin(a) * Math.cos(e) * sp);
      }
    },
    update(dt) {
      let i = 0;
      while (i < live) {
        age[i]! += dt;
        if (age[i]! >= life[i]!) {
          // Swap-remove with the last live particle.
          const last = --live;
          px[i] = px[last]!; py[i] = py[last]!; pz[i] = pz[last]!;
          vx[i] = vx[last]!; vy[i] = vy[last]!; vz[i] = vz[last]!;
          age[i] = age[last]!; life[i] = life[last]!; size[i] = size[last]!; grow[i] = grow[last]!; kind[i] = kind[last]!;
          continue;
        }
        const drag = 1 - 1.5 * dt;
        vx[i]! *= drag; vy[i]! *= drag; vz[i]! *= drag;
        px[i]! += vx[i]! * dt; py[i]! += vy[i]! * dt; pz[i]! += vz[i]! * dt;
        const t = age[i]! / life[i]!;
        const r = (size[i]! + grow[i]! * age[i]!) * (1 - t * t * 0.6);
        p.set(px[i]!, py[i]!, pz[i]!);
        s.setScalar(r);
        m.compose(p, q, s);
        mesh.setMatrixAt(i, m);
        const def = KINDS[kindList[kind[i]!]!];
        // Fade toward the sky colour instead of true transparency sorting.
        c.copy(def.colour).lerp(SKY_FADE, t * 0.7);
        mesh.setColorAt(i, c);
        i++;
      }
      mesh.count = live;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
  };
  return api;
}

const SKY_FADE = new Color('#c4d6e2');
