// Arcade flight model with energy. Pure data in, pure data out: no Three.js, no DOM.
//
// Speed is one energy budget: thrust adds to it, drag and hard turns take from it, and gravity trades it
// with altitude (dives gain speed, climbs lose it). Below stall speed the wings stop holding the plane up:
// the controls go soft, the flight path sags and the nose falls toward the ground until speed returns.
import type { Era, Plane } from '../data/types';
import { flapStepOf, type ControlInput } from './controls';
import {
  add,
  clamp,
  cross,
  FORWARD,
  len,
  normalize,
  quatFromAxisAngle,
  quatMul,
  quatNormalize,
  RIGHT,
  rotate,
  scale,
  smoothstep,
  UP,
  type Quat,
  type Vec3,
} from './math';

export const G = 9.81;

export type Team = 'red' | 'blue';

/** One plane's simulation state. Plain JSON: Day 5 sends it over the network. */
export interface PlaneState {
  id: string;
  team: Team;
  planeId: string;
  pos: Vec3;
  quat: Quat;
  vel: Vec3;
  throttle: number;
  hp: number;
  stalled: boolean;
  alive: boolean;
  /** Current load factor, for the HUD and speed bleed. */
  g: number;
  /** Near the map edge: the HUD warns. */
  edgeWarning: boolean;
  /** Past the edge: the autopilot is turning the plane back. */
  autoTurn: boolean;
  /** Seconds until respawn after a crash, or 0. */
  respawnIn: number;
  maxHp: number;
  /** Seconds of spawn protection left (no damage taken). */
  protectedFor: number;
  /** Parts knocked out: engine (top speed −30%, smoke), wings (roll and turn −25%). */
  damaged: { engine: boolean; wingL: boolean; wingR: boolean };
  /** Damage taken per part this life, used to decide when a part is knocked out. */
  partDamage: { fuselage: number; wingL: number; wingR: number; engine: number };
  /** Seconds of fire left; burning drains HP. */
  fireFor: number;
  /** Damage taken this life by shooter id, for kill and assist credit. */
  damageBy: Record<string, number>;
  lastHitBy: string | null;
  lastHitAt: number;
  /** Shot down and falling; hits the ground with an explosion. */
  wreck: boolean;
  /** Ammo left per gun mount (same order as planes.json guns), and the fire-rate accumulators. */
  ammo: number[];
  gunHeat: number[];
  /** Touch aim-assist strength 0–1 (bullet magnetism within 2°); 0 for mouse players and bots. */
  assist: number;
  /** Guns firing this tick (drives muzzle flashes). */
  firing: boolean;
  /** Missiles left per missile mount (same order as planes.json missiles). */
  missiles: number[];
  flares: number;
  chaff: number;
  /** Who our seeker is locking (or has locked), with which mount, and how far along (0–1). */
  lockTarget: string | null;
  lockMount: number;
  lockProgress: number;
  missileCooldown: number;
  cmCooldown: number;
  /** Missile button held last tick: launches need a fresh press. */
  missileHeld: boolean;
  /** Unguided rockets and bombs left (Late WW2 attackers), and the release interval timer. */
  rockets: number;
  bombs: number;
  ordnanceCooldown: number;
  /** WEP / afterburner lit this tick; engine heat 0–1 (1 = overheated); seconds of reduced power left. */
  wep: boolean;
  engineHeat: number;
  overheatFor: number;
  airbrake: boolean;
  flaps: boolean;
  /** Day 12: flap setting (0 Up, 1 Combat, 2 Takeoff, 3 Landing) and landing gear down. Optional: older states
   *  and scripted planes leave them out (flaps then means Landing). */
  flapStep?: number;
  gear?: boolean;
  /** Radar (jets that have one): power, mode, display range index, the radar-locked plane, and how long the
   *  locked target has been out of the radar's view (the lock drops after RADAR_MEMORY_S). */
  radarOn: boolean;
  radarMode: 'search' | 'dogfight';
  radarRange: number;
  radarLock: string | null;
  radarLostFor: number;
  /** Secondary weapon the pilot picked (a missile mount, or 0 rockets / 1 bombs), −1 = automatic. */
  secondary: number;
  /**
   * Realistic flight model only (flightSim.ts; absent in Arcade). Body rates in rad/s as [roll, pitch, yaw]
   * (roll right, nose up and nose right positive), control surface positions [aileron, elevator, rudder] in
   * −1..1 as they follow the stick, flap position 0..1, angle of attack and sideslip in radians.
   */
  rates?: Vec3;
  surfaces?: Vec3;
  flapPos?: number;
  aoa?: number;
  slip?: number;
}

