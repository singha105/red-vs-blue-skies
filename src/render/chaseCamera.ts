// Chase camera for mouse-aim flight: sits behind the plane along the aim direction, so the aim reticle stays
// near screen centre and the plane swings toward it. Follows with a little lag, widens FOV with speed,
// and has a shake hook (Day 3+: hits, explosions).
import { Euler, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { smoothstep } from '../game/math';

const BASE_FOV = 62;
const FAST_FOV = 76;
const DISTANCE = 26;
const HEIGHT = 7;
const LAG = 9; // higher = tighter follow
/** Holding zoom narrows the field of view to this fraction. */
const ZOOM_FOV = 0.42;

export interface ChaseCamera {
  update(dt: number, planePos: Vector3, aimDir: Vector3, speedMs: number, freeLookDir: Vector3 | null): void;
  /** Add shake: 0.2 is a light bump, 1 is a big explosion nearby. */
  shake(amount: number): void;
  reset(): void;
  /** Scale the follow distance to the plane (1 = a 9 m fighter). */
  setScale(scale: number): void;
  /** HUD view: the camera sits at the nose and turns with the plane; look yaw/pitch turn the head. */
  updateCockpit(dt: number, planePos: Vector3, planeQuat: Quaternion, noseOffsetM: number, look: { yaw: number; pitch: number }, speedMs: number): void;
  /** Hold zoom (narrow field of view, eased in and out). */
  setZoom(on: boolean): void;
}

export function createChaseCamera(camera: PerspectiveCamera): ChaseCamera {
  const offset = new Vector3();
  const desired = new Vector3();
  const look = new Vector3();
  const up = new Vector3(0, 1, 0);
  let trauma = 0;
  let primed = false;
  let fov = BASE_FOV;
  let size = 1;
  let zoomTarget = 1;
  let zoom = 1;
  const flip = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
  const head = new Quaternion();
  const euler = new Euler(0, 0, 0, 'YXZ');
  const nose = new Vector3();

  const applyFov = (dt: number, speedMs: number, base = BASE_FOV, fast = FAST_FOV): void => {
    const targetFov = base + (fast - base) * smoothstep(60, 380, speedMs);
    fov += (targetFov - fov) * (1 - Math.exp(-2 * dt));
    zoom += (zoomTarget - zoom) * (1 - Math.exp(-10 * dt));
    const portrait = camera.aspect < 1;
    const effective = (portrait ? fov + 12 : fov) * zoom;
    if (Math.abs(camera.fov - effective) > 0.01) {
      camera.fov = effective;
      camera.updateProjectionMatrix();
    }
  };

  return {
    update(dt, planePos, aimDir, speedMs, freeLookDir) {
      const dir = freeLookDir ?? aimDir;
      desired.copy(dir).multiplyScalar(-DISTANCE * size).addScaledVector(up, HEIGHT * size);
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

      applyFov(dt, speedMs);
    },
    updateCockpit(dt, planePos, planeQuat, noseOffsetM, look, speedMs) {
      // Models face +Z and cameras look down −Z, so turn the plane's orientation half a turn.
      nose.set(0, 0.35 * size, noseOffsetM).applyQuaternion(planeQuat);
      camera.position.copy(planePos).add(nose);
      euler.set(look.pitch, -look.yaw, 0);
      head.setFromEuler(euler);
      camera.quaternion.copy(planeQuat).multiply(flip).multiply(head);
      if (trauma > 0) {
        const s = trauma * trauma;
        camera.rotation.x += (Math.random() - 0.5) * 0.02 * s;
        camera.rotation.y += (Math.random() - 0.5) * 0.02 * s;
        trauma = Math.max(0, trauma - dt * 1.6);
      }
      primed = false; // back in chase view, start from the right place
      applyFov(dt, speedMs, 70, 80);
    },
    setZoom(on) {
      zoomTarget = on ? ZOOM_FOV : 1;
    },
    shake(amount) {
      trauma = Math.min(1, trauma + amount);
    },
    reset() {
      primed = false;
    },
    setScale(scale) {
      size = Math.min(2, Math.max(0.75, scale));
    },
  };
}
