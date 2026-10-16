// Guided missiles and countermeasures. Pure simulation (no Three.js, no DOM), run by stepWorld on the host
// (or in solo). Ranges, speeds and G limits are game values scaled to the map (missiles.json).
//
// Seekers
// * IR sees engine heat: throttle and afterburner make a plane hotter (lockable from further away).
//   Rear-aspect IR also needs the target's tail in view. The sun within 10° of the seeker steals the lock.
// * Radar needs the launcher's radar locked (60° cone). It loses a target flying at 90° to it, because its
//   speed toward or away from the radar is near zero and it hides in the ground return ("notching").
//   Below 300 m altitude ground clutter halves radar range and widens the notch.
//   Semi-active missiles need the launcher's lock held until impact; active missiles carry their own
//   radar seeker (and still use the launcher's lock while it lasts).
// Guidance: proportional navigation (N = 4), limited by the missile's G. G available falls with speed², and
// after motor burnout the missile slows, so late in flight it can be outrun or out-turned.
// Countermeasures: each flare (IR) or chaff bundle (radar) rolls once per missile guiding on the plane;
// it decoys the missile with probability 1 − resistance.
import type { Missile, MissileClass, Plane } from '../data/types';
import type { ControlInput } from './controls';
import { G, type PlaneState } from './flight';
import { add, clamp, cross, dot, FORWARD, len, normalize, rotate, scale, type Vec3 } from './math';
import { SUN_DIR } from './sun';

export const PN_N = 4;
/** Proximity fuse radius (m): full damage inside FUSE_FULL_M, half at the edge. */
export const FUSE_M = 15;
const FUSE_FULL_M = 5;
/** Drag after burnout: dv/dt = −k·v² (800 m/s → about 430 m/s in 6 s). */
export const MISSILE_DRAG = 1.3e-4;
/** The motor adds to the launch speed: a fast launcher gives its missile more reach. */
const LAUNCH_SPEED_KEPT = 0.4;
/** Turning costs speed too (fraction of lateral acceleration). */
const TURN_DRAG = 0.12;
const MIN_SPEED_MS = 180;
export const SUN_CONE_DEG = 10;
/** Rear-aspect IR: the shooter must be within this many degrees of the target's six. */
export const REAR_ASPECT_DEG = 45;
/** Once in flight and close, a rear-aspect seeker keeps the hot exhaust until the target shows its beam. */
const REAR_ASPECT_FLIGHT_DEG = 90;
export const RADAR_CONE_DEG = 60;
/** A radar can't see a target whose speed along the line of sight is below this (notching). */
export const NOTCH_MS = 45;
export const CLUTTER_ALT_M = 300;
/** Missile seeker gimbal: beyond this angle off the missile's nose the target is lost. */
const MISSILE_GIMBAL_DEG = 60;
/** Active radar seeker range (the missile's own radar). */
export const ACTIVE_SEEKER_M = 4000;
/** Seconds a missile may coast without a valid track before it gives up (radar memory is longer, so a
 *  notch has to be held, not just flicked through). */
const TRACK_GRACE_S = { ir: 0.6, radar: 1.2 };
/** Inside this range an active seeker "goes pitbull": the notch window halves. */
const TERMINAL_M = 1500;
/** Each further decoy of the same kind is less convincing to a missile that has already ignored one. */
const DECOY_FADE = 0.6;
/** A missile that has lost its target flies on ballistic for this long, then self-destructs. */
const BALLISTIC_S = 4;
/** Flares hide an afterburner plume badly; chaff in a notch works much better. */
const FLARE_AB_FACTOR = 0.6;
const CHAFF_NOTCH_FACTOR = 1.5;
const LAUNCH_COOLDOWN_S = 0.9;
const CM_INTERVAL_S = 0.3;
const FLARE_LIFE_S = 3;
const CHAFF_LIFE_S = 2.5;
const DEG = Math.PI / 180;

export interface MissileState {
  id: number;
  type: string;
  owner: string;
  team: PlaneState['team'];
  /** Plane id, or a decoy id ("d12") once a flare or chaff has pulled it away, or null when lost. */
  target: string | null;
  pos: Vec3;
  vel: Vec3;
  age: number;
  /** Seconds since the seeker last had a valid track. */
  blind: number;
  /** Decoys already rolled against (each flare or chaff gets one chance per missile, each less than the last). */
  rolled: number[];
  /** Speed the motor drives toward while it burns (the missile's speed plus some of the launcher's). */
  boost: number;
}

