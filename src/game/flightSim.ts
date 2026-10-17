// Realistic flight model (Settings → Flight model → Realistic; solo matches for now). Forces and moments instead of
// Arcade's "the stick sets a turn rate and the flight path follows the nose":
//
// - The stick moves control surfaces (aileron, elevator, rudder), which follow it at a servo rate. Each surface
//   makes a moment that grows with dynamic pressure (½ρv²), and the plane's rotation is damped by the air in
//   proportion to ρv, so the controls are stiff and quick when fast and soft and slow when slow, by themselves.
// - The wing makes lift from the angle of attack (the angle between the nose and the flight path): linear up to
//   the critical angle, then the wing stalls, loses lift and drops a wing. You can stall at any speed by pulling
//   too hard. Lift acts perpendicular to the flight path, so turning is the lift vector pulling the path around.
// - Drag is parasitic (∝ v²) plus induced (∝ lift²/v²), so hard turns bleed energy because they need lift.
// - Sideslip (the nose pointing off the flight path sideways) makes the tail weathervane the nose back, a side
//   force, and a roll away from the slip (dihedral effect): the rudder yaws the nose and then rolls the plane.
//   Ailerons yaw the nose the wrong way a little (adverse yaw).
// - Flaps add lift (stall speed −15%), drag and a nose-down moment; the airbrake adds drag. Thinner air at
//   altitude (ρ falls ~1/e per 9 km) raises the stall speed and slows the controls.
// - A shot-up wing loses a quarter of its lift, so the plane rolls toward it.
//
// Every coefficient is calibrated per plane from planes.json (simParams): stall speed at 1 G, top speed with full
// power, the listed roll rate at the reference (corner) speed and the listed turn rate as the best sustained turn
// (it sets the induced drag). So the Realistic model keeps each plane's character and the Arcade balancing.
// Plain data in, plain data out (the extra state lives in optional PlaneState fields), deterministic.
import type { ControlInput } from './controls';
import { checkEdgeAndGround, FLAP_EFFECT, flapStepOfState, G, GEAR_DRAG, stepEngine, thrustFor, type FlightEnv, type FlightParams, type PlaneState } from './flight';
import { add, clamp, dot, FORWARD, len, normalize, quatConj, quatFromAxisAngle, quatMul, quatNormalize, RIGHT, rotate, scale, smoothstep, UP, type Vec3 } from './math';

/** Per-plane coefficients, derived once from the plane's FlightParams. */
export interface SimParams {
  /** Clean stall speed at sea level and 1 G (m/s). */
  vs: number;
  /** Reference speed for the control calibration: the plane's corner speed (m/s). */
  vRef: number;
  vTop: number;
  /** Full-power (WEP) thrust acceleration (m/s²). */
  thrust: number;
  /** Parasitic drag: a = cd0·σv². */
  cd0: number;
  /** Induced drag: a = ki·aLift² / (σv²). */
  ki: number;
  /** Elevator-neutral angle of attack (the plane's built-in trim), radians. */
  alpha0: number;
  rollRate: number;
  maxG: number;
  /** Best sustained turn the calibration reached (rad/s): the listed turn rate unless the wing can't hold it. */
  sustainedTurn: number;
}

