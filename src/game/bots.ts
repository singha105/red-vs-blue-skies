// Bot pilots. They read the world and return a ControlInput, exactly like a human's devices do; they never
// touch plane state. Steering goes through the same mouse-aim autopilot the player uses.
//
// Priorities each tick: don't hit the ground → stay on the map → defend against an inbound missile (flares and
// a break for IR, a notch and chaff for radar) → break away when being shot → attack the chosen target (pure
// pursuit far away, lead pursuit in gun range, throttle back to avoid overshooting; missiles once locked at a
// good range) → otherwise patrol.
import type { Plane } from '../data/types';
import { aimControl, createAimPd, type AimPdState } from './autopilot';
import { leadPoint } from './ballistics';
import { neutralInput, type ControlInput } from './controls';
import type { PlaneState } from './flight';
import { inbound } from './missiles';
import { isBomber, unitDef, type GroundUnit } from './objectives';
import { add, clamp, cross, dirFromYawPitch, dot, FORWARD, len, normalize, rotate, scale, yawPitchFromDir, type Vec3 } from './math';
import { random, type BotDifficulty, type WorldContext, type WorldState } from './world';

export interface BotSkill {
  /** Seconds before reacting to a new target or threat. */
  reactionS: number;
  /** Aim wander in degrees, refreshed every reaction period. */
  aimErrorDeg: number;
  /** Fire only when the nose would pass within this many metres of the lead point (so the cone shrinks with range). */
  fireMissM: number;
  /** Fire only inside this range (m). */
  fireRangeM: number;
  /** How much of the target's motion the bot leads (1 = perfect). */
  leadQuality: number;
  /** Chance of breaking away when hit. */
  evadeChance: number;
  /** Fraction of the time the trigger is actually held when a shot is lined up. */
  triggerDuty: number;
  /** Chance of noticing an inbound missile (the warning), and how well the bot then defends (0–1). */
  missileAwareness: number;
  /** Seconds between the bot's own missile launches. */
  missileIntervalS: number;
}

export const BOT_SKILL: Record<BotDifficulty, BotSkill> = {
  easy: { reactionS: 1.0, aimErrorDeg: 2.5, fireMissM: 16, fireRangeM: 500, leadQuality: 0.75, evadeChance: 0.3, triggerDuty: 0.35, missileAwareness: 0.35, missileIntervalS: 14 },
  normal: { reactionS: 0.45, aimErrorDeg: 0.6, fireMissM: 11, fireRangeM: 1050, leadQuality: 0.97, evadeChance: 0.6, triggerDuty: 0.85, missileAwareness: 0.7, missileIntervalS: 8 },
  hard: { reactionS: 0.2, aimErrorDeg: 0.3, fireMissM: 8, fireRangeM: 1150, leadQuality: 1, evadeChance: 0.85, triggerDuty: 1, missileAwareness: 0.95, missileIntervalS: 5 },
};

/** A bot's private memory. Plain data so it can live next to the world state. */
export interface BotBrain {
  id: string;
  difficulty: BotDifficulty;
  targetId: string | null;
  retargetIn: number;
  /** Counts down after picking a new target; no shooting until it reaches 0. */
  reactIn: number;
  aimErr: [number, number];
  aimErrIn: number;
  evadeFor: number;
  evadeDir: Vec3;
  lastHp: number;
  patrol: Vec3;
  triggerOn: boolean;
  triggerIn: number;
  pd: AimPdState;
  /** Inbound missiles already noticed (or missed) by id, so each gets one awareness roll. */
  seenMissiles: number[];
  /** Missile being defended against, or -1. */
  defending: number;
  /** Side of the beam to notch toward (+1 / −1), picked once per missile. */
  notchSide: number;
  missileIn: number;
  /** The missile button was pressed last tick (launches need a fresh press). */
  missilePressed: boolean;
  /** What the bot is doing this tick (for debugging and tests). */
  mode: 'dead' | 'terrain' | 'edge' | 'defend' | 'evade' | 'attack' | 'patrol' | 'capture' | 'strike' | 'escort';
  /** Some bots play the objective (capture zones, strike ground targets, chase or guard bombers); the rest dogfight. */
  role: 'fighter' | 'objective';
  /** Zone or ground unit being worked on (−1 none), and seconds of climbing away after a strike pass. */
  goal: number;
  pullOut: number;
}

