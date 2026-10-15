// Arcade flight model with energy. Pure data in, pure data out: no Three.js, no DOM.
//
// Speed is one energy budget: thrust adds to it, drag and hard turns take from it, and gravity trades it
// with altitude (dives gain speed, climbs lose it). Below stall speed the wings stop holding the plane up:
// the controls go soft, the flight path sags and the nose falls toward the ground until speed returns.
import type { Era, Plane } from '../data/types';
import type { ControlInput } from './controls';
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
}

/** Derived flight numbers for one plane type. Computed once from planes.json + eras.json. */
export interface FlightParams {
  topSpeedMs: number;
  stallSpeedMs: number;
  cornerSpeedMs: number;
  thrustAccel: number;
  dragK: number;
  pitchRateRad: number;
  rollRateRad: number;
  yawRateRad: number;
  maxG: number;
  ceilingM: number;
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
    pitchRateRad: plane.stats.turnRateDegS * 1.6 * deg,
    rollRateRad: plane.stats.rollRateDegS * deg,
    yawRateRad: plane.stats.turnRateDegS * 0.35 * deg,
    maxG: plane.era === 'ww1' ? 6 : plane.era.endsWith('ww2') ? 7.5 : 9,
    ceilingM: era.ceilingM,
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

/**
 * Advance one plane by dt seconds. Mutates and returns `s` (cheap at 60 Hz; the caller owns the object).
 * `input` must already be clamped; the map-edge autopilot may override it.
 */
export function stepPlane(s: PlaneState, input: ControlInput, p: FlightParams, env: FlightEnv, dt: number): PlaneState {
  if (!s.alive) return s;

  // Engine.
  const cmd = clamp(input.throttle, 0, 1);
  s.throttle += clamp(cmd - s.throttle, -THROTTLE_SPOOL * dt, THROTTLE_SPOOL * dt);

  const forward = rotate(s.quat, FORWARD);
  let speed = len(s.vel);

  // Lift: 0 when far below stall speed, 1 comfortably above it.
  const lift = smoothstep(0.7 * p.stallSpeedMs, 1.05 * p.stallSpeedMs, speed);
  if (speed < p.stallSpeedMs) s.stalled = true;
  else if (speed > p.stallSpeedMs * 1.12) s.stalled = false;

  // Controls lose bite in a stall and are also limited near stall speed (not enough air over the surfaces).
  const wingHit = s.damaged.wingL || s.damaged.wingR;
  const authority =
    (s.stalled ? 0.3 : 0.35 + 0.65 * smoothstep(p.stallSpeedMs, p.cornerSpeedMs, speed)) * (wingHit ? WING_DAMAGE_MUL : 1);

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
  const ceilingFade = clamp((p.ceilingM - s.pos[1]) / (0.3 * p.ceilingM), 0, 1);
  // Drag balances thrust at v², so 0.49× thrust is 0.7× top speed: an engine hit costs 30% top speed.
  const thrust = p.thrustAccel * s.throttle * ceilingFade * (s.damaged.engine ? 0.49 : 1);
  const drag = p.dragK * speed * speed;
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

  // Map edge.
  const edge = Math.max(Math.abs(s.pos[0]), Math.abs(s.pos[2]));
  s.edgeWarning = edge > env.half - EDGE_WARN;
  if (edge > env.half) s.autoTurn = true;
  else if (edge < env.half - TURN_BACK_UNTIL) s.autoTurn = false;

  // Ground or water.
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

