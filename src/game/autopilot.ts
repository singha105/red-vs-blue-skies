// "Mouse aim" autopilot (War Thunder style, as in the open-source MouseFlight project): the player moves an
// aim direction and this PD controller works out pitch, roll and yaw to put the nose on it.
// Bots (Day 3) use it too, so they fly through exactly the same ControlInput as players.
import type { ControlInput } from './controls';
import type { PlaneState } from './flight';
import { clamp, FORWARD, quatConj, RIGHT, rotate, UP, type Vec3 } from './math';

/** Previous errors for the derivative term. Plain data; one per controlled plane. */
export interface AimPdState {
  pitchErr: number;
  yawErr: number;
  rollErr: number;
  primed: boolean;
}

export function createAimPd(): AimPdState {
  return { pitchErr: 0, yawErr: 0, rollErr: 0, primed: false };
}

const KP_PITCH = 3.2;
const KD_PITCH = 0.35;
const KP_YAW = 2.2;
const KD_YAW = 0.2;
const KP_ROLL = 2.4;
const KD_ROLL = 0.25;
/** Beyond this angle off the nose, roll hard toward the target; inside it, level the wings. */
const AGGRESSIVE_DEG = 12;

/**
 * Pitch/roll/yaw that steer `s` toward world direction `aim`. Updates `pd` in place.
 * `override` (keyboard A/D, arrows) replaces the autopilot on that axis when non-zero.
 */
export function aimControl(
  s: PlaneState,
  aim: Vec3,
  pd: AimPdState,
  dt: number,
  override: { pitch?: number; roll?: number; yaw?: number } = {},
): Pick<ControlInput, 'pitch' | 'roll' | 'yaw'> {
  const local = rotate(quatConj(s.quat), aim);
  // Local frame: +Z forward, +Y up, −X right.
  const pitchErr = Math.atan2(local[1], Math.max(local[2], 1e-3));
  const yawErr = Math.atan2(-local[0], Math.max(local[2], 1e-3));
  const angleOff = Math.acos(clamp(local[2], -1, 1));

  // Roll so the target ends up "above" the canopy, then pull. Near the nose, hold the wings level instead.
  const aggressiveRollErr = Math.atan2(-local[0], local[1] + 0.25);
  const right = rotate(s.quat, RIGHT);
  const up = rotate(s.quat, UP);
  const levelRollErr = Math.atan2(right[1], up[1]); // positive = right wing high → roll right
  const influence = clamp(angleOff / ((AGGRESSIVE_DEG * Math.PI) / 180), 0, 1);
  const rollErr = levelRollErr + (aggressiveRollErr - levelRollErr) * influence;

  const d = (now: number, prev: number): number => (pd.primed && dt > 0 ? (now - prev) / dt : 0);
  const pitch = clamp(KP_PITCH * pitchErr + KD_PITCH * d(pitchErr, pd.pitchErr), -1, 1);
  const yaw = clamp(KP_YAW * yawErr + KD_YAW * d(yawErr, pd.yawErr), -1, 1);
  const roll = clamp(KP_ROLL * rollErr + KD_ROLL * d(rollErr, pd.rollErr), -1, 1);

  // "+ 0" turns −0 into 0 so the state survives a JSON round trip unchanged.
  pd.pitchErr = pitchErr + 0;
  pd.yawErr = yawErr + 0;
  pd.rollErr = rollErr + 0;
  pd.primed = true;

  return {
    pitch: override.pitch ? clamp(override.pitch, -1, 1) : pitch,
    roll: override.roll ? clamp(override.roll, -1, 1) : roll,
    yaw: override.yaw ? clamp(override.yaw, -1, 1) : yaw,
  };
}

/** Where the nose points, for the HUD's nose marker. */
export const noseDir = (s: PlaneState): Vec3 => rotate(s.quat, FORWARD);
