// Bot pilots. They read the world and return a ControlInput, exactly like a human's devices do; they never
// touch plane state. Steering goes through the same mouse-aim autopilot the player uses.
//
// Priorities each tick: don't hit the ground → stay on the map → break away when being shot →
// attack the chosen target (pure pursuit far away, lead pursuit in gun range, throttle back to avoid
// overshooting) → otherwise patrol.
import type { Plane } from '../data/types';
import { aimControl, createAimPd, type AimPdState } from './autopilot';
import { leadPoint } from './ballistics';
import { neutralInput, type ControlInput } from './controls';
import type { PlaneState } from './flight';
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
}

export const BOT_SKILL: Record<BotDifficulty, BotSkill> = {
  easy: { reactionS: 1.0, aimErrorDeg: 2.5, fireMissM: 16, fireRangeM: 500, leadQuality: 0.75, evadeChance: 0.3, triggerDuty: 0.35 },
  normal: { reactionS: 0.45, aimErrorDeg: 0.6, fireMissM: 11, fireRangeM: 1050, leadQuality: 0.97, evadeChance: 0.6, triggerDuty: 0.85 },
  hard: { reactionS: 0.2, aimErrorDeg: 0.3, fireMissM: 8, fireRangeM: 1150, leadQuality: 1, evadeChance: 0.85, triggerDuty: 1 },
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
  /** What the bot is doing this tick (for debugging and tests). */
  mode: 'dead' | 'terrain' | 'edge' | 'evade' | 'attack' | 'patrol';
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
    mode: 'patrol',
  };
}

const DEG = Math.PI / 180;

/** Time for the plane to need to start pulling up, using look-ahead points along its velocity. */
function terrainThreat(me: PlaneState, ctx: WorldContext): number {
  const speed = len(me.vel);
  const margin = 140 + speed * 0.5;
  let worst = 0;
  for (const t of [1.5, 3, 5]) {
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
  let aim: Vec3 | null = null;

  // Taking hits?
  const hurt = me.hp < brain.lastHp - 0.01;
  brain.lastHp = me.hp;
  brain.evadeFor = Math.max(0, brain.evadeFor - dt);
  brain.reactIn = Math.max(0, brain.reactIn - dt);

  // 1. Terrain.
  const threat = terrainThreat(me, ctx);
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

  // 3. Break turn when shot.
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

  // 4. Pick a target: nearest enemy, preferring ones that are threatening us, sticking with the current one.
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
      const score = d * (1.5 - 0.5 * ahead) - (threatening ? 700 : 0) - (e.id === brain.targetId ? 400 : 0);
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

  // 5. Attack.
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
  }

  // 6. Patrol.
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
  return { ...steer, throttle, fire, missile: false, flare: false };
}