export function createBrain(id: string, difficulty: BotDifficulty): BotBrain {
  return {
    id,
    difficulty,
    targetId: null,
    retargetIn: 0,
    reactIn: 0,
    aimErr: [0, 0],
    aimErrIn: 0,
    evadeFor: 0,
    evadeDir: [0, 0, 1],
    lastHp: 1e9,
    patrol: [0, 1800, 0],
    triggerOn: false,
    triggerIn: 0,
    pd: createAimPd(),
    seenMissiles: [],
    defending: -1,
    notchSide: 1,
    missileIn: 3,
    missilePressed: false,
    mode: 'patrol',
    // Two bots in five play the objective (from the id, so it's stable for the match).
    role: Number(id.replace(/\D/g, '')) % 5 < 2 ? 'objective' : 'fighter',
    goal: -1,
    pullOut: 0,
  };
}

const DEG = Math.PI / 180;

const LOOK_AHEAD = [1.5, 3, 5];
/** Shorter look-ahead while diving on a ground target, so the bot gets into gun range before pulling out. */
const STRIKE_LOOK_AHEAD = [1.2, 2.4];

/** Time for the plane to need to start pulling up, using look-ahead points along its velocity. */
function terrainThreat(me: PlaneState, ctx: WorldContext, striking = false): number {
  const speed = len(me.vel);
  const margin = 140 + speed * 0.5;
  let worst = 0;
  for (const t of striking ? STRIKE_LOOK_AHEAD : LOOK_AHEAD) {
    const p = add(me.pos, scale(me.vel, t));
    const clearance = p[1] - ctx.terrain.surfaceAt(p[0], p[2]);
    if (clearance < margin) worst = Math.max(worst, (margin - clearance) / margin);
  }
  const below = me.pos[1] - ctx.terrain.surfaceAt(me.pos[0], me.pos[2]);
  if (below < 220 && me.vel[1] < 0) worst = Math.max(worst, 1 - below / 220);
  return worst;
}

function muzzleSpeed(def: Plane, ctx: WorldContext): number {
  const gun = ctx.guns.get(def.guns[0]?.type ?? '');
  return gun?.muzzleVelocityMs ?? 800;
}

