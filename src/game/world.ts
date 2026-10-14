// The world: planes, bullets, pilots, scores. stepWorld is the one place the simulation advances.
import type { GameData, GameMap, Gun, Plane } from '../data/types';
import { fireGuns, hitSpheres, stepBullets, type Bullet, type Part } from './ballistics';
import type { ControlInput } from './controls';
import { neutralInput } from './controls';
import { edgeTurnInput, flightParams, stepPlane, stepWreck, type FlightParams, type PlaneState, type Team } from './flight';
import { normalize, quatLookRotation, scale, type Vec3 } from './math';
import { createTerrain, type Terrain } from './terrain';

export const RESPAWN_S = 5;
/** JSON has no Infinity, so "never" and "no limit" are large finite numbers. */
export const NEVER = -1e9;
export const NO_LIMIT = 1e9;
export const SPAWN_PROTECTION_S = 3;
export const SPAWN_ALTITUDE_M = 1500;
const FIRE_DURATION_S = 10;
const FIRE_DPS = 2.5;
const FIRE_CHANCE = 0.15;
const PART_KNOCKOUT = 0.2; // fraction of max HP on one part that knocks it out
const ASSIST_SHARE = 0.25;
const KILL_CREDIT_WINDOW_S = 20; // a crash this soon after being hit counts as the attacker's kill

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface Pilot {
  id: string;
  name: string;
  team: Team;
  bot: boolean;
}

export interface PilotStats {
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
}

export type GameEvent =
  | { t: 'hit'; shooter: string; victim: string; part: Part; damage: number; pos: Vec3 }
  | { t: 'kill'; killer: string | null; victim: string; weapon: string; assists: string[] }
  | { t: 'explode'; pos: Vec3 }
  | { t: 'spawn'; id: string };

export interface MatchState {
  mode: 'tdm' | 'free';
  timeLeftS: number;
  killLimit: number;
  score: Record<Team, number>;
  state: 'playing' | 'ended';
  winner: Team | 'draw' | null;
}

/** Serializable world state. */
export interface WorldState {
  tick: number;
  time: number;
  mapId: string;
  planes: PlaneState[];
  bullets: Bullet[];
  /** Events from the latest step only; read them after each stepWorld. */
  events: GameEvent[];
  pilots: Record<string, Pilot>;
  stats: Record<string, PilotStats>;
  match: MatchState;
  /** Seeded RNG state, so every peer that replays the same inputs gets the same result. */
  rng: number;
  nextBulletId: number;
}

/** Non-serializable helpers built from the data files; every peer rebuilds the same thing from the map id. */
export interface WorldContext {
  map: GameMap;
  terrain: Terrain;
  planeDefs: Map<string, Plane>;
  params: Map<string, FlightParams>;
  guns: Map<string, Gun>;
  data: GameData;
}

export function createWorldContext(data: GameData, mapId: string): WorldContext {
  const map = data.maps.find((m) => m.id === mapId);
  if (!map) throw new Error(`unknown map "${mapId}"`);
  const eras = new Map(data.eras.map((e) => [e.id, e]));
  const params = new Map<string, FlightParams>();
  for (const plane of data.planes) {
    const era = eras.get(plane.era);
    if (era) params.set(plane.id, flightParams(plane, era));
  }
  return {
    map,
    terrain: createTerrain(map),
    planeDefs: new Map(data.planes.map((p) => [p.id, p])),
    params,
    guns: new Map(data.guns.map((g) => [g.id, g])),
    data,
  };
}

export function createWorld(ctx: WorldContext, seed = 1): WorldState {
  return {
    tick: 0,
    time: 0,
    mapId: ctx.map.id,
    planes: [],
    bullets: [],
    events: [],
    pilots: {},
    stats: {},
    match: { mode: 'free', timeLeftS: NO_LIMIT, killLimit: NO_LIMIT, score: { red: 0, blue: 0 }, state: 'playing', winner: null },
    rng: seed >>> 0,
    nextBulletId: 1,
  };
}

