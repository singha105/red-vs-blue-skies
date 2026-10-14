// Tracers: one InstancedMesh for every bullet in flight (one draw call), coloured per gun type.
import { BoxGeometry, Color, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import type { Gun } from '../data/types';
import type { Bullet } from '../game/ballistics';

const MAX_TRACERS = 1500;
const LENGTH_M = 16;

export interface Tracers {
  mesh: InstancedMesh;
  update(bullets: readonly Bullet[], alphaBack: number, dt: number, cameraPos: Vector3): void;
}

export function createTracers(guns: readonly Gun[]): Tracers {
  const geometry = new BoxGeometry(1, 1, 1);
  const material = new MeshBasicMaterial({ toneMapped: false, fog: false });
  const mesh = new InstancedMesh(geometry, material, MAX_TRACERS);
  mesh.frustumCulled = false;
  mesh.count = 0;
  // Instance colours need an initial write so the attribute exists.
  mesh.setColorAt(0, new Color(1, 1, 1));

  const colourByGun = new Map<string, Color>(guns.map((g) => [g.id, new Color(g.tracerColor)]));
  const fallback = new Color('#fff1b8');
  const m = new Matrix4();
  const q = new Quaternion();
  const pos = new Vector3();
  const dir = new Vector3();
  const scale = new Vector3();
  const zAxis = new Vector3(0, 0, 1);

  return {
    mesh,
    update(bullets, alphaBack, dt, cameraPos) {
      const n = Math.min(bullets.length, MAX_TRACERS);
      for (let i = 0; i < n; i++) {
        const b = bullets[i]!;
        dir.set(b.vel[0], b.vel[1], b.vel[2]);
        const speed = dir.length() || 1;
        dir.multiplyScalar(1 / speed);
        // Draw where the bullet is between ticks (it moves ~15 m per tick).
        pos.set(b.pos[0], b.pos[1], b.pos[2]).addScaledVector(dir, -speed * dt * alphaBack);
        // Thicker with distance so tracers stay visible far away.
        const width = Math.min(1.6, 0.25 + pos.distanceTo(cameraPos) * 0.0016);
        q.setFromUnitVectors(zAxis, dir);
        scale.set(width, width, LENGTH_M);
        m.compose(pos.addScaledVector(dir, -LENGTH_M / 2), q, scale);
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, colourByGun.get(b.gun) ?? fallback);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
  };
}