export function botInput(world: WorldState, ctx: WorldContext, brain: BotBrain, dt: number): ControlInput {
  const me = world.planes.find((p) => p.id === brain.id);
  if (!me || !me.alive) {
    brain.targetId = null;
    brain.lastHp = 1e9;
    brain.mode = 'dead';
    return neutralInput(0.8);
  }
  const def = ctx.planeDefs.get(me.planeId)!;
  const skill = BOT_SKILL[brain.difficulty];
  const nose = rotate(me.quat, FORWARD);
  const speed = len(me.vel);
  let throttle = 1;
  let fire = false;
  let flare = false;
  let missile = false;
  let aim: Vec3 | null = null;

  // Taking hits?
  const hurt = me.hp < brain.lastHp - 0.01;
  brain.lastHp = me.hp;
  brain.evadeFor = Math.max(0, brain.evadeFor - dt);
  brain.reactIn = Math.max(0, brain.reactIn - dt);

  const objectives = world.objectives;
  const striking = brain.role === 'objective' && objectives.mode === 'ground_strike' && brain.pullOut <= 0 && brain.goal >= 0;
  brain.pullOut = Math.max(0, brain.pullOut - dt);

  // 1. Terrain.
  const threat = terrainThreat(me, ctx, striking);
  if (threat > 0) {
    const flat = normalize([me.vel[0], 0, me.vel[2]]);
    const { yaw } = yawPitchFromDir(flat);
    aim = dirFromYawPitch(yaw, (20 + 30 * threat) * DEG);
    brain.mode = 'terrain';
  }

  // 2. Map edge.
  const edge = Math.max(Math.abs(me.pos[0]), Math.abs(me.pos[2]));
  if (!aim && edge > ctx.terrain.half - 1400) {
    aim = normalize([-me.pos[0], 0.05 * ctx.terrain.half, -me.pos[2]]);
    brain.mode = 'edge';
  }

  // 3. Inbound missile: each one gets a single roll to be noticed (the launch warning).
  brain.missileIn = Math.max(0, brain.missileIn - dt);
  const threats = inbound(world, me.id);
  for (const m of threats) {
    if (brain.seenMissiles.includes(m.id)) continue;
    brain.seenMissiles.push(m.id);
    if (brain.seenMissiles.length > 16) brain.seenMissiles.shift();
    if (random(world) < skill.missileAwareness) {
      brain.defending = m.id;
      brain.notchSide = random(world) < 0.5 ? 1 : -1;
    }
  }
  const threat3 = threats.find((m) => m.id === brain.defending) ?? null;
  if (!threat3) brain.defending = -1;
  if (threat3) {
    const md = ctx.missileDefs.get(threat3.type);
    const radar = md ? ctx.missileClasses.get(md.class)?.seeker === 'radar' : false;
    const rel: Vec3 = [me.pos[0] - threat3.pos[0], me.pos[1] - threat3.pos[1], me.pos[2] - threat3.pos[2]];
    const d = len(rel);
    const flatLos = normalize([rel[0], 0, rel[2]]);
    // The beam: 90° to the missile's line of sight, level (a notch for radar, a hard crossing break for IR).
    const beam: Vec3 = scale([flatLos[2], 0, -flatLos[0]], brain.notchSide);
    if (!aim) {
      brain.mode = 'defend';
      // Sloppier pilots hold the beam less precisely.
      const slop = (1 - skill.missileAwareness) * 0.6;
      aim = normalize(add(beam, scale(flatLos, slop)));
      if (me.pos[1] > 1200 && !radar) aim = normalize(add(aim, [0, -0.25, 0])); // trade height for speed
    }
    if (radar) flare = d < 3000;
    else {
      flare = d < 1800;
      throttle = d < 2500 ? 0.55 : 1; // out of afterburner so the flares look hotter than the engine
    }
  }

  // 4. Break turn when shot.
  if (!aim && hurt && brain.evadeFor <= 0 && me.lastHitBy && random(world) < skill.evadeChance) {
    const attacker = world.planes.find((p) => p.id === me.lastHitBy);
    const behind = attacker ? dot(nose, normalize([attacker.pos[0] - me.pos[0], attacker.pos[1] - me.pos[1], attacker.pos[2] - me.pos[2]])) < 0.2 : false;
    if (attacker && behind) {
      const toAttacker = normalize([attacker.pos[0] - me.pos[0], attacker.pos[1] - me.pos[1], attacker.pos[2] - me.pos[2]]);
      const side = random(world) < 0.5 ? 1 : -1;
      let dir = normalize(scale(cross([0, 1, 0], toAttacker), side));
      if (random(world) < 0.35 && me.pos[1] > 900) dir = normalize(add(dir, [0, -0.8, 0])); // sometimes dive away
      brain.evadeDir = dir;
      brain.evadeFor = 1.8 + random(world) * 1.4;
    }
  }
  if (!aim && brain.evadeFor > 0) {
    aim = brain.evadeDir;
    brain.mode = 'evade';
  }

  // 5. Pick a target: nearest enemy, preferring ones that are threatening us, sticking with the current one.
  brain.retargetIn -= dt;
  let target = brain.targetId ? world.planes.find((p) => p.id === brain.targetId && p.alive) ?? null : null;
  if (!target || brain.retargetIn <= 0) {
    let best: PlaneState | null = null;
    let bestScore = Infinity;
    for (const e of world.planes) {
      if (!e.alive || e.team === me.team) continue;
      const to: Vec3 = [me.pos[0] - e.pos[0], me.pos[1] - e.pos[1], me.pos[2] - e.pos[2]];
      const d = len(to);
      const eNose = rotate(e.quat, FORWARD);
      const threatening = d < 1500 && dot(eNose, scale(to, 1 / d)) > 0.94;
      // Targets ahead of our nose are cheaper to reach than ones we'd have to turn around for.
      const ahead = dot(nose, scale(to, -1 / d));
      let score = d * (1.5 - 0.5 * ahead) - (threatening ? 700 : 0) - (e.id === brain.targetId ? 400 : 0);
      score += modeTargetBonus(world, ctx, brain, me, e);
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (best && best.id !== brain.targetId) brain.reactIn = skill.reactionS;
    target = best;
    brain.targetId = best?.id ?? null;
    brain.retargetIn = 1.5 + skill.reactionS;
  }

  // Aim wander, refreshed every reaction period.
  brain.aimErrIn -= dt;
  if (brain.aimErrIn <= 0) {
    brain.aimErr = [(random(world) - 0.5) * 2 * skill.aimErrorDeg * DEG, (random(world) - 0.5) * 2 * skill.aimErrorDeg * DEG];
    brain.aimErrIn = Math.max(0.25, skill.reactionS);
  }

  // 6. The objective: capture a zone, strike a ground target, or stay with the bombers.
  if (!aim && brain.role === 'objective') {
    const obj = objectiveSteer(world, ctx, brain, me, target, dt);
    if (obj) {
      aim = obj.aim;
      throttle = obj.throttle;
      fire = obj.fire;
      missile = obj.missile;
      brain.mode = obj.mode;
    }
  }

  // 7. Attack.
  if (!aim && target) {
    brain.mode = 'attack';
    const to: Vec3 = [target.pos[0] - me.pos[0], target.pos[1] - me.pos[1], target.pos[2] - me.pos[2]];
    const dist = len(to);
    const mv = muzzleSpeed(def, ctx);
    let point = target.pos;
    if (dist < 1600) {
      const perfect = leadPoint(me.pos, me.vel, target.pos, target.vel, mv);
      point = [
        target.pos[0] + (perfect[0] - target.pos[0]) * skill.leadQuality,
        target.pos[1] + (perfect[1] - target.pos[1]) * skill.leadQuality,
        target.pos[2] + (perfect[2] - target.pos[2]) * skill.leadQuality,
      ];
    }
    const leadDir = normalize([point[0] - me.pos[0], point[1] - me.pos[1], point[2] - me.pos[2]]);
    const { yaw, pitch } = yawPitchFromDir(leadDir);
    aim = dirFromYawPitch(yaw + brain.aimErr[0], clamp(pitch + brain.aimErr[1], -1.4, 1.4));

    // Don't fly through the target.
    if (dist < 90) aim = normalize(add(aim, [0, 1.2, 0]));
    // Overshoot check: close and closing fast → ease off.
    const closing = -dot(normalize(to), [target.vel[0] - me.vel[0], target.vel[1] - me.vel[1], target.vel[2] - me.vel[2]]);
    if (dist < 350 && closing > 25) throttle = 0.45;

    // Trigger discipline: bursts when lined up, held only `triggerDuty` of the time.
    brain.triggerIn -= dt;
    if (brain.triggerIn <= 0) {
      brain.triggerOn = random(world) < skill.triggerDuty;
      brain.triggerIn = 0.35 + random(world) * 0.5;
    }
    const offNose = Math.acos(clamp(dot(nose, leadDir), -1, 1));
    const cone = Math.atan(skill.fireMissM / Math.max(dist, 1));
    fire = brain.reactIn <= 0 && brain.triggerOn && dist < skill.fireRangeM && offNose < cone && target.protectedFor <= 0;

    // Missiles: once the seeker is locked, inside the missile's comfortable range and outside gun range.
    if (me.lockTarget === target.id && me.lockProgress >= 1 && me.lockMount >= 0 && brain.missileIn <= 0 && brain.reactIn <= 0 && target.protectedFor <= 0) {
      const md = ctx.missileDefs.get(def.missiles[me.lockMount]?.type ?? '');
      const already = world.missiles.some((m) => m.owner === me.id && m.target === target.id);
      if (md && !already && dist > Math.max(md.minRangeM * 1.3, 600) && dist < md.maxRangeM * 0.75) {
        missile = !brain.missilePressed;
        if (missile) brain.missileIn = skill.missileIntervalS * (0.7 + random(world) * 0.6);
      }
    }
  }
  if (!(brain.mode === 'strike')) brain.missilePressed = missile;

  // 8. Patrol.
  if (!aim) {
    brain.mode = 'patrol';
    const to: Vec3 = [brain.patrol[0] - me.pos[0], brain.patrol[1] - me.pos[1], brain.patrol[2] - me.pos[2]];
    if (len(to) < 900) {
      const h = ctx.terrain.half * 0.6;
      brain.patrol = [(random(world) * 2 - 1) * h, 1200 + random(world) * 1300, (random(world) * 2 - 1) * h];
    }
    aim = normalize(to);
    throttle = 0.85;
  }

  // Keep energy up: never let a bot sit near stall speed on purpose.
  const p = ctx.params.get(me.planeId)!;
  if (speed < p.stallSpeedMs * 1.5) throttle = 1;

  const steer = aimControl(me, aim, brain.pd, dt);
  return { ...steer, throttle, fire, missile, flare, target: brain.mode === 'attack' || brain.mode === 'evade' ? brain.targetId : null };
}

/** Target preference by mode: interceptors go for the bombers, escorts and defenders for whoever threatens theirs. */
function modeTargetBonus(world: WorldState, ctx: WorldContext, brain: BotBrain, me: PlaneState, e: PlaneState): number {
  const o = world.objectives;
  if (o.escort) {
    if (isBomber(world, e.id)) return brain.role === 'objective' ? -4000 : -1500;
    // Escorts: enemies close to our bombers come first.
    if (o.escort.escort === me.team) {
      for (const b of world.planes) {
        if (b.alive && b.team === me.team && isBomber(world, b.id) && len([b.pos[0] - e.pos[0], b.pos[1] - e.pos[1], b.pos[2] - e.pos[2]]) < 2500) return -1200;
      }
    }
    return 0;
  }
  if (o.mode === 'ground_strike') {
    // Defenders: low enemies near our ground targets are the strikers.
    const agl = e.pos[1] - ctx.terrain.surfaceAt(e.pos[0], e.pos[2]);
    if (agl > 1500) return 0;
    for (const u of o.units) if (u.alive && u.target && u.team === me.team && Math.hypot(u.pos[0] - e.pos[0], u.pos[2] - e.pos[2]) < 2500) return -900;
    return 0;
  }
  if (o.mode === 'air_domination') {
    // Enemies sitting low in a zone are capturing it.
    const agl = e.pos[1] - ctx.terrain.surfaceAt(e.pos[0], e.pos[2]);
    for (const z of o.zones) if (agl < o.rules.captureAltitudeM * 1.5 && Math.hypot(z.x - e.pos[0], z.z - e.pos[2]) < o.rules.zoneRadiusM) return -1000;
  }
  return 0;
}

interface ObjectiveSteer {
  aim: Vec3;
  throttle: number;
  fire: boolean;
  missile: boolean;
  mode: BotBrain['mode'];
}

/** The objective bots' job for this tick, or null to dogfight (an enemy close and pointed at us wins over it). */
function objectiveSteer(world: WorldState, ctx: WorldContext, brain: BotBrain, me: PlaneState, target: PlaneState | null, dt: number): ObjectiveSteer | null {
  const o = world.objectives;
  if (target) {
    const to: Vec3 = [me.pos[0] - target.pos[0], me.pos[1] - target.pos[1], me.pos[2] - target.pos[2]];
    const d = len(to);
    const tNose = rotate(target.quat, FORWARD);
    // Someone on our tail, or (escort duty) any enemy near: fight.
    if (d < 1100 && dot(tNose, scale(to, 1 / d)) > 0.85) return null;
    if (o.escort && d < 1800) return null;
  }
  if (o.mode === 'air_domination' && o.zones.length > 0) return captureSteer(world, ctx, brain, me);
  if (o.mode === 'ground_strike') return strikeSteer(world, ctx, brain, me, dt);
  if (o.escort && o.escort.escort === me.team) return escortSteer(world, me);
  return null;
}

function captureSteer(world: WorldState, ctx: WorldContext, brain: BotBrain, me: PlaneState): ObjectiveSteer | null {
  const o = world.objectives;
  const want = (zi: number): boolean => {
    const z = o.zones[zi]!;
    const mine = me.team === 'blue' ? z.progress >= 1 : z.progress <= -1;
    return !mine;
  };
  if (brain.goal < 0 || brain.goal >= o.zones.length || !want(brain.goal)) {
    let best = -1;
    let bestD = Infinity;
    o.zones.forEach((z, i) => {
      if (!want(i)) return;
      // Spread out: bots with even ids prefer the far zones a little.
      const d = Math.hypot(z.x - me.pos[0], z.z - me.pos[2]) * (Number(brain.id.replace(/\D/g, '')) % 2 ? 1 : 0.8 + 0.1 * i);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    brain.goal = best;
  }
  if (brain.goal < 0) return null;
  const z = o.zones[brain.goal]!;
  const r = o.rules.zoneRadiusM;
  const d = Math.hypot(z.x - me.pos[0], z.z - me.pos[2]);
  // Circle inside the zone, low enough to count (150 m over the ground ahead).
  let gx = z.x;
  let gz = z.z;
  if (d < r * 1.2) {
    const a = Math.atan2(me.pos[2] - z.z, me.pos[0] - z.x) + 0.6;
    gx = z.x + Math.cos(a) * r * 0.5;
    gz = z.z + Math.sin(a) * r * 0.5;
  }
  const ground = Math.max(ctx.terrain.surfaceAt(gx, gz), ctx.terrain.surfaceAt(me.pos[0] + me.vel[0] * 3, me.pos[2] + me.vel[2] * 3));
  const height = d < r * 2.5 ? ground + Math.min(150, o.rules.captureAltitudeM * 0.5) : Math.max(me.pos[1], ground + 600);
  return { aim: normalize([gx - me.pos[0], height - me.pos[1], gz - me.pos[2]]), throttle: d < r * 1.5 ? 0.7 : 1, fire: false, missile: false, mode: 'capture' };
}

function strikeSteer(world: WorldState, ctx: WorldContext, brain: BotBrain, me: PlaneState, dt: number): ObjectiveSteer | null {
  const units = world.objectives.units;
  let u: GroundUnit | undefined = units[brain.goal];
  if (!u || !u.alive || u.team === me.team || !u.target) {
    let best: GroundUnit | null = null;
    let bestD = Infinity;
    for (const c of units) {
      if (!c.alive || !c.target || c.team === me.team) continue;
      const d = Math.hypot(c.pos[0] - me.pos[0], c.pos[2] - me.pos[2]);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    brain.goal = best ? best.id : -1;
    u = best ?? undefined;
  }
  if (!u) return null;
  const speedMs = unitDef(ctx, u.kind).speedKmh / 3.6;
  const uVel: Vec3 = [Math.sin(u.heading) * speedMs, 0, Math.cos(u.heading) * speedMs];
  const dx = u.pos[0] - me.pos[0];
  const dz = u.pos[2] - me.pos[2];
  const flat = Math.hypot(dx, dz);
  const agl = me.pos[1] - ctx.terrain.surfaceAt(me.pos[0], me.pos[2]);
  const nose = rotate(me.quat, FORWARD);
  // Climbing away after a pass.
  if (brain.pullOut > 0) {
    const away = normalize([nose[0], 0, nose[2]]);
    return { aim: normalize([away[0], 0.55, away[2]]), throttle: 1, fire: false, missile: false, mode: 'strike' };
  }
  // Far out: fly over at a safe height, then roll in.
  if (flat > 2400 || (agl < 500 && flat > 1200)) {
    const h = Math.max(ctx.terrain.surfaceAt(u.pos[0], u.pos[2]) + 900, ctx.terrain.surfaceAt(me.pos[0], me.pos[2]) + 500);
    return { aim: normalize([dx, h - me.pos[1], dz]), throttle: 1, fire: false, missile: false, mode: 'strike' };
  }
  // Diving on it: lead the guns, rockets inside 900 m, bombs when nearly overhead and low.
  const mv = 800;
  const lead = leadPoint(me.pos, me.vel, [u.pos[0], u.pos[1] + 2, u.pos[2]], uVel, mv);
  const dir = normalize([lead[0] - me.pos[0], lead[1] - me.pos[1], lead[2] - me.pos[2]]);
  const dist = len([u.pos[0] - me.pos[0], u.pos[1] - me.pos[1], u.pos[2] - me.pos[2]]);
  const offNose = Math.acos(clamp(dot(nose, dir), -1, 1));
  const fire = dist < 1000 && offNose < 0.06;
  const rocketsReady = me.rockets > 0 && dist < 900 && offNose < 0.05;
  const bombReady = me.rockets === 0 && me.bombs > 0 && dist < 650 && offNose < 0.12;
  const missile = rocketsReady || bombReady;
  if (dist < 260 || agl < 160) brain.pullOut = 4;
  void dt;
  return { aim: dir, throttle: 0.75, fire, missile, mode: 'strike' };
}

function escortSteer(world: WorldState, me: PlaneState): ObjectiveSteer | null {
  // Fly a few hundred metres above and behind the lead bomber.
  const lead = world.planes.find((p) => p.alive && p.team === me.team && isBomber(world, p.id));
  if (!lead) return null;
  const back = normalize([-lead.vel[0], 0, -lead.vel[2]]);
  const slot = (Number(me.id.replace(/\D/g, '')) % 4) - 1.5;
  const side: Vec3 = [-back[2], 0, back[0]];
  const goal: Vec3 = [lead.pos[0] + back[0] * 500 + side[0] * slot * 250, lead.pos[1] + 350, lead.pos[2] + back[2] * 500 + side[2] * slot * 250];
  const to: Vec3 = [goal[0] - me.pos[0], goal[1] - me.pos[1], goal[2] - me.pos[2]];
  const d = len(to);
  // Close enough: match the bombers' heading instead of chasing the point.
  const aim = d < 400 ? normalize(add(normalize(lead.vel), scale(normalize(to), 0.3))) : normalize(to);
  return { aim, throttle: d < 400 ? 0.6 : 1, fire: false, missile: false, mode: 'escort' };
}