/** Derived flight numbers for one plane type. Computed once from planes.json + eras.json. */
export interface FlightParams {
  topSpeedMs: number;
  stallSpeedMs: number;
  cornerSpeedMs: number;
  thrustAccel: number;
  dragK: number;
  /** The plane's turn rate from planes.json (the Realistic model's sustained turn is calibrated to it). */
  turnRateRad: number;
  pitchRateRad: number;
  rollRateRad: number;
  yawRateRad: number;
  maxG: number;
  ceilingM: number;
  wepTimeS: number;
}

/**
 * Real top speeds compressed above 750 km/h so a Mach 2 jet doesn't cross the 16 km map in 20 seconds.
 * 594 km/h stays 594; 1,100 → 890; 2,400 → 1,410.
 */
export function gameTopSpeedKmh(realKmh: number): number {
  return realKmh <= 750 ? realKmh : 750 + (realKmh - 750) * 0.4;
}

export function flightParams(plane: Plane, era: Era): FlightParams {
  const topSpeedMs = gameTopSpeedKmh(plane.stats.topSpeedKmh) / 3.6;
  const stallSpeedMs = topSpeedMs * era.stallSpeedRatio;
  // Thrust grows with climb rate, so jets accelerate much harder than biplanes.
  const thrustAccel = clamp(2.5 + plane.stats.climbMs * 0.06, 2.5, 18);
  const deg = Math.PI / 180;
  return {
    topSpeedMs,
    stallSpeedMs,
    cornerSpeedMs: stallSpeedMs + (topSpeedMs - stallSpeedMs) * 0.35,
    thrustAccel,
    // Drag balances full thrust exactly at top speed in level flight.
    dragK: thrustAccel / (topSpeedMs * topSpeedMs),
    turnRateRad: plane.stats.turnRateDegS * deg,
    pitchRateRad: plane.stats.turnRateDegS * 1.6 * deg,
    rollRateRad: plane.stats.rollRateDegS * deg,
    yawRateRad: plane.stats.turnRateDegS * 0.35 * deg,
    maxG: plane.era === 'ww1' ? 6 : plane.era.endsWith('ww2') ? 7.5 : 9,
    ceilingM: era.ceilingM,
    wepTimeS: era.wepTimeS,
  };
}

export interface FlightEnv {
  /** Height of whatever the plane would hit (ground or water). */
  surfaceAt(x: number, z: number): number;
  /** Half the map width; the playable square is −half..half on x and z. */
  half: number;
}

const EDGE_WARN = 700; // metres inside the edge where the warning starts
const TURN_BACK_UNTIL = 1600; // auto-turn holds until this far back inside
const CRASH_CLEARANCE = 1.5;
const THROTTLE_SPOOL = 0.9; // throttle change per second
const BLEED_PER_G = 0.22; // fraction of thrust lost per extra G in a turn
const WING_DAMAGE_MUL = 0.75; // a damaged wing costs 25% roll and turn
/** Thrust at 100% throttle without WEP: top speed (drag ∝ v²) is √0.85 ≈ 92% of the real figure; WEP gives the rest. */
export const MIL_THRUST = 0.85;
/** Seconds to cool from overheated to cold with WEP off. */
const WEP_COOL_S = 30;
/** An overheated engine runs at this much thrust for OVERHEAT_S. */
export const OVERHEAT_S = 10;
const OVERHEAT_POWER = 0.45;
/** Airbrake drag on top of normal drag (×), and flaps: lower stall speed, more pitch at low speed, some drag. */
const AIRBRAKE_DRAG = 1.6;
const FLAPS_STALL = 0.85;
const FLAPS_DRAG = 0.35;
/** Flaps only work below this fraction of top speed (they'd be torn off above it, so they simply don't count). */
const FLAPS_MAX_SPEED = 0.6;
/** How much of the full (Landing) flap effect each setting gives: Up, Combat, Takeoff, Landing. Combat flaps
 *  cost little drag; Landing flaps the most. */
export const FLAP_EFFECT = [0, 0.35, 0.65, 1] as const;
const FLAP_DRAG_SHARE = [0, 0.15, 0.4, 1] as const;
/** Lowered landing gear adds this much to the plane's parasitic drag (×). */
export const GEAR_DRAG = 0.3;
/** The flap setting a state is in (states from before Day 12 only had the on/off switch). */
export const flapStepOfState = (s: PlaneState): number => (s.flapStep !== undefined ? s.flapStep : s.flaps ? 3 : 0);

/**
 * Engine and switches, shared by both flight models: throttle spool, WEP (afterburner on jets) that only lights
 * at full throttle and heats the engine, overheating at full heat (reduced power for OVERHEAT_S while it cools),
 * airbrake and flaps switches. Returns the engine power as a fraction of full (WEP) thrust.
 */