/** Critical angle of attack (clean wing): lift is linear below it, the wing stalls above it. */
export const ALPHA_CRIT = (15 * Math.PI) / 180;
/** Full back stick trims to this × the critical angle (enough to stall when slow and the G limit allows). */
const ALPHA_FULL = 1.35;
/** Seconds for the roll rate to settle at the reference speed (shorter when faster: damping ∝ ρv). */
const ROLL_K = 5;
/** Pitch: stiffness (short-period ω² at the reference speed is M_ALPHA) and damping. */
const M_ALPHA = 16;
const M_Q = 2.5;
/** Yaw: weathervane stiffness, damping, full-rudder steady sideslip (rad), adverse yaw (share of the rudder's). */
const N_BETA = 9;
const N_R = 3;
const RUDDER_SLIP = 0.14;
const ADVERSE_YAW = 0.15;
/** Roll away from sideslip (dihedral effect), rad/s² per radian of slip at the reference speed. */
const L_BETA = 4;
/** Side force from sideslip, as a share of the lift the wing would make at the critical angle. */
const SIDE_K = 0.6;
/** Surfaces travel at this many full deflections per second; flaps take two seconds. */
const SURFACE_RATE = 5;
const FLAP_RATE = 0.5;
/** Flaps: +38% lift (stall speed × 0.85), +35% parasitic drag, nose-down trim, critical angle −1°. */
const FLAP_LIFT = 0.38;
const FLAP_DRAG = 0.35;
const FLAP_PITCH = (-1.5 * Math.PI) / 180;
const FLAP_ALPHA = (1 * Math.PI) / 180;
/** Flaps only deploy below this share of top speed (as in Arcade). */
const FLAPS_MAX_SPEED = 0.6;
const AIRBRAKE_DRAG = 1.6;
/** Stalled wing: autorotation pushes the roll on (rad/s² at the reference speed). */
const WING_DROP = 6;
/** A damaged wing: its lift and aileron are down 25%; the asymmetry rolls the plane toward it. */
const WING_DAMAGE_LIFT = 0.25;
const WING_ASYM = 2.5;
/** Air density falls about 1/e every this many metres. */
const DENSITY_SCALE_M = 9000;
const SUBSTEPS = 2;
/** Safety limit on body rates (rad/s), far above anything the coefficients produce in normal flight. */
const MAX_RATE = 10;

/** Lift coefficient as a share of the clean maximum, for an angle of attack: linear, then stalled. */
export function liftShape(alpha: number, alphaCrit: number): number {
  const x = alpha / alphaCrit;
  const ax = Math.abs(x);
  if (ax <= 1) return x;
  // Past the critical angle: lift falls by 40% over the next half of it, and to nothing as the wing goes broadside.
  const post = 1 - 0.4 * smoothstep(1, 1.5, ax);
  return Math.sign(x) * post * Math.max(0, Math.cos(alpha) / Math.cos(alphaCrit));
}

/** Best sustained turn rate (rad/s) for given drag coefficients: thrust = drag, lift within the wing and G limit. */
function sustainedTurn(p: FlightParams, ki: number): number {
  const vs = p.stallSpeedMs;
  const vt = p.topSpeedMs;
  const t = p.thrustAccel;
  const cd0 = (t - (ki * G * G) / (vt * vt)) / (vt * vt);
  let best = 0;
  for (let i = 0; i <= 240; i++) {
    const v = vs + ((vt - vs) * i) / 240;
    const nThrust = Math.sqrt(Math.max(0, t - cd0 * v * v) * v * v / ki) / G;
    const n = Math.min(nThrust, (v / vs) ** 2, p.maxG);
    if (n > 1) best = Math.max(best, (G * Math.sqrt(n * n - 1)) / v);
  }
  return best;
}

/** Calibrates the Realistic model to one plane (see the header). */
export function simParams(p: FlightParams): SimParams {
  const vs = p.stallSpeedMs;
  const vt = p.topSpeedMs;
  // Induced drag sets the sustained turn: bisect it (log scale) so the best sustained turn is the listed rate.
  // Parasitic drag then takes the rest of the thrust at top speed, so top speed stays the listed one.
  const kiMax = (0.9 * p.thrustAccel * vt * vt) / (G * G);
  let lo = kiMax * 1e-4;
  let hi = kiMax;
  const target = p.turnRateRad;
  let ki: number;
  if (sustainedTurn(p, lo) <= target) ki = lo;
  else if (sustainedTurn(p, hi) >= target) ki = hi;
  else {
    for (let i = 0; i < 50; i++) {
      const mid = Math.sqrt(lo * hi);
      if (sustainedTurn(p, mid) > target) lo = mid;
      else hi = mid;
    }
    ki = Math.sqrt(lo * hi);
  }
  const cd0 = (p.thrustAccel - (ki * G * G) / (vt * vt)) / (vt * vt);
  return {
    vs,
    vRef: p.cornerSpeedMs,
    vTop: vt,
    thrust: p.thrustAccel,
    cd0,
    ki,
    // Trimmed for level flight at about 70% of top speed with the stick centred.
    alpha0: Math.min(0.3, (vs / (0.7 * vt)) ** 2) * ALPHA_CRIT,
    rollRate: p.rollRateRad,
    maxG: p.maxG,
    sustainedTurn: sustainedTurn(p, ki),
  };
}

const approach = (cur: number, target: number, step: number): number => cur + clamp(target - cur, -step, step);

