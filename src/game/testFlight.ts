// A coordinated banked circle for the title-screen plane. Pure math, no Three.js.

export type Vec3 = [number, number, number];

export interface CirclePath {
  center: Vec3;
  radiusM: number;
  speedMs: number;
}

export interface Pose {
  pos: Vec3;
  /** Unit vector the nose points along. */
  forward: Vec3;
  /** Unit vector out of the cockpit roof (tilted into the turn by the bank angle). */
  up: Vec3;
  bankRad: number;
}

const G = 9.81;

/** Pose at time t (seconds) flying counter-clockwise seen from above, with a gentle altitude swell. */
export function circlePose(path: CirclePath, t: number): Pose {
  const { center, radiusM: r, speedMs: v } = path;
  const theta = (v / r) * t;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const bob = Math.sin(t * 0.35) * 6;

  const pos: Vec3 = [center[0] + r * c, center[1] + bob, center[2] + r * s];
  // Derivative of pos with respect to theta, normalized; bob is slow enough to ignore for the heading.
  const forward: Vec3 = [-s, 0, c];
  const bankRad = Math.atan((v * v) / (r * G));
  const toCenter: Vec3 = [-c, 0, -s];
  const cb = Math.cos(bankRad);
  const sb = Math.sin(bankRad);
  const up: Vec3 = [toCenter[0] * sb, cb, toCenter[2] * sb];
  return { pos, forward, up, bankRad };
}