export function stepEngine(s: PlaneState, input: ControlInput, p: FlightParams, dt: number): number {
  const cmd = clamp(input.throttle, 0, 1);
  s.throttle += clamp(cmd - s.throttle, -THROTTLE_SPOOL * dt, THROTTLE_SPOOL * dt);
  s.wep = Boolean(input.wep) && cmd >= 0.999 && s.throttle >= 0.97 && s.overheatFor <= 0;
  if (s.overheatFor > 0) {
    s.overheatFor = Math.max(0, s.overheatFor - dt);
    s.engineHeat = Math.max(0, s.engineHeat - dt / WEP_COOL_S);
  } else if (s.wep) {
    s.engineHeat = Math.min(1, s.engineHeat + dt / p.wepTimeS);
    if (s.engineHeat >= 1) {
      s.overheatFor = OVERHEAT_S;
      s.wep = false;
    }
  } else {
    s.engineHeat = Math.max(0, s.engineHeat - dt / WEP_COOL_S);
  }
  s.airbrake = Boolean(input.airbrake);
  const step = flapStepOf(input);
  s.flaps = step > 0;
  if (input.flapStep !== undefined || s.flapStep !== undefined) s.flapStep = step;
  if (input.gear !== undefined || s.gear !== undefined) s.gear = Boolean(input.gear);
  return s.overheatFor > 0 ? Math.min(OVERHEAT_POWER, s.throttle) : s.throttle * MIL_THRUST + (s.wep ? 1 - MIL_THRUST : 0);
}

/** Thrust acceleration (m/s²) for an engine power fraction: thinner air near the ceiling, a hit engine at 49%. */
export function thrustFor(s: PlaneState, p: FlightParams, power: number): number {
  const ceilingFade = clamp((p.ceilingM - s.pos[1]) / (0.3 * p.ceilingM), 0, 1);
  // Drag balances thrust at v², so 0.49× thrust is 0.7× top speed: an engine hit costs 30% top speed.
  return p.thrustAccel * power * ceilingFade * (s.damaged.engine ? 0.49 : 1);
}

/**
 * Advance one plane by dt seconds. Mutates and returns `s` (cheap at 60 Hz; the caller owns the object).
 * `input` must already be clamped; the map-edge autopilot may override it.
 */
export function stepPlane(s: PlaneState, input: ControlInput, p: FlightParams, env: FlightEnv, dt: number): PlaneState {
  if (!s.alive) return s;
  const power = stepEngine(s, input, p, dt);

  const forward = rotate(s.quat, FORWARD);
  let speed = len(s.vel);
  const flapsOn = s.flaps && speed < p.topSpeedMs * FLAPS_MAX_SPEED;
  const flapStep = flapStepOfState(s);
  const flapF = flapsOn ? FLAP_EFFECT[flapStep]! : 0;
  const stallSpeed = p.stallSpeedMs * (1 - (1 - FLAPS_STALL) * flapF);

  // Lift: 0 when far below stall speed, 1 comfortably above it.
  const lift = smoothstep(0.7 * stallSpeed, 1.05 * stallSpeed, speed);
  if (speed < stallSpeed) s.stalled = true;
  else if (speed > stallSpeed * 1.12) s.stalled = false;

  // Controls lose bite in a stall and are also limited near stall speed (not enough air over the surfaces).
  const wingHit = s.damaged.wingL || s.damaged.wingR;
  const authority =
    (s.stalled ? 0.3 : 0.35 + 0.65 * smoothstep(stallSpeed, p.cornerSpeedMs, speed) + 0.12 * flapF) * (wingHit ? WING_DAMAGE_MUL : 1);

  // Pitch rate limited by the plane's G limit at this speed: ω = (G − 1)·g / v.
  const gLimitedRate = speed > 1 ? ((p.maxG - 1) * G) / speed : p.pitchRateRad;
  const pitchRate = clamp(input.pitch, -1, 1) * Math.min(p.pitchRateRad * authority, gLimitedRate);
  const rollRate = clamp(input.roll, -1, 1) * p.rollRateRad * authority;
  const yawRate = clamp(input.yaw, -1, 1) * p.yawRateRad * authority;

  // Local rotations (planes face +Z, +X is the left wing): nose up = −X rotation, roll right = +Z, yaw right = −Y.
  let q = s.quat;
  q = quatMul(q, quatFromAxisAngle([1, 0, 0], -pitchRate * dt));
  q = quatMul(q, quatFromAxisAngle([0, 0, 1], rollRate * dt));
  q = quatMul(q, quatFromAxisAngle([0, 1, 0], -yawRate * dt));

  // Stalled planes weathervane into the falling airflow and drop their nose.
  if (lift < 1 && speed > 0.5) {
    const f = rotate(q, FORWARD);
    const down: Vec3 = [0, -1, 0];
    const target = normalize(add(normalize(s.vel), scale(down, 0.6)));
    const axis = cross(f, target);
    const sinA = len(axis);
    if (sinA > 1e-4) {
      const angle = Math.min(Math.asin(clamp(sinA, -1, 1)), 1.4 * (1 - lift) * dt);
      q = quatMul(quatFromAxisAngle(scale(axis, 1 / sinA), angle), q);
    }
  }
  s.quat = quatNormalize(q);

  // Energy along the flight path.
  const thrust = thrustFor(s, p, power);
  const drag =
    p.dragK * speed * speed * (1 + (s.airbrake ? AIRBRAKE_DRAG : 0) + (flapsOn ? FLAPS_DRAG * FLAP_DRAG_SHARE[flapStep]! : 0) + (s.gear ? GEAR_DRAG : 0));
  const loadG = 1 + (speed * Math.abs(pitchRate)) / G;
  const bleed = p.thrustAccel * BLEED_PER_G * (loadG - 1);
  const overspeed = speed > p.topSpeedMs * 1.2 ? (speed - p.topSpeedMs * 1.2) * 0.8 : 0;
  speed += (thrust - drag - bleed - overspeed - G * forward[1]) * dt;
  speed = Math.max(0, speed);
  s.g = loadG;

  // Flight path follows the nose while the wings fly; without lift, gravity takes over.
  const newForward = rotate(s.quat, FORWARD);
  const velDir = speed > 0.5 ? normalize(s.vel) : newForward;
  const follow = clamp(4 * lift * dt, 0, 1);
  const dir = normalize(add(scale(velDir, 1 - follow), scale(newForward, follow)));
  s.vel = scale(dir, speed);
  s.vel[1] -= G * (1 - lift) * dt;

  s.pos = add(s.pos, scale(s.vel, dt));
  return checkEdgeAndGround(s, env);
}