/** mulberry32 on world.rng: deterministic randomness that lives in the (serializable) state. */
export function random(world: WorldState): number {
  world.rng = (world.rng + 0x6d2b79f5) >>> 0;
  let t = world.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function addPilot(world: WorldState, pilot: Pilot): void {
  world.pilots[pilot.id] = pilot;
  world.stats[pilot.id] ??= { kills: 0, deaths: 0, assists: 0, damage: 0 };
}

/** Index of a plane among its team, for spreading spawn positions so teammates don't overlap. */
function teamSlot(world: WorldState, id: string, team: Team): number {
  const mates = world.planes.filter((p) => p.team === team).map((p) => p.id);
  const i = mates.indexOf(id);
  return i >= 0 ? i : mates.length;
}

/** Puts a plane in the air at its team's side at 1,500 m, heading for the map centre, with spawn protection. */
export function spawnPlane(
  world: WorldState,
  ctx: WorldContext,
  opts: { id: string; team: Team; planeId: string; assist?: number; offset?: Vec3 },
): PlaneState {
  const params = ctx.params.get(opts.planeId);
  const def = ctx.planeDefs.get(opts.planeId);
  if (!params || !def) throw new Error(`unknown plane "${opts.planeId}"`);
  const base = ctx.map.spawns[opts.team];
  const slot = teamSlot(world, opts.id, opts.team);
  // Line abreast across the spawn side, 140 m apart, with a little height variation.
  const lateral = (slot - 4.5) * 140;
  const off = opts.offset ?? [0, (random(world) - 0.5) * 120, lateral + (random(world) - 0.5) * 40];
  const pos: Vec3 = [base[0] + off[0], SPAWN_ALTITUDE_M + off[1], base[2] + off[2]];
  const heading = normalize([-base[0], 0, -base[2]]);
  const cruise = params.topSpeedMs * 0.75;
  const state: PlaneState = {
    id: opts.id,
    team: opts.team,
    planeId: opts.planeId,
    pos,
    quat: quatLookRotation(heading),
    vel: scale(heading, cruise),
    throttle: 0.8,
    hp: def.stats.hp,
    maxHp: def.stats.hp,
    stalled: false,
    alive: true,
    g: 1,
    edgeWarning: false,
    autoTurn: false,
    respawnIn: 0,
    protectedFor: SPAWN_PROTECTION_S,
    damaged: { engine: false, wingL: false, wingR: false },
    partDamage: { fuselage: 0, wingL: 0, wingR: 0, engine: 0 },
    fireFor: 0,
    damageBy: {},
    lastHitBy: null,
    lastHitAt: NEVER,
    wreck: false,
    ammo: def.guns.map((g) => g.count * g.ammoPerGun),
    gunHeat: def.guns.map(() => 0),
    assist: opts.assist ?? 0,
  };
  const existing = world.planes.findIndex((p) => p.id === opts.id);
  if (existing >= 0) world.planes[existing] = state;
  else world.planes.push(state);
  world.events.push({ t: 'spawn', id: opts.id });
  return state;
}

/** Applies damage to a plane from a shooter (bullet hit or fire). Handles part knockouts, fire and death. */
export function applyDamage(world: WorldState, victim: PlaneState, shooter: string | null, amount: number, part: Part | null, weapon: string): void {
  if (!victim.alive || victim.protectedFor > 0 || amount <= 0) return;
  const dealt = Math.min(amount, victim.hp);
  victim.hp -= amount;
  if (shooter && shooter !== victim.id) {
    victim.damageBy[shooter] = (victim.damageBy[shooter] ?? 0) + dealt;
    victim.lastHitBy = shooter;
    victim.lastHitAt = world.time;
    const st = world.stats[shooter];
    if (st) st.damage += dealt;
  }
  if (part) {
    victim.partDamage[part] += amount;
    if (part !== 'fuselage' && victim.partDamage[part] >= victim.maxHp * PART_KNOCKOUT) victim.damaged[part] = true;
    // Heavier rounds are more likely to start a fire (15% for a 20 mm-class hit).
    if (victim.fireFor <= 0 && random(world) < FIRE_CHANCE * Math.min(1, amount / 9)) victim.fireFor = FIRE_DURATION_S;
  }
  if (victim.hp <= 0) killPlane(world, victim, weapon, true);
}

/** Death by damage (wreck falls) or by crashing (explodes where it hit). Credits kill and assists. */
function killPlane(world: WorldState, victim: PlaneState, weapon: string, shotDown: boolean): void {
  victim.alive = false;
  victim.hp = Math.max(0, victim.hp);
  victim.wreck = shotDown;
  victim.fireFor = 0;
  victim.respawnIn = RESPAWN_S;
  if (!shotDown) world.events.push({ t: 'explode', pos: [...victim.pos] });

  const recent = victim.lastHitBy !== null && world.time - victim.lastHitAt <= KILL_CREDIT_WINDOW_S;
  const killer = recent ? victim.lastHitBy : null;
  const assists = Object.entries(victim.damageBy)
    .filter(([id, dmg]) => id !== killer && dmg >= victim.maxHp * ASSIST_SHARE)
    .map(([id]) => id);

  const vs = world.stats[victim.id];
  if (vs) vs.deaths++;
  if (killer) {
    const ks = world.stats[killer];
    if (ks) ks.kills++;
    const killerTeam = world.pilots[killer]?.team;
    if (killerTeam && killerTeam !== victim.team) world.match.score[killerTeam]++;
  }
  for (const id of assists) {
    const st = world.stats[id];
    if (st) st.assists++;
  }
  world.events.push({ t: 'kill', killer, victim: victim.id, weapon: shotDown || killer ? weapon : 'crash', assists });
}

/** Advance the whole world one fixed step. Inputs are keyed by plane id; missing inputs mean "hands off". */
export function stepWorld(world: WorldState, ctx: WorldContext, inputs: Record<string, ControlInput>, dt: number): void {
  world.tick++;
  world.time += dt;
  world.events = [];
  const env = { surfaceAt: ctx.terrain.surfaceAt, half: ctx.terrain.half };

  const fc = {
    guns: ctx.guns,
    nextBulletId: () => world.nextBulletId++,
    random: () => random(world),
    enemies: [] as PlaneState[],
  };

  for (let i = 0; i < world.planes.length; i++) {
    const plane = world.planes[i]!;
    if (!plane.alive) {
      if (plane.wreck && stepWreck(plane, env, dt)) world.events.push({ t: 'explode', pos: [...plane.pos] });
      plane.respawnIn -= dt;
      if (plane.respawnIn <= 0) {
        if (plane.wreck) world.events.push({ t: 'explode', pos: [...plane.pos] });
        spawnPlane(world, ctx, { id: plane.id, team: plane.team, planeId: plane.planeId, assist: plane.assist });
      }
      continue;
    }
    const params = ctx.params.get(plane.planeId);
    const def = ctx.planeDefs.get(plane.planeId);
    if (!params || !def) continue;
    let input = inputs[plane.id] ?? neutralInput(plane.throttle);
    if (plane.autoTurn) input = edgeTurnInput(plane, input);

    plane.protectedFor = Math.max(0, plane.protectedFor - dt);
    stepPlane(plane, input, params, env, dt);
    if (!plane.alive) {
      killPlane(world, plane, 'crash', false);
      continue;
    }
    if (plane.fireFor > 0) {
      plane.fireFor = Math.max(0, plane.fireFor - dt);
      applyDamage(world, plane, plane.lastHitBy, FIRE_DPS * dt, null, 'fire');
      if (!plane.alive) continue;
    }
    if (input.fire) {
      fc.enemies = plane.assist > 0 ? world.planes.filter((p) => p.alive && p.team !== plane.team) : [];
      // Firing gives up spawn protection.
      if (fireGuns(plane, def, fc, dt, world.bullets) > 0) plane.protectedFor = 0;
    }
  }

  const hits = stepBullets(
    world.bullets,
    world.planes,
    (p) => hitSpheres(ctx.planeDefs.get(p.planeId)!),
    env.surfaceAt,
    dt,
  );
  for (const h of hits) {
    if (!h.victim.alive) continue;
    if (h.victim.protectedFor > 0) continue;
    world.events.push({ t: 'hit', shooter: h.bullet.owner, victim: h.victim.id, part: h.part, damage: h.bullet.damage, pos: h.point });
    applyDamage(world, h.victim, h.bullet.owner, h.bullet.damage, h.part, h.bullet.gun);
  }
}