/** Air density as a share of sea level. */
export const densityAt = (altitudeM: number): number => Math.exp(-Math.max(0, altitudeM) / DENSITY_SCALE_M);

/**
 * Advance one plane by dt seconds with the Realistic model. Mutates and returns `s`, like stepPlane.
 * `input.pitch/roll/yaw` are stick and pedal positions (−1..1) here, not turn rates.
 */
export function stepPlaneSim(s: PlaneState, input: ControlInput, p: FlightParams, sp: SimParams, env: FlightEnv, dt: number): PlaneState {
  if (!s.alive) return s;
  const power = stepEngine(s, input, p, dt);
  const thrust = thrustFor(s, p, power);
  s.rates ??= [0, 0, 0];
  s.surfaces ??= [0, 0, 0];
  s.flapPos ??= 0;
  const h = dt / SUBSTEPS;
  for (let i = 0; i < SUBSTEPS; i++) substep(s, input, sp, thrust, h);
  return checkEdgeAndGround(s, env);
}

function substep(s: PlaneState, input: ControlInput, sp: SimParams, thrust: number, h: number): void {
  const rates = s.rates!;
  const surf = s.surfaces!;
  const v = len(s.vel);
  const forward = rotate(s.quat, FORWARD);
  const up = rotate(s.quat, UP);
  const right = rotate(s.quat, RIGHT);
  const vHat = v > 0.5 ? scale(s.vel, 1 / v) : forward;

  // Airflow in body axes: angle of attack (nose above the flight path = positive) and sideslip (the air coming
  // from the right = positive).
  const vb = rotate(quatConj(s.quat), s.vel);
  const alpha = v > 1 ? Math.atan2(-vb[1], vb[2]) : 0;
  const beta = v > 1 ? Math.atan2(-vb[0], Math.hypot(vb[1], vb[2])) : 0;

  const sigma = densityAt(s.pos[1]);
  const dyn = sigma * v * v;
  // Moments scale with dynamic pressure, damping with ρv; both are 1 at the reference speed at sea level.
  const qn = dyn / (sp.vRef * sp.vRef);
  const dn = (sigma * v) / sp.vRef;

  // Flaps run out and in at their own pace (and only deploy below their limit speed).
  const flapsWanted = s.flaps && v < sp.vTop * FLAPS_MAX_SPEED;
  s.flapPos = approach(s.flapPos!, flapsWanted ? FLAP_EFFECT[flapStepOfState(s)]! : 0, FLAP_RATE * h);
  const flap = s.flapPos;
  const alphaCrit = ALPHA_CRIT - FLAP_ALPHA * flap;
  const alphaFull = ALPHA_FULL * alphaCrit;
  const wingHits = (s.damaged.wingL ? 1 : 0) + (s.damaged.wingR ? 1 : 0);
  const liftMul = (1 + FLAP_LIFT * flap) * (1 - (WING_DAMAGE_LIFT / 2) * wingHits);
  // Lift acceleration at the critical angle, at this speed and height.
  const liftAtCrit = (G * dyn * liftMul) / (sp.vs * sp.vs);

  // The pilot's G limit: the elevator never asks for more angle of attack than maxG pulls (or half of it pushed),
  // which only bites above corner speed; slower than that, full back stick stalls the wing.
  let pitchCmd = clamp(input.pitch, -1, 1);
  if (liftAtCrit > 1e-6) {
    const alphaMaxG = (alphaCrit * sp.maxG * G) / liftAtCrit;
    pitchCmd = clamp(pitchCmd, (-0.5 * alphaMaxG - sp.alpha0) / (alphaFull - sp.alpha0), (alphaMaxG - sp.alpha0) / (alphaFull - sp.alpha0));
  }
  surf[0] = approach(surf[0], clamp(input.roll, -1, 1), SURFACE_RATE * h);
  surf[1] = approach(surf[1], pitchCmd, SURFACE_RATE * h);
  surf[2] = approach(surf[2], clamp(input.yaw, -1, 1), SURFACE_RATE * h);
  const [aileron, elevator, rudder] = surf;

  // How far into the stall: 0 below the critical angle, 1 at 1.3× it.
  const stall = clamp((Math.abs(alpha) - alphaCrit) / (0.3 * alphaCrit), 0, 1);

  // Roll: aileron moment ∝ ρv², damping ∝ ρv, so the steady roll rate grows with speed and reaches the listed rate
  // at the reference speed; above 1.3× it the stick forces cap it. A stalled wing damps less and drops.
  const aileronEff = aileron * (1 - 0.25 * Math.min(1, wingHits)) * Math.min(1, (1.3 * sp.vRef) / Math.max(v, 1)) * (1 - 0.6 * stall);
  let dp = ROLL_K * (qn * sp.rollRate * aileronEff - dn * rates[0] * (1 - 0.8 * stall)) - L_BETA * qn * beta;
  if (stall > 0) dp += WING_DROP * qn * stall * (rates[0] !== 0 ? Math.sign(rates[0]) : beta >= 0 ? 1 : -1);
  if (s.damaged.wingL) dp -= WING_ASYM * qn;
  if (s.damaged.wingR) dp += WING_ASYM * qn;

  // Pitch: the elevator sets the angle of attack the tail trims to; the tail pulls the nose there (stiffness ∝ ρv²)
  // against the air's damping (∝ ρv).
  const alphaTrim = sp.alpha0 + FLAP_PITCH * flap + elevator * (alphaFull - sp.alpha0);
  const dq = M_ALPHA * qn * (alphaTrim - alpha) - M_Q * dn * rates[1];

  // Yaw: the fin weathervanes the nose into the airflow, the rudder pushes it off, the ailerons a little the wrong way.
  const nRudder = N_BETA * RUDDER_SLIP;
  const dr = qn * (N_BETA * beta + nRudder * rudder - ADVERSE_YAW * nRudder * aileron) - N_R * dn * rates[2];

  rates[0] = clamp(rates[0] + dp * h, -MAX_RATE, MAX_RATE);
  rates[1] = clamp(rates[1] + dq * h, -MAX_RATE, MAX_RATE);
  rates[2] = clamp(rates[2] + dr * h, -MAX_RATE, MAX_RATE);

  // Local rotations as in Arcade (planes face +Z, +X is the left wing): nose up = −X, roll right = +Z, yaw right = −Y.
  let q = s.quat;
  q = quatMul(q, quatFromAxisAngle([1, 0, 0], -rates[1] * h));
  q = quatMul(q, quatFromAxisAngle([0, 0, 1], rates[0] * h));
  q = quatMul(q, quatFromAxisAngle([0, 1, 0], -rates[2] * h));
  s.quat = quatNormalize(q);

  // Forces. Lift is perpendicular to the flight path, in the plane of the wings' "up"; the side force opposes slip.
  const cl = liftShape(alpha, alphaCrit);
  const lift = liftAtCrit * cl;
  const liftDir = perpendicular(up, vHat, up);
  const sideDir = perpendicular(right, vHat, right);
  const side = (-SIDE_K * G * dyn * beta) / (sp.vs * sp.vs);
  const parasitic = sp.cd0 * dyn * (1 + (s.airbrake ? AIRBRAKE_DRAG : 0) + FLAP_DRAG * flap * flap + (s.gear ? GEAR_DRAG : 0) + 8 * beta * beta);
  const induced = dyn > 1 ? (sp.ki * lift * lift) / dyn : 0;
  // A stalled wing is mostly a flat plate: drag climbs past the critical angle.
  const stallDrag = (1.2 * G * dyn * Math.sin(Math.max(0, Math.abs(alpha) - alphaCrit)) ** 2) / (sp.vs * sp.vs);
  const drag = parasitic + induced + stallDrag;

  const acc = add(add(scale(forward, thrust), scale(liftDir, lift)), add(scale(sideDir, side), scale(vHat, -drag)));
  acc[1] -= G;
  s.vel = add(s.vel, scale(acc, h));
  s.pos = add(s.pos, scale(s.vel, h));

  s.aoa = alpha + 0;
  s.slip = beta + 0;
  s.g = lift / G + 0;
  if (stall > 0.3 || v < 0.6 * sp.vs) s.stalled = true;
  else if (stall === 0 && v > 0.7 * sp.vs) s.stalled = false;
}

/** `a` with its component along unit vector `n` removed, normalized (or `fallback` if that leaves nothing). */
function perpendicular(a: Vec3, n: Vec3, fallback: Vec3): Vec3 {
  const d = dot(a, n);
  const r: Vec3 = [a[0] - n[0] * d, a[1] - n[1] * d, a[2] - n[2] * d];
  return len(r) > 1e-6 ? normalize(r) : fallback;
}