/** Map-edge warning and auto-turn, and the crash check against the ground or water (both flight models). */
export function checkEdgeAndGround(s: PlaneState, env: FlightEnv): PlaneState {
  const edge = Math.max(Math.abs(s.pos[0]), Math.abs(s.pos[2]));
  s.edgeWarning = edge > env.half - EDGE_WARN;
  if (edge > env.half) s.autoTurn = true;
  else if (edge < env.half - TURN_BACK_UNTIL) s.autoTurn = false;
  if (s.pos[1] - CRASH_CLEARANCE <= env.surfaceAt(s.pos[0], s.pos[2])) {
    s.alive = false;
    s.vel = [0, 0, 0];
    s.g = 1;
  }
  return s;
}

/** A shot-down plane: tumbles and falls until it hits the ground. Returns true on impact. */
export function stepWreck(s: PlaneState, env: FlightEnv, dt: number): boolean {
  s.vel[1] -= G * dt;
  s.vel = scale(s.vel, 1 - 0.15 * dt);
  s.pos = add(s.pos, scale(s.vel, dt));
  s.quat = quatNormalize(quatMul(s.quat, quatFromAxisAngle([0, 0, 1], 2.2 * dt)));
  if (s.pos[1] - CRASH_CLEARANCE <= env.surfaceAt(s.pos[0], s.pos[2])) {
    s.wreck = false;
    s.vel = [0, 0, 0];
    return true;
  }
  return false;
}

/** Steering that flies the plane back toward the map centre; used while autoTurn is set. */
export function edgeTurnInput(s: PlaneState, base: ControlInput): ControlInput {
  const toCenter = normalize([-s.pos[0], 0, -s.pos[2]]);
  const local = rotate([-s.quat[0], -s.quat[1], -s.quat[2], s.quat[3]], toCenter);
  const right = rotate(s.quat, RIGHT);
  const up = rotate(s.quat, UP);
  const yawErr = Math.atan2(-local[0], local[2]); // positive = target to the right
  const bankWanted = clamp(yawErr, -1, 1) * 1.0; // ~57° bank toward the centre
  const bank = Math.atan2(-right[1], up[1]); // positive = banked right
  const levelPitch = -rotate(s.quat, FORWARD)[1] * 2; // hold the nose near the horizon
  return {
    ...base,
    roll: clamp((bankWanted - bank) * 2.5, -1, 1),
    pitch: clamp(0.55 * Math.abs(clamp(yawErr, -1, 1)) + levelPitch, -1, 1),
    yaw: clamp(yawErr, -1, 1) * 0.5,
    throttle: Math.max(base.throttle, 0.7),
  };
}

export const speedKmh = (s: PlaneState): number => len(s.vel) * 3.6;

