// The local player's control state. Every device (mouse, touch, gamepad, keys) writes here; once per
// simulation tick sample() turns it into a ControlInput using the mouse-aim autopilot.
import { aimControl, createAimPd } from '../game/autopilot';
import type { ControlInput } from '../game/controls';
import type { PlaneState } from '../game/flight';
import { clamp, dirFromYawPitch, FORWARD, normalize, rotate, yawPitchFromDir, type Vec3 } from '../game/math';

const MAX_AIM_PITCH = (88 * Math.PI) / 180;
/** The aim may lead the nose by at most this much, so it never runs off where the plane can't follow. */
const MAX_LEAD = (75 * Math.PI) / 180;

export interface PlayerControls {
  /** World aim direction as yaw/pitch (radians). */
  readonly aim: { yaw: number; pitch: number };
  /** Free-look camera angles relative to the aim, used while freeLook is on. */
  readonly look: { yaw: number; pitch: number };
  freeLook: boolean;
  throttle: number;
  fire: boolean;
  missile: boolean;
  flare: boolean;
  /** Keyboard/arrow overrides for this tick (−1..1, 0 = autopilot). */
  override: { pitch: number; roll: number; yaw: number };
  /** Move the aim (or the free-look camera) by angles in radians. Positive dx = right, dy = up. */
  moveAim(dx: number, dy: number): void;
  setThrottle(value: number): void;
  /** Aim at the horizon straight ahead; the autopilot levels the wings. */
  autoLevel(plane: PlaneState): void;
  /** Snap the aim to the plane's nose (after spawning). */
  resetTo(plane: PlaneState): void;
  aimDir(): Vec3;
  sample(plane: PlaneState, dt: number): ControlInput;
}

export function createPlayerControls(): PlayerControls {
  const pd = createAimPd();
  const aim = { yaw: 0, pitch: 0 };
  const look = { yaw: 0, pitch: 0 };

  const followNose = (plane: PlaneState): void => {
    const nose = yawPitchFromDir(rotate(plane.quat, FORWARD));
    aim.yaw = nose.yaw;
    aim.pitch = nose.pitch;
  };

  const c: PlayerControls = {
    aim,
    look,
    freeLook: false,
    throttle: 0.8,
    fire: false,
    missile: false,
    flare: false,
    override: { pitch: 0, roll: 0, yaw: 0 },
    moveAim(dx, dy) {
      if (c.freeLook) {
        look.yaw += dx;
        look.pitch = clamp(look.pitch + dy, -1.2, 1.2);
        return;
      }
      aim.yaw += dx;
      aim.pitch = clamp(aim.pitch + dy, -MAX_AIM_PITCH, MAX_AIM_PITCH);
    },
    setThrottle(value) {
      c.throttle = clamp(value, 0, 1);
    },
    autoLevel(plane) {
      const nose = rotate(plane.quat, FORWARD);
      aim.yaw = yawPitchFromDir(nose).yaw;
      aim.pitch = 0;
    },
    resetTo(plane) {
      followNose(plane);
      look.yaw = 0;
      look.pitch = 0;
      c.throttle = plane.throttle;
    },
    aimDir() {
      return dirFromYawPitch(aim.yaw, aim.pitch);
    },
    sample(plane, dt) {
      const o = c.override;
      const nose = rotate(plane.quat, FORWARD);
      const aimNow = c.aimDir();
      const lead = Math.acos(clamp(aimNow[0] * nose[0] + aimNow[1] * nose[1] + aimNow[2] * nose[2], -1, 1));
      if (lead > MAX_LEAD) {
        // Slide the aim back along the arc toward the nose until it is MAX_LEAD away.
        const t = 1 - MAX_LEAD / lead;
        const mixed: Vec3 = [aimNow[0] + (nose[0] - aimNow[0]) * t, aimNow[1] + (nose[1] - aimNow[1]) * t, aimNow[2] + (nose[2] - aimNow[2]) * t];
        const back = yawPitchFromDir(normalize(mixed));
        aim.yaw = back.yaw;
        aim.pitch = clamp(back.pitch, -MAX_AIM_PITCH, MAX_AIM_PITCH);
      }
      const steer = aimControl(plane, c.aimDir(), pd, dt, o);
      // While flying on direct pitch control (arrow keys), keep the aim glued to the nose so the
      // autopilot doesn't yank the plane back when the key is released.
      if (o.pitch !== 0) followNose(plane);
      return { ...steer, throttle: c.throttle, fire: c.fire, missile: c.missile, flare: c.flare };
    },
  };
  return c;
}
