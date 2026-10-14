// Chase camera for mouse-aim flight: sits behind the plane along the aim direction, so the aim reticle stays
// near screen centre and the plane swings toward it. Follows with a little lag, widens FOV with speed,
// and has a shake hook (Day 3+: hits, explosions).
import { PerspectiveCamera, Vector3 } from 'three';
import { smoothstep } from '../game/math';

const BASE_FOV = 62;
const FAST_FOV = 76;
const DISTANCE = 26;
const HEIGHT = 7;
const LAG = 9; // higher = tighter follow

export interface ChaseCamera {
  update(dt: number, planePos: Vector3, aimDir: Vector3, speedMs: number, freeLookDir: Vector3 | null): void;
  /** Add shake: 0.2 is a light bump, 1 is a big explosion nearby. */
  shake(amount: number): void;
  reset(): void;
}

export function createChaseCamera(camera: PerspectiveCamera): ChaseCamera {
  const offset = new Vector3();
  const desired = new Vector3();
  const look = new Vector3();
  const up = new Vector3(0, 1, 0);
  let trauma = 0;
  let primed = false;
  let fov = BASE_FOV;

  return {
    update(dt, planePos, aimDir, speedMs, freeLookDir) {
      const dir = freeLookDir ?? aimDir;
      desired.copy(dir).multiplyScalar(-DISTANCE).addScaledVector(up, HEIGHT);
      if (!primed) {
        offset.copy(desired);
        primed = true;
      } else {
        offset.lerp(desired, 1 - Math.exp(-LAG * dt));
      }
      camera.position.copy(planePos).add(offset);
      look.copy(planePos).addScaledVector(dir, 120);
      camera.lookAt(look);

      if (trauma > 0) {
        const s = trauma * trauma;
        camera.rotation.x += (Math.random() - 0.5) * 0.04 * s;
        camera.rotation.y += (Math.random() - 0.5) * 0.04 * s;
        camera.rotation.z += (Math.random() - 0.5) * 0.03 * s;
        trauma = Math.max(0, trauma - dt * 1.6);
      }

      const targetFov = BASE_FOV + (FAST_FOV - BASE_FOV) * smoothstep(60, 380, speedMs);
      fov += (targetFov - fov) * (1 - Math.exp(-2 * dt));
      const portrait = camera.aspect < 1;
      const effective = portrait ? fov + 12 : fov;
      if (Math.abs(camera.fov - effective) > 0.01) {
        camera.fov = effective;
        camera.updateProjectionMatrix();
      }
    },
    shake(amount) {
      trauma = Math.min(1, trauma + amount);
    },
    reset() {
      primed = false;
    },
  };
}