export interface Decoy {
  id: number;
  kind: 'flare' | 'chaff';
  owner: string;
  pos: Vec3;
  vel: Vec3;
  age: number;
}

/** What the missile code needs from the world (kept small so tests can build one by hand). */
export interface MissileWorld {
  time: number;
  planes: PlaneState[];
  missiles: MissileState[];
  decoys: Decoy[];
  nextMissileId: number;
}

export interface MissileContext {
  missileDefs: Map<string, Missile>;
  missileClasses: Map<string, MissileClass>;
  planeDefs: Map<string, Plane>;
  surfaceAt(x: number, z: number): number;
  random(): number;
  /** The map's sun (IR seekers looking into it lose the target); SUN_DIR when missing. */
  sunDir?: Vec3;
}

export type MissileEvent =
  | { t: 'launch'; id: number; owner: string; target: string; missile: string }
  | { t: 'detonate'; id: number; pos: Vec3; victim: string | null }
  | { t: 'decoy'; kind: 'flare' | 'chaff'; owner: string; pos: Vec3; vel: Vec3 };

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** Angle between two vectors, without allocating (it runs for every plane pair, every tick). */
const angleBetween = (a: Vec3, b: Vec3): number => {
  const l = Math.sqrt((a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) * (b[0] * b[0] + b[1] * b[1] + b[2] * b[2]));
  return l < 1e-12 ? 0 : Math.acos(clamp((a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / l, -1, 1));
};

/** Jets light the afterburner with WEP at full throttle. */
export const afterburner = (p: PlaneState, def: Plane | undefined): boolean => Boolean(def && isJet(def) && p.wep);
export const isJet = (def: Plane): boolean => def.era === 'early_jets' || def.era === 'cold_war' || def.era === 'modern';

/** Engine heat as an IR seeker sees it: 0.55 idle … 1 full throttle, ×1.4 with afterburner. */
export function heatOf(p: PlaneState, def: Plane | undefined): number {
  let h = 0.55 + 0.45 * clamp(p.throttle, 0, 1);
  if (afterburner(p, def)) h *= 1.4;
  if (p.damaged.engine) h *= 0.8;
  return h;
}

/** Can an IR seeker at `from`, looking along `look`, see `target`'s heat? (null = yes, else the reason). */
export function irBlocked(from: Vec3, look: Vec3, target: PlaneState, def: Plane | undefined, m: Missile, cls: MissileClass, coneDeg: number, inFlight = false, sun: Vec3 = SUN_DIR): string | null {
  const los = sub(target.pos, from);
  const d = len(los);
  if (angleBetween(look, los) > coneDeg * DEG) return 'cone';
  // Range grows with heat; head-on, an all-aspect seeker only sees about 60% as far. (The angle between the
  // target's tail and the way back to the seeker equals the one between its nose and the line of sight.)
  const tailAngle = angleBetween(rotate(target.quat, FORWARD), los);
  if (cls.aspect === 'rear' && tailAngle > (inFlight ? REAR_ASPECT_FLIGHT_DEG : REAR_ASPECT_DEG) * DEG) return 'aspect';
  const aspectFactor = cls.aspect === 'rear' ? 1 : 0.6 + 0.4 * ((1 + Math.cos(tailAngle)) / 2);
  if (d > m.maxRangeM * Math.min(1.2, heatOf(target, def)) * aspectFactor) return 'range';
  if (angleBetween(los, sun) < SUN_CONE_DEG * DEG) return 'sun';
  return null;
}

/** Is the target notching this radar (speed along the line of sight near zero)? `windowScale` < 1 for a
 *  seeker that is hard to fool (an active missile in its terminal phase). */
export function notching(radarPos: Vec3, target: PlaneState, windowScale = 1): boolean {
  const lx = target.pos[0] - radarPos[0], ly = target.pos[1] - radarPos[1], lz = target.pos[2] - radarPos[2];
  const l = Math.hypot(lx, ly, lz) || 1;
  const radial = Math.abs((target.vel[0] * lx + target.vel[1] * ly + target.vel[2] * lz) / l);
  const window = (target.pos[1] < CLUTTER_ALT_M ? NOTCH_MS * 1.6 : NOTCH_MS) * windowScale;
  return radial < window;
}

/** Can a radar at `from`, pointing along `look`, track `target`? (null = yes, else the reason). */
export function radarBlocked(from: Vec3, look: Vec3, target: PlaneState, rangeM: number, coneDeg = RADAR_CONE_DEG, def?: Plane, notchScale = 1): string | null {
  const los = sub(target.pos, from);
  if (angleBetween(look, los) > coneDeg * DEG) return 'cone';
  // Ground clutter below 300 m halves the range; a stealthy airframe shrinks it too.
  const sig = def?.radarSignature ?? 1;
  const range = rangeM * sig * (target.pos[1] < CLUTTER_ALT_M ? 0.5 : 1);
  if (len(los) > range) return 'range';
  if (notching(from, target, notchScale)) return 'notch';
  return null;
}

/** Can this plane's seeker for `m` see the target right now? Used for locking and by the launcher's radar. */
export function seekerSees(shooter: PlaneState, target: PlaneState, m: Missile, cls: MissileClass, targetDef: Plane | undefined, sun: Vec3 = SUN_DIR): boolean {
  const nose = rotate(shooter.quat, FORWARD);
  if (cls.seeker === 'ir') return irBlocked(shooter.pos, nose, target, targetDef, m, cls, m.coneDeg, false, sun) === null;
  return radarBlocked(shooter.pos, nose, target, m.maxRangeM, RADAR_CONE_DEG, targetDef) === null;
}

/** The mount to lock with: radar beyond the IR missiles' reach, IR up close; only mounts with missiles left. */
function pickMount(shooter: PlaneState, def: Plane, target: PlaneState, mc: MissileContext, only = -1): number {
  const d = len(sub(target.pos, shooter.pos));
  let best = -1;
  let bestScore = -Infinity;
  def.missiles.forEach((mount, i) => {
    if ((shooter.missiles[i] ?? 0) <= 0) return;
    if (only >= 0 && i !== only) return;
    const m = mc.missileDefs.get(mount.type);
    const cls = m ? mc.missileClasses.get(m.class) : undefined;
    if (!m || !cls) return;
    if (!seekerSees(shooter, target, m, cls, mc.planeDefs.get(target.planeId), mc.sunDir)) return;
    // Radar missiles need the plane's own radar locked on the target (planes without a radar block keep the
    // missile's own seeker test, which is how Day 7 worked).
    if (cls.seeker === 'radar' && def.radar && shooter.radarLock !== target.id) return;
    // Prefer the missile whose sweet spot (about half its range) is closest to the target's distance.
    const score = -Math.abs(d - m.maxRangeM * 0.5) + (d < m.minRangeM ? -1e6 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/** Nearest enemy to the nose that any of our seekers could see (auto target when nothing is selected). */
function autoTarget(shooter: PlaneState, def: Plane, planes: PlaneState[], mc: MissileContext): PlaneState | null {
  const nose = rotate(shooter.quat, FORWARD);
  let best: PlaneState | null = null;
  let bestAngle = Infinity;
  let reach = 0;
  for (const m of def.missiles) reach = Math.max(reach, mc.missileDefs.get(m.type)?.maxRangeM ?? 0);
  const to: Vec3 = [0, 0, 0];
  for (const p of planes) {
    if (!p.alive || p.team === shooter.team) continue;
    to[0] = p.pos[0] - shooter.pos[0];
    to[1] = p.pos[1] - shooter.pos[1];
    to[2] = p.pos[2] - shooter.pos[2];
    if (to[0] * to[0] + to[1] * to[1] + to[2] * to[2] > reach * reach) continue;
    const a = angleBetween(nose, to);
    if (a < bestAngle && a < 75 * DEG) {
      bestAngle = a;
      best = p;
    }
  }
  return best;
}

/**
 * One tick of a plane's weapons computer: pick a target (the input's, or auto), build up a lock with the
 * best mount, launch on a fresh press of the missile button, release flares and chaff.
 */
export function stepWeapons(w: MissileWorld, mc: MissileContext, shooter: PlaneState, input: ControlInput, dt: number, events: MissileEvent[]): void {
  const def = mc.planeDefs.get(shooter.planeId);
  if (!def) return;
  shooter.missileCooldown = Math.max(0, shooter.missileCooldown - dt);
  shooter.cmCooldown = Math.max(0, shooter.cmCooldown - dt);

  // Countermeasures: one flare and one chaff bundle every 0.3 s while the button is held.
  if (input.flare && shooter.cmCooldown <= 0 && (shooter.flares > 0 || shooter.chaff > 0)) {
    shooter.cmCooldown = CM_INTERVAL_S;
    const back = scale(rotate(shooter.quat, FORWARD), -1);
    if (shooter.flares > 0) {
      shooter.flares--;
      releaseDecoy(w, mc, shooter, 'flare', add(scale(shooter.vel, 0.6), add(scale(back, 25), [0, -12, 0])), events);
    }
    if (shooter.chaff > 0) {
      shooter.chaff--;
      releaseDecoy(w, mc, shooter, 'chaff', add(scale(shooter.vel, 0.1), [0, -3, 0]), events);
    }
  }

  const hasMissiles = shooter.missiles.some((n) => n > 0);
  const pressed = input.missile && !shooter.missileHeld;
  shooter.missileHeld = input.missile;
  if (!hasMissiles) {
    shooter.lockTarget = null;
    shooter.lockProgress = 0;
    shooter.lockMount = -1;
    return;
  }

  // The picked target, else the radar lock, else the enemy nearest the nose. A picked secondary that still has
  // missiles limits the lock to that mount.
  const enemy = (id: string | null): PlaneState | null => (id ? w.planes.find((p) => p.id === id && p.alive && p.team !== shooter.team) ?? null : null);
  const chosen = enemy(input.target) ?? enemy(shooter.radarLock);
  const target = chosen ?? autoTarget(shooter, def, w.planes, mc);
  const sec = input.secondary ?? -1;
  shooter.secondary = sec >= 0 && sec < def.missiles.length ? sec : -1;
  const only = shooter.secondary >= 0 && (shooter.missiles[shooter.secondary] ?? 0) > 0 ? shooter.secondary : -1;
  const mount = target ? pickMount(shooter, def, target, mc, only) : -1;
  if (!target || mount < 0) {
    // Lost sight: the lock fades quickly.
    shooter.lockProgress = Math.max(0, shooter.lockProgress - dt * 2);
    if (shooter.lockProgress === 0) {
      shooter.lockTarget = target?.id ?? null;
      shooter.lockMount = -1;
    }
    return;
  }
  if (shooter.lockTarget !== target.id || shooter.lockMount !== mount) {
    shooter.lockTarget = target.id;
    shooter.lockMount = mount;
    shooter.lockProgress = 0;
  }
  const m = mc.missileDefs.get(def.missiles[mount]!.type)!;
  shooter.lockProgress = Math.min(1, shooter.lockProgress + dt / m.lockTimeS);

  const range = len(sub(target.pos, shooter.pos));
  if (pressed && shooter.lockProgress >= 1 && shooter.missileCooldown <= 0 && range >= m.minRangeM) {
    launch(w, shooter, mount, m, target, events);
  }
}

export function launch(w: MissileWorld, shooter: PlaneState, mount: number, m: Missile, target: PlaneState, events: MissileEvent[]): void {
  shooter.missiles[mount] = Math.max(0, (shooter.missiles[mount] ?? 0) - 1);
  shooter.missileCooldown = LAUNCH_COOLDOWN_S;
  const nose = rotate(shooter.quat, FORWARD);
  const id = w.nextMissileId++;
  w.missiles.push({
    id,
    type: m.id,
    owner: shooter.id,
    team: shooter.team,
    target: target.id,
    // Drops a few metres below the wing, then the motor lights.
    pos: add(shooter.pos, add(scale(nose, 4), [0, -2, 0])),
    vel: add(shooter.vel, scale(nose, 15)),
    age: 0,
    blind: 0,
    rolled: [],
    boost: m.speedMs + LAUNCH_SPEED_KEPT * len(shooter.vel),
  });
  events.push({ t: 'launch', id, owner: shooter.id, target: target.id, missile: m.id });
}

function releaseDecoy(w: MissileWorld, mc: MissileContext, owner: PlaneState, kind: Decoy['kind'], vel: Vec3, events: MissileEvent[]): void {
  const id = w.nextMissileId++;
  const decoy: Decoy = { id, kind, owner: owner.id, pos: [...owner.pos], vel, age: 0 };
  w.decoys.push(decoy);
  events.push({ t: 'decoy', kind, owner: owner.id, pos: [...decoy.pos], vel: [...vel] });
  // Every missile guiding on this plane with the matching seeker gets one roll against this decoy.
  for (const ms of w.missiles) {
    if (ms.target !== owner.id) continue;
    const m = mc.missileDefs.get(ms.type);
    const cls = m ? mc.missileClasses.get(m.class) : undefined;
    if (!m || !cls) continue;
    const matches = kind === 'flare' ? cls.seeker === 'ir' : cls.seeker === 'radar';
    if (!matches || ms.rolled.includes(id)) continue;
    const k = ms.rolled.length;
    ms.rolled.push(id);
    const ownerDef = mc.planeDefs.get(owner.planeId);
    let p = kind === 'flare' ? 1 - m.flareResistance : 1 - m.chaffResistance;
    if (kind === 'flare' && afterburner(owner, ownerDef)) p *= FLARE_AB_FACTOR;
    if (kind === 'chaff' && notching(ms.pos, owner)) p *= CHAFF_NOTCH_FACTOR;
    p = Math.min(0.95, p * DECOY_FADE ** k);
    if (mc.random() < p) ms.target = `d${id}`;
  }
}

/** Where a missile's target is, and whether its seeker (or the launcher, for semi-active) still tracks it. */
function track(w: MissileWorld, mc: MissileContext, ms: MissileState, m: Missile, cls: MissileClass): { pos: Vec3; vel: Vec3; tracked: boolean; decoy: boolean } | null {
  if (!ms.target) return null;
  if (ms.target.startsWith('d')) {
    const d = w.decoys.find((x) => `d${x.id}` === ms.target);
    return d ? { pos: d.pos, vel: d.vel, tracked: true, decoy: true } : null;
  }
  const t = w.planes.find((p) => p.id === ms.target);
  if (!t || !t.alive) return null;
  const tDef = mc.planeDefs.get(t.planeId);
  const look = len(ms.vel) > 1 ? ms.vel : rotate(t.quat, FORWARD);
  let tracked: boolean;
  if (cls.seeker === 'ir') {
    tracked = irBlocked(ms.pos, look, t, tDef, m, cls, Math.max(MISSILE_GIMBAL_DEG, m.coneDeg), true, mc.sunDir) === null;
  } else {
    const launcher = w.planes.find((p) => p.id === ms.owner);
    // A launcher with a radar must hold its radar lock on the target and actually see it this tick (a lock
    // coasting through a gap on memory doesn't illuminate the target).
    const launcherDef = launcher ? mc.planeDefs.get(launcher.planeId) : undefined;
    const launcherSees = Boolean(
      launcher?.alive && (launcherDef?.radar ? launcher.radarOn && launcher.radarLock === t.id && launcher.radarLostFor === 0 : seekerSees(launcher, t, m, cls, tDef)),
    );
    if (cls.guidance === 'semi_active') tracked = launcherSees && angleBetween(look, sub(t.pos, ms.pos)) < MISSILE_GIMBAL_DEG * DEG;
    else {
      const terminal = len(sub(t.pos, ms.pos)) < TERMINAL_M ? 0.5 : 1;
      tracked = (launcherSees && !notching(ms.pos, t, terminal)) || radarBlocked(ms.pos, look, t, ACTIVE_SEEKER_M, MISSILE_GIMBAL_DEG, tDef, terminal) === null;
    }
  }
  return { pos: t.pos, vel: t.vel, tracked, decoy: false };
}

/** Advance missiles and decoys one tick; detonations hand damage to `hit` (the world's applyDamage). */
export function stepMissiles(
  w: MissileWorld,
  mc: MissileContext,
  dt: number,
  events: MissileEvent[],
  hit: (victim: PlaneState, shooter: string, damageFraction: number, weapon: string) => void,
): void {
  stepDecoys(w, dt);

  const keep: MissileState[] = [];
  for (const ms of w.missiles) {
    const m = mc.missileDefs.get(ms.type);
    const cls = m ? mc.missileClasses.get(m.class) : undefined;
    if (!m || !cls) continue;
    ms.age += dt;
    const speed = len(ms.vel);
    const dir = speed > 1 ? scale(ms.vel, 1 / speed) : [0, 0, 1] as Vec3;

    // Guidance.
    const tr = track(w, mc, ms, m, cls);
    let accel: Vec3 = [0, G, 0]; // lift cancels gravity while guiding
    if (tr && tr.tracked) ms.blind = 0;
    else ms.blind += dt;
    if (ms.blind > TRACK_GRACE_S[cls.seeker]) {
      ms.target = null; // gone ballistic
      accel = [0, 0, 0];
    } else if (tr) {
      const r = sub(tr.pos, ms.pos);
      const dist = Math.max(1, len(r));
      const rHat = scale(r, 1 / dist);
      const vRel = sub(tr.vel, ms.vel);
      const omega = scale(cross(r, vRel), 1 / (dist * dist));
      const closing = Math.max(50, -dot(vRel, rHat));
      accel = add(accel, scale(cross(omega, rHat), PN_N * closing));
    }
    // Only the part across the flight path steers; available G falls with speed².
    accel = sub(accel, scale(dir, dot(accel, dir)));
    const gAvail = m.maxG * G * clamp((speed / m.speedMs) ** 2, 0.1, 1);
    const aLat = len(accel);
    if (aLat > gAvail) accel = scale(accel, gAvail / aLat);

    // Motor, drag, turning drag, gravity.
    let along = 0;
    if (ms.age < m.burnTimeS) along += Math.max(0, (ms.boost - speed) * 1.6);
    else along -= MISSILE_DRAG * speed * speed;
    along -= TURN_DRAG * Math.min(aLat, gAvail);
    const before = ms.pos;
    ms.vel = add(ms.vel, scale(add(accel, add(scale(dir, along), [0, -G, 0])), dt));
    ms.pos = add(ms.pos, scale(ms.vel, dt));

    // Proximity fuse: closest approach to the target during this step.
    let done = false;
    if (tr && ms.target && !tr.decoy) {
      const victim = w.planes.find((p) => p.id === ms.target)!;
      const miss = closestApproach(before, ms.pos, victim.pos);
      if (miss <= FUSE_M && ms.age > 0.4) {
        const frac = (m.damage / 100) * (miss <= FUSE_FULL_M ? 1 : 1 - 0.5 * ((miss - FUSE_FULL_M) / (FUSE_M - FUSE_FULL_M)));
        events.push({ t: 'detonate', id: ms.id, pos: [...ms.pos], victim: victim.id });
        hit(victim, ms.owner, frac, ms.type);
        done = true;
      }
    } else if (tr && tr.decoy && closestApproach(before, ms.pos, tr.pos) <= FUSE_M) {
      events.push({ t: 'detonate', id: ms.id, pos: [...ms.pos], victim: null });
      done = true;
    }
    if (!done) {
      const maxAge = 2.5 * (m.maxRangeM / m.speedMs) + m.burnTimeS;
      const ground = ms.pos[1] <= mc.surfaceAt(ms.pos[0], ms.pos[2]);
      const lost = ms.target === null && ms.blind > TRACK_GRACE_S[cls.seeker] + BALLISTIC_S;
      if (ground || lost || ms.age > maxAge || (ms.age > m.burnTimeS && len(ms.vel) < MIN_SPEED_MS)) {
        events.push({ t: 'detonate', id: ms.id, pos: [...ms.pos], victim: null });
        done = true;
      }
    }
    if (!done) keep.push(ms);
  }
  w.missiles = keep;
}

/** Flares fall and slow; chaff hangs in the air. Also run by clients, which only see decoys as events. */
export function stepDecoys(w: Pick<MissileWorld, 'decoys'>, dt: number): void {
  for (const d of w.decoys) {
    d.age += dt;
    const drag = d.kind === 'flare' ? 0.6 : 2.5;
    d.vel = [d.vel[0] * (1 - drag * dt), d.vel[1] * (1 - drag * dt) - (d.kind === 'flare' ? G * 0.6 : G * 0.05) * dt, d.vel[2] * (1 - drag * dt)];
    d.pos = add(d.pos, scale(d.vel, dt));
  }
  w.decoys = w.decoys.filter((d) => d.age < decoyLife(d.kind));
}

export const decoyLife = (kind: Decoy['kind']): number => (kind === 'flare' ? FLARE_LIFE_S : CHAFF_LIFE_S);

/** Shortest distance from point p to the segment a→b. */
export function closestApproach(a: Vec3, b: Vec3, p: Vec3): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 0 ? clamp(dot(sub(p, a), ab) / l2, 0, 1) : 0;
  return len(sub(add(a, scale(ab, t)), p));
}

/** The wire order of missile types (snapshots send an index). */
export const missileTypeIds = (data: { missiles: { missiles: readonly Missile[] } }): string[] => data.missiles.missiles.map((m) => m.id);

/** Seeker of the missile a plane is locking with, or null when it isn't locking. */
export function lockSeeker(mc: Pick<MissileContext, 'missileDefs' | 'missileClasses' | 'planeDefs'>, p: PlaneState): 'ir' | 'radar' | null {
  if (p.lockMount < 0 || p.lockProgress <= 0) return null;
  const m = mc.missileDefs.get(mc.planeDefs.get(p.planeId)?.missiles[p.lockMount]?.type ?? '');
  return m ? mc.missileClasses.get(m.class)?.seeker ?? null : null;
}

/** Missiles currently guiding on this plane (for warnings and bots). */
export const inbound = (w: MissileWorld, id: string): MissileState[] => w.missiles.filter((m) => m.target === id);
