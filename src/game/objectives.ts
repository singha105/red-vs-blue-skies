// Game modes beyond Team Deathmatch: Air Domination zones, Ground Strike targets (convoys, bunkers, AA, ships,
// carriers), unguided rockets and bombs, and Bomber Escort waves. Plain serializable state in
// world.objectives; stepWorld calls in here. Scoring for every mode lives here too (scoreDeath, checkEnd).
//
// Ground units move as a function of match time only (groundLayout.ts), so clients place them from the clock
// and only need each unit's health and "firing" flag from the host. AI bombers are ordinary planes (pilot role
// "bomber") flying a route with the same flight model and autopilot as everyone else, so guns, missiles, hit
// spheres, snapshots and rendering all work on them unchanged.
import type { BomberDef, EraId, GameMode, OrdnanceDef, Plane, TurretDef, UnitDef, UnitKind } from '../data/types';
import { aimControl, createAimPd, type AimPdState } from './autopilot';
import { leadPoint, segmentSphere, type Bullet } from './ballistics';
import { neutralInput, type ControlInput } from './controls';
import { G, type PlaneState, type Team } from './flight';
import { groundLayout, unitPose, type GroundLayout, type UnitPose, type UnitSlot } from './groundLayout';
import { add, clamp, cross, FORWARD, normalize, quatFromAxisAngle, quatLookRotation, rotate, scale, UP, type Vec3 } from './math';
import { PLANE_MODELS } from './planeModels';
import { SP_CAPTURE } from './unlocks';
import type { GameEvent, WorldContext, WorldState } from './world';
import { addPilot, NO_LIMIT, random, spawnPlane } from './world';

export type ModeId = GameMode['id'];
export const RP_CAPTURE = 50;
export const RP_GROUND = 30;
export const SP_GROUND = 30;
const BOMBER_PREFIX = 'B';

/** The numbers a mode runs on, copied from modes.json at the start so the state carries them. */
export interface ModeRules {
  tickets: number;
  ticketsPerDeath: number;
  captureAltitudeM: number;
  zoneRadiusM: number;
  captureS: number;
  drainPerZonePerS: number;
  formation: number;
  waveGapS: number;
  pointsDelivered: number;
  pointsDowned: number;
  pointsPerKill: number;
  dropRadiusM: number;
}

export interface ZoneState {
  x: number;
  z: number;
  owner: Team | null;
  /** −1 (red's) … +1 (blue's). */
  progress: number;
}

export interface GroundUnit {
  id: number;
  /** Index into the layout's slots. */
  slot: number;
  kind: UnitKind;
  team: Team;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** Takes damage and counts for the mode; false for scenery (a carrier in Team Deathmatch, the depots). */
  target: boolean;
  pos: Vec3;
  heading: number;
  firing: boolean;
  /** Burst timer: > 0 seconds of firing left, < 0 seconds of pause left. */
  burst: number;
  heat: number;
}

export interface Ordnance {
  id: number;
  kind: 'rocket' | 'bomb';
  owner: string;
  team: Team;
  pos: Vec3;
  vel: Vec3;
  age: number;
}

export interface TurretState {
  burst: number;
  heat: number;
}

export interface BomberState {
  id: string;
  /** Index in the formation (sets the V offset). */
  slot: number;
  /** 0 inbound to the target, 1 heading home. */
  leg: 0 | 1;
  pd: AimPdState;
  guns: TurretState[];
}

export interface BomberEscortState {
  /** The team whose bombers fly; the other team intercepts. */
  escort: Team;
  wave: number;
  /** Seconds until the next wave takes off (counting only while no bomber is flying). */
  nextIn: number;
  start: [number, number];
  bombers: BomberState[];
  delivered: number;
  downed: number;
}

export interface ObjectivesState {
  mode: ModeId | 'free';
  era: EraId;
  rules: ModeRules;
  zones: ZoneState[];
  units: GroundUnit[];
  ordnance: Ordnance[];
  nextOrdnanceId: number;
  escort: BomberEscortState | null;
}

/** Events the modes add to GameEvent. */
export type ObjectiveEvent =
  | { t: 'capture'; zone: number; team: Team | null; by: string[] }
  | { t: 'unit'; id: number; kind: UnitKind; team: Team; by: string | null }
  | { t: 'drop'; id: number; kind: 'rocket' | 'bomb'; owner: string; team: Team; pos: Vec3; vel: Vec3 }
  | { t: 'bombed'; team: Team; pos: Vec3 }
  | { t: 'wave'; wave: number; escort: Team };

const DEFAULT_RULES: ModeRules = {
  tickets: 300,
  ticketsPerDeath: 2,
  captureAltitudeM: 300,
  zoneRadiusM: 700,
  captureS: 10,
  drainPerZonePerS: 0.5,
  formation: 4,
  waveGapS: 15,
  pointsDelivered: 10,
  pointsDowned: 10,
  pointsPerKill: 1,
  dropRadiusM: 450,
};

export function emptyObjectives(era: EraId = 'ww1'): ObjectivesState {
  return { mode: 'free', era, rules: { ...DEFAULT_RULES }, zones: [], units: [], ordnance: [], nextOrdnanceId: 1, escort: null };
}

export const isTicketMode = (mode: ObjectivesState['mode']): boolean => mode === 'air_domination' || mode === 'ground_strike';

export const isBomber = (world: WorldState, id: string): boolean => world.pilots[id]?.role === 'bomber';

export function unitDef(ctx: WorldContext, kind: UnitKind): UnitDef {
  return ctx.data.objectives.units.find((u) => u.id === kind)!;
}

/** How fast a unit moves (m/s). A convoy keeps to its slowest vehicle's speed, so it stays in column. */
export function unitSpeedMs(ctx: WorldContext, slot: UnitSlot): number {
  if (!slot.road) return unitDef(ctx, slot.kind).speedKmh / 3.6;
  let kmh = Infinity;
  for (const u of ctx.data.objectives.units) if (u.id === 'truck' || u.id === 'tank') kmh = Math.min(kmh, u.speedKmh);
  return kmh / 3.6;
}

export function bomberFor(ctx: WorldContext, era: EraId): BomberDef {
  return ctx.data.objectives.bombers.find((b) => b.eras.includes(era))!;
}

/** Synthesised plane entries for the AI bombers, so the flight model, hit spheres and renderer can use them. */
export function bomberPlanes(data: WorldContext['data']): Plane[] {
  return data.objectives.bombers.map((b) => ({
    id: b.id,
    name: b.name,
    era: b.eras[0]!,
    tier: 5,
    br: 0,
    years: '',
    stats: { topSpeedKmh: b.speedKmh, turnRateDegS: 10, climbMs: 8, rollRateDegS: 40, hp: b.hp },
    guns: [],
    missiles: [],
    countermeasures: { flares: 0, chaff: 0 },
    model: `models/bombers/${b.id}.glb`,
    verify: false,
  }));
}

/** Which layout slots a mode uses, and whether they are targets or just scenery. */
function unitsFor(mode: ModeId | 'free', layout: GroundLayout): { slot: number; target: boolean }[] {
  const out: { slot: number; target: boolean }[] = [];
  layout.slots.forEach((s, i) => {
    if (mode === 'ground_strike' && s.kind !== 'depot') out.push({ slot: i, target: true });
    else if (mode === 'bomber_escort' && (layout.depot.red === i || layout.depot.blue === i)) out.push({ slot: i, target: false });
    else if ((mode === 'tdm' || mode === 'air_domination') && s.kind === 'carrier') out.push({ slot: i, target: false });
  });
  return out;
}

/**
 * Sets up a mode on a fresh world: zones, ground units and (Bomber Escort) the bomber pilots. The host and solo
 * call it from createMatch; clients call it with the host's layout and escort team from the start message.
 */
export function initObjectives(
  world: WorldState,
  ctx: WorldContext,
  mode: ModeId,
  era: EraId,
  opts: { layout?: GroundLayout; escort?: Team } = {},
): void {
  const def = ctx.data.modes.find((m) => m.id === mode);
  const rules: ModeRules = { ...DEFAULT_RULES };
  for (const k of Object.keys(rules) as (keyof ModeRules)[]) {
    const v = def?.[k];
    if (typeof v === 'number') rules[k] = v;
  }
  const o = emptyObjectives(era);
  o.mode = mode;
  o.rules = rules;
  world.match.mode = mode;
  world.objectives = o;

  if (mode === 'air_domination') {
    o.zones = ctx.map.zones.slice(0, def?.zones ?? 3).map(([x, z]) => ({ x, z, owner: null, progress: 0 }));
  }
  if (isTicketMode(mode)) world.match.score = { red: rules.tickets, blue: rules.tickets };

  const layout = opts.layout ?? groundLayout(ctx.map, ctx.terrain);
  ctx.layout = layout;
  const scale = ctx.data.objectives.eraHpScale[era];
  const pose: UnitPose = { x: 0, z: 0, heading: 0 };
  for (const { slot, target } of unitsFor(mode, layout)) {
    const s = layout.slots[slot]!;
    const ud = unitDef(ctx, s.kind);
    unitPose(s, unitSpeedMs(ctx, s), 0, pose);
    const hp = Math.max(1, Math.round(ud.hp * scale));
    o.units.push({
      id: o.units.length,
      slot,
      kind: s.kind,
      team: s.team,
      hp,
      maxHp: hp,
      alive: true,
      target,
      pos: [pose.x, unitY(ctx, s.kind, pose.x, pose.z), pose.z],
      heading: pose.heading,
      firing: false,
      burst: 0,
      heat: 0,
    });
  }

  if (mode === 'bomber_escort') {
    const escort: Team = opts.escort ?? (random(world) < 0.5 ? 'blue' : 'red');
    const base = ctx.map.spawns[escort];
    o.escort = { escort, wave: 0, nextIn: 6, start: [base[0], base[2]], bombers: [], delivered: 0, downed: 0 };
    const bd = bomberFor(ctx, era);
    for (let k = 0; k < rules.formation; k++) {
      const id = `${BOMBER_PREFIX}${k + 1}`;
      addPilot(world, { id, name: `${bd.name} ${k + 1}`, team: escort, bot: true, role: 'bomber' });
      const p = spawnPlane(world, ctx, { id, team: escort, planeId: bd.id });
      parkBomber(p);
      o.escort.bombers.push({ id, slot: k, leg: 0, pd: createAimPd(), guns: (PLANE_MODELS[bd.id]?.muzzles ?? []).map(() => ({ burst: 0, heat: 0 })) });
    }
    world.events = world.events.filter((e) => e.t !== 'spawn' || !e.id.startsWith(BOMBER_PREFIX));
  }
}

/** Ground height for a unit: ships float, everything else sits on the terrain. */
function unitY(ctx: WorldContext, kind: UnitKind, x: number, z: number): number {
  return kind === 'ship' || kind === 'carrier' ? 0 : Math.max(0, ctx.terrain.heightAt(x, z));
}

/** A bomber between waves: not flying, not drawn, never respawning on its own. */
function parkBomber(p: PlaneState): void {
  p.alive = false;
  p.wreck = false;
  p.respawnIn = NO_LIMIT;
  p.pos = [0, -500, 0];
  p.vel = [0, 0, 0];
}

// ---------------------------------------------------------------- moving the units (host, solo and clients)

const scratchPose: UnitPose = { x: 0, z: 0, heading: 0 };

/** Moves every living unit to where it is at `time` (match seconds). Dead units stay where they died. */
export function placeUnits(world: WorldState, ctx: WorldContext, time: number): void {
  const layout = ctx.layout;
  if (!layout) return;
  for (const u of world.objectives.units) {
    if (!u.alive) continue;
    const slot = layout.slots[u.slot];
    if (!slot) continue;
    unitPose(slot, unitSpeedMs(ctx, slot), time, scratchPose);
    u.pos[0] = scratchPose.x;
    u.pos[2] = scratchPose.z;
    u.pos[1] = unitY(ctx, u.kind, scratchPose.x, scratchPose.z);
    u.heading = scratchPose.heading;
  }
}

/** Hit spheres of a unit: one, or a row along a ship's length. */
export function unitSpheres(ctx: WorldContext, u: GroundUnit, out: { c: Vec3; r: number }[]): number {
  const d = unitDef(ctx, u.kind);
  const n = d.lengthM ? Math.max(1, Math.round(d.lengthM / (d.radiusM * 1.6))) : 1;
  const fx = Math.sin(u.heading);
  const fz = Math.cos(u.heading);
  const lift = u.kind === 'ship' || u.kind === 'carrier' ? d.radiusM * 0.4 : d.radiusM * 0.5;
  for (let i = 0; i < n; i++) {
    const along = n === 1 ? 0 : ((i / (n - 1)) - 0.5) * ((d.lengthM ?? 0) - d.radiusM * 2);
    const s = out[i] ?? { c: [0, 0, 0] as Vec3, r: 0 };
    s.c[0] = u.pos[0] + fx * along;
    s.c[1] = u.pos[1] + lift;
    s.c[2] = u.pos[2] + fz * along;
    s.r = d.radiusM;
    out[i] = s;
  }
  return n;
}

const sphereScratch: { c: Vec3; r: number }[] = [];

// ---------------------------------------------------------------- damage to units

/** Damage to a ground unit. Destroying it costs its team tickets and credits the shooter. */
export function damageUnit(world: WorldState, ctx: WorldContext, u: GroundUnit, amount: number, by: string | null, events: GameEvent[]): void {
  if (!u.alive || !u.target || amount <= 0) return;
  u.hp -= amount;
  if (u.hp > 0) return;
  u.hp = 0;
  u.alive = false;
  u.firing = false;
  events.push({ t: 'unit', id: u.id, kind: u.kind, team: u.team, by });
  events.push({ t: 'explode', pos: [u.pos[0], u.pos[1] + 4, u.pos[2]] });
  const st = by ? world.stats[by] : undefined;
  if (st && world.pilots[by!]?.team !== u.team) {
    st.groundKills++;
    st.sp += SP_GROUND;
  }
  if (world.objectives.mode === 'ground_strike') {
    const m = world.match;
    m.score[u.team] = Math.max(0, m.score[u.team] - unitDef(ctx, u.kind).tickets);
    // A team with nothing left to defend has lost its tickets too.
    if (!world.objectives.units.some((x) => x.team === u.team && x.target && x.alive)) m.score[u.team] = 0;
  }
}

/** Bullet segment p0→p1 against the ground units of the other team. True if it hit one (the bullet is used up). */
export function bulletHitsUnit(world: WorldState, ctx: WorldContext, b: Bullet, p0: Vec3, p1: Vec3, events: GameEvent[]): boolean {
  const units = world.objectives.units;
  if (units.length === 0) return false;
  // Units are on the ground: anything well above the terrain is a quick no.
  const low = Math.min(p0[1], p1[1]);
  if (low > ctx.terrain.surfaceAt(p1[0], p1[2]) + 60) return false;
  for (const u of units) {
    if (!u.alive || !u.target || u.team === b.team) continue;
    const dx = u.pos[0] - p1[0];
    const dz = u.pos[2] - p1[2];
    if (dx * dx + dz * dz > 160 * 160) continue;
    const n = unitSpheres(ctx, u, sphereScratch);
    for (let i = 0; i < n; i++) {
      const s = sphereScratch[i]!;
      if (segmentSphere(p0, p1, s.c, s.r) >= 0) {
        events.push({ t: 'hit', shooter: b.owner, victim: `u${u.id}`, part: 'fuselage', damage: b.damage, pos: [...p1] });
        damageUnit(world, ctx, u, b.damage, b.owner, events);
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------- rockets and bombs

/** The missile button on an attacker: rockets in pairs while there are any, then bombs, one per press interval. */
export function stepOrdnanceRelease(world: WorldState, ctx: WorldContext, p: PlaneState, input: ControlInput, dt: number, events: GameEvent[]): void {
  p.ordnanceCooldown = Math.max(0, p.ordnanceCooldown - dt);
  if (!input.missile || p.ordnanceCooldown > 0) return;
  const defs = ctx.data.objectives.ordnance;
  const kind: 'rocket' | 'bomb' | null = p.rockets > 0 ? 'rocket' : p.bombs > 0 ? 'bomb' : null;
  if (!kind) return;
  const od = defs[kind];
  const forward = rotate(p.quat, FORWARD);
  const down = rotate(p.quat, [0, -1, 0]);
  const shots = kind === 'rocket' ? Math.min(2, p.rockets) : 1;
  for (let k = 0; k < shots; k++) {
    const side = shots === 2 ? (k === 0 ? 2.2 : -2.2) : 0;
    const right = rotate(p.quat, [1, 0, 0]);
    const pos = add(add(p.pos, scale(down, 1.4)), scale(right, side));
    const vel = add(p.vel, scale(forward, od.speedMs));
    const ord: Ordnance = { id: world.objectives.nextOrdnanceId++, kind, owner: p.id, team: p.team, pos, vel, age: 0 };
    world.objectives.ordnance.push(ord);
    events.push({ t: 'drop', id: ord.id, kind, owner: p.id, team: p.team, pos: [...pos], vel: [...vel] });
  }
  if (kind === 'rocket') p.rockets -= shots;
  else p.bombs -= 1;
  p.ordnanceCooldown = od.intervalS;
  // Like a missile launch, this gives up spawn protection.
  p.protectedFor = 0;
}

/**
 * Flies rockets and bombs. On impact (ground, water, or a rocket passing through a unit) they explode with
 * splash damage to enemy units. `cosmetic` (clients): just fly and vanish; the host decides damage.
 */
export function moveOrdnance(world: WorldState, ctx: WorldContext, dt: number, events: GameEvent[], cosmetic = false): void {
  const list = world.objectives.ordnance;
  let write = 0;
  for (let i = 0; i < list.length; i++) {
    const o = list[i]!;
    const p0: Vec3 = [o.pos[0], o.pos[1], o.pos[2]];
    o.vel[1] -= G * dt;
    o.pos[0] += o.vel[0] * dt;
    o.pos[1] += o.vel[1] * dt;
    o.pos[2] += o.vel[2] * dt;
    o.age += dt;
    let hit = o.pos[1] <= ctx.terrain.surfaceAt(o.pos[0], o.pos[2]) || o.age > 40 || Math.abs(o.pos[0]) > ctx.terrain.half || Math.abs(o.pos[2]) > ctx.terrain.half;
    if (!hit && o.kind === 'rocket') {
      for (const u of world.objectives.units) {
        if (!u.alive || !u.target || u.team === o.team) continue;
        const n = unitSpheres(ctx, u, sphereScratch);
        for (let k = 0; k < n && !hit; k++) if (segmentSphere(p0, o.pos, sphereScratch[k]!.c, sphereScratch[k]!.r + 2) >= 0) hit = true;
        if (hit) break;
      }
    }
    if (!hit) {
      list[write++] = o;
      continue;
    }
    if (cosmetic) continue;
    const od: OrdnanceDef = ctx.data.objectives.ordnance[o.kind];
    events.push({ t: 'explode', pos: [o.pos[0], Math.max(o.pos[1], ctx.terrain.surfaceAt(o.pos[0], o.pos[2])) + 2, o.pos[2]] });
    for (const u of world.objectives.units) {
      if (!u.alive || !u.target || u.team === o.team) continue;
      const n = unitSpheres(ctx, u, sphereScratch);
      let d = Infinity;
      for (let k = 0; k < n; k++) {
        const s = sphereScratch[k]!;
        d = Math.min(d, Math.max(0, Math.hypot(s.c[0] - o.pos[0], s.c[1] - o.pos[1], s.c[2] - o.pos[2]) - s.r));
      }
      if (d >= od.splashM) continue;
      const amount = od.damage * (1 - d / od.splashM);
      events.push({ t: 'hit', shooter: o.owner, victim: `u${u.id}`, part: 'fuselage', damage: amount, pos: [...u.pos] });
      damageUnit(world, ctx, u, amount, o.owner, events);
    }
  }
  list.length = write;
}

// ---------------------------------------------------------------- turrets: AA sites and bomber gunners

/** The enemy plane a turret at `from` should shoot at (nearest in range and not spawn-protected), or null. */
export function turretTarget(world: WorldState, from: Vec3, team: Team, rangeM: number): PlaneState | null {
  let best: PlaneState | null = null;
  let bestD = rangeM;
  for (const p of world.planes) {
    if (!p.alive || p.team === team || p.protectedFor > 0) continue;
    const d = Math.hypot(p.pos[0] - from[0], p.pos[1] - from[1], p.pos[2] - from[2]);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/**
 * One tick of a turret: bursts while a target is in range, imperfect lead and spread. Returns whether it is
 * firing. Bullets go to `out` (on clients they're cosmetic tracers, since the host decides hits).
 */
export function stepTurret(
  st: TurretState,
  def: TurretDef,
  from: Vec3,
  fromVel: Vec3,
  target: PlaneState | null,
  owner: string,
  team: Team,
  gun: string,
  dt: number,
  rand: () => number,
  nextId: () => number,
  out: Bullet[],
): boolean {
  if (!target) {
    st.burst = Math.min(st.burst, 0);
    st.heat = 0;
    return false;
  }
  if (st.burst > 0) {
    st.burst -= dt;
    if (st.burst <= 0) st.burst = -def.pauseS * (0.6 + rand() * 0.8);
  } else {
    st.burst += dt;
    if (st.burst >= 0) st.burst = def.burstS * (0.6 + rand() * 0.8);
    return false;
  }
  const perfect = leadPoint(from, fromVel, target.pos, target.vel, def.muzzleVelocityMs);
  const aim: Vec3 = [
    target.pos[0] + (perfect[0] - target.pos[0]) * def.leadQuality,
    target.pos[1] + (perfect[1] - target.pos[1]) * def.leadQuality,
    target.pos[2] + (perfect[2] - target.pos[2]) * def.leadQuality,
  ];
  const dir0 = normalize([aim[0] - from[0], aim[1] - from[1], aim[2] - from[2]]);
  st.heat += def.roundsPerS * dt;
  while (st.heat >= 1) {
    st.heat -= 1;
    const side = normalize(cross(UP, dir0));
    const angle = ((def.spreadDeg * Math.PI) / 180) * Math.sqrt(rand());
    const axis = normalize(add(scale(side, Math.cos(rand() * Math.PI * 2)), scale(UP, Math.sin(rand() * Math.PI * 2))));
    const dir = rotate(quatFromAxisAngle(axis, angle), dir0);
    out.push({
      id: nextId(),
      owner,
      team,
      gun,
      pos: [...from],
      vel: add(fromVel, scale(dir, def.muzzleVelocityMs)),
      damage: def.damage,
      life: (def.rangeM * 1.15) / def.muzzleVelocityMs,
    });
  }
  return true;
}

const AA_MUZZLE_M = 3;

function stepAa(world: WorldState, ctx: WorldContext, dt: number): void {
  const def = ctx.data.objectives.aa;
  for (const u of world.objectives.units) {
    // AA sites, and the guns on every ship and carrier.
    if (!u.alive || !u.target || (u.kind !== 'aa' && u.kind !== 'ship' && u.kind !== 'carrier')) {
      u.firing = false;
      continue;
    }
    const from: Vec3 = [u.pos[0], u.pos[1] + AA_MUZZLE_M + (u.kind === 'aa' ? 0 : 14), u.pos[2]];
    const target = turretTarget(world, from, u.team, def.rangeM);
    u.firing = stepTurret(u, def, from, [0, 0, 0], target, `u${u.id}`, u.team, 'aa', dt, () => random(world), () => world.nextBulletId++, world.bullets);
  }
}

// ---------------------------------------------------------------- Air Domination zones

function stepZones(world: WorldState, ctx: WorldContext, dt: number, events: GameEvent[]): void {
  const o = world.objectives;
  const r = o.rules;
  for (let zi = 0; zi < o.zones.length; zi++) {
    const z = o.zones[zi]!;
    const inside: Record<Team, string[]> = { red: [], blue: [] };
    for (const p of world.planes) {
      if (!p.alive || isBomber(world, p.id)) continue;
      if (Math.hypot(p.pos[0] - z.x, p.pos[2] - z.z) > r.zoneRadiusM) continue;
      if (p.pos[1] - ctx.terrain.surfaceAt(p.pos[0], p.pos[2]) > r.captureAltitudeM) continue;
      inside[p.team].push(p.id);
    }
    // More planes capture faster (up to three count); equal numbers hold the zone where it is.
    const net = Math.min(3, inside.blue.length) - Math.min(3, inside.red.length);
    if (net === 0) continue;
    const before = z.owner;
    z.progress = clamp(z.progress + (net / r.captureS) * dt, -1, 1);
    if (z.owner === 'blue' && z.progress <= 0) z.owner = null;
    if (z.owner === 'red' && z.progress >= 0) z.owner = null;
    if (z.progress >= 1 && z.owner !== 'blue') z.owner = 'blue';
    if (z.progress <= -1 && z.owner !== 'red') z.owner = 'red';
    if (z.owner !== before) {
      const by = z.owner ? inside[z.owner] : [];
      for (const id of by) {
        const st = world.stats[id];
        if (st) {
          st.captures++;
          st.sp += SP_CAPTURE;
        }
      }
      events.push({ t: 'capture', zone: zi, team: z.owner, by });
    }
  }
  // Held zones drain the other team's tickets.
  const held: Record<Team, number> = { red: 0, blue: 0 };
  for (const z of o.zones) if (z.owner) held[z.owner]++;
  const m = world.match;
  m.score.red = Math.max(0, m.score.red - held.blue * r.drainPerZonePerS * dt);
  m.score.blue = Math.max(0, m.score.blue - held.red * r.drainPerZonePerS * dt);
}

// ---------------------------------------------------------------- Bomber Escort

/** Seconds a wave's run to the target should take, roughly. */
const INBOUND_S = 150;

/** Formation offsets: (lateral, height, back) in metres, a V behind the lead. */
function formationOffset(slot: number): [number, number, number] {
  if (slot === 0) return [0, 0, 0];
  const row = Math.ceil(slot / 2);
  const side = slot % 2 ? -1 : 1;
  return [side * 80 * row, -15 * row, -70 * row];
}

/** Where a bomber wave heads: the intercepting team's depot (or carrier). */
function bomberTargetPos(world: WorldState, ctx: WorldContext): Vec3 {
  const es = world.objectives.escort!;
  const defending: Team = es.escort === 'red' ? 'blue' : 'red';
  const depot = ctx.layout?.depot[defending] ?? -1;
  const u = world.objectives.units.find((x) => x.slot === depot);
  if (u) return [u.pos[0], u.pos[1], u.pos[2]];
  const s = ctx.map.spawns[defending];
  return [s[0] * 0.75, 0, s[2]];
}

function launchWave(world: WorldState, ctx: WorldContext, events: GameEvent[]): void {
  const es = world.objectives.escort!;
  const bd = bomberFor(ctx, world.objectives.era);
  const target = bomberTargetPos(world, ctx);
  es.wave++;
  // The run in takes about INBOUND_S whatever the era: slow WW1 bombers start closer to their target.
  const side = es.escort === 'red' ? -1 : 1;
  const run = Math.min(Math.abs(ctx.map.spawns[es.escort][0] - target[0]), (bd.speedKmh / 3.6) * INBOUND_S);
  // Each wave comes in on a slightly different line.
  const lateral = (random(world) - 0.5) * ctx.terrain.half * 0.8;
  const sx = target[0] + side * run;
  const sz = clamp(target[2] + lateral, -ctx.terrain.half * 0.7, ctx.terrain.half * 0.7);
  es.start = [sx, sz];
  const heading = normalize([target[0] - sx, 0, target[2] - sz]);
  const right: Vec3 = [-heading[2], 0, heading[0]];
  const scaleHp = ctx.data.objectives.eraHpScale[world.objectives.era];
  for (const b of es.bombers) {
    const off = formationOffset(b.slot);
    const p = spawnPlane(world, ctx, {
      id: b.id,
      team: es.escort,
      planeId: bd.id,
      offset: [0, 0, 0],
    });
    p.pos = [sx + right[0] * off[0] + heading[0] * off[2], bd.altitudeM + off[1], sz + right[2] * off[0] + heading[2] * off[2]];
    p.quat = quatLookRotation(heading);
    p.vel = scale(heading, (bd.speedKmh / 3.6) * 0.95);
    p.throttle = 0.95;
    p.hp = p.maxHp = Math.round(bd.hp * scaleHp);
    p.protectedFor = 0;
    b.leg = 0;
    b.pd = createAimPd();
    for (const g of b.guns) {
      g.burst = 0;
      g.heat = 0;
    }
  }
  events.push({ t: 'wave', wave: es.wave, escort: es.escort });
}

/** Autopilot for the bombers: hold altitude and formation on the way to the target, then fly home. */
export function bomberInputs(world: WorldState, ctx: WorldContext, dt: number, out: Record<string, ControlInput>): void {
  const es = world.objectives.escort;
  if (!es) return;
  const bd = bomberFor(ctx, world.objectives.era);
  const target = bomberTargetPos(world, ctx);
  const home: Vec3 = [es.start[0], bd.altitudeM, es.start[1]];
  for (const b of es.bombers) {
    const p = world.planes.find((x) => x.id === b.id);
    if (!p || !p.alive) continue;
    const goal: Vec3 = b.leg === 0 ? [target[0], bd.altitudeM, target[2]] : home;
    const heading = normalize([goal[0] - p.pos[0], 0, goal[2] - p.pos[2]]);
    const off = formationOffset(b.slot);
    const right: Vec3 = [-heading[2], 0, heading[0]];
    // Aim at a point well ahead along the route, shifted by this bomber's formation slot.
    const ahead = Math.min(2500, Math.hypot(goal[0] - p.pos[0], goal[2] - p.pos[2]));
    const aimAt: Vec3 = [
      p.pos[0] + heading[0] * ahead + right[0] * off[0] * 0.3,
      bd.altitudeM + off[1],
      p.pos[2] + heading[2] * ahead + right[2] * off[0] * 0.3,
    ];
    const terrainTop = ctx.terrain.surfaceAt(p.pos[0] + p.vel[0] * 4, p.pos[2] + p.vel[2] * 4);
    if (aimAt[1] < terrainTop + 400) aimAt[1] = terrainTop + 400;
    const aim = normalize([aimAt[0] - p.pos[0], aimAt[1] - p.pos[1], aimAt[2] - p.pos[2]]);
    const steer = aimControl(p, aim, b.pd, dt);
    out[b.id] = { ...neutralInput(0.95), ...steer, throttle: 0.95 };
  }
}

function stepEscort(world: WorldState, ctx: WorldContext, dt: number, events: GameEvent[]): void {
  const es = world.objectives.escort;
  if (!es) return;
  const r = world.objectives.rules;
  const flying = es.bombers.filter((b) => world.planes.find((p) => p.id === b.id)?.alive);
  if (flying.length === 0) {
    es.nextIn -= dt;
    if (es.nextIn <= 0) {
      launchWave(world, ctx, events);
      es.nextIn = r.waveGapS;
    }
    return;
  }
  const target = bomberTargetPos(world, ctx);
  const gunners = ctx.data.objectives.gunners;
  const muzzles = PLANE_MODELS[bomberFor(ctx, world.objectives.era).id]?.muzzles ?? [];
  for (const b of flying) {
    const p = world.planes.find((x) => x.id === b.id)!;
    // Over the target: bombs away (the escorting team scores), then home.
    if (b.leg === 0 && Math.hypot(p.pos[0] - target[0], p.pos[2] - target[2]) < r.dropRadiusM) {
      b.leg = 1;
      es.delivered++;
      world.match.score[es.escort] += r.pointsDelivered;
      events.push({ t: 'bombed', team: es.escort, pos: [...target] });
      for (let k = 0; k < 3; k++) {
        events.push({ t: 'explode', pos: [target[0] + (random(world) - 0.5) * 120, target[1] + 3, target[2] + (random(world) - 0.5) * 120] });
      }
    }
    if (b.leg === 1 && Math.hypot(p.pos[0] - es.start[0], p.pos[2] - es.start[1]) < 900) {
      parkBomber(p);
      continue;
    }
    // Defensive gunners: each gun position picks the nearest enemy in range.
    let firing = false;
    muzzles.forEach((mz, i) => {
      const st = b.guns[i];
      if (!st) return;
      const from = add(p.pos, rotate(p.quat, mz.pos));
      const t = turretTarget(world, from, p.team, gunners.rangeM);
      if (stepTurret(st, gunners, from, p.vel, t, p.id, p.team, 'gunner', dt, () => random(world), () => world.nextBulletId++, world.bullets)) firing = true;
    });
    p.firing = firing;
  }
}

// ---------------------------------------------------------------- scoring

/** A plane went down: tickets, points or kills, by mode. Bombers count for the interceptors. */
export function scoreDeath(world: WorldState, victim: PlaneState, killerTeam: Team | null): void {
  const o = world.objectives;
  const m = world.match;
  if (isBomber(world, victim.id)) {
    if (o.escort) {
      o.escort.downed++;
      m.score[victim.team === 'red' ? 'blue' : 'red'] += o.rules.pointsDowned;
    }
    victim.respawnIn = NO_LIMIT;
    return;
  }
  if (isTicketMode(o.mode)) {
    m.score[victim.team] = Math.max(0, m.score[victim.team] - o.rules.ticketsPerDeath);
    return;
  }
  if (!killerTeam || killerTeam === victim.team) return;
  m.score[killerTeam] += o.mode === 'bomber_escort' ? o.rules.pointsPerKill : 1;
}

/** End of the match by the mode's rules: kill limit (TDM), tickets run out (Air Domination, Ground Strike),
 *  or the clock. The higher score (kills, tickets left, points) wins. */
export function checkEnd(world: WorldState): void {
  const m = world.match;
  const mode = world.objectives.mode;
  const ticketsOut = isTicketMode(mode) && (m.score.red <= 0 || m.score.blue <= 0);
  const killLimit = (mode === 'tdm' || mode === 'free') && (m.score.red >= m.killLimit || m.score.blue >= m.killLimit);
  if (!ticketsOut && !killLimit && m.timeLeftS > 0) return;
  m.state = 'ended';
  const red = Math.ceil(m.score.red);
  const blue = Math.ceil(m.score.blue);
  m.winner = red === blue ? 'draw' : red > blue ? 'red' : 'blue';
}

// ---------------------------------------------------------------- the per-tick entry point

/** Everything the modes do each tick, after planes, missiles and bullets have moved. */
export function stepObjectives(world: WorldState, ctx: WorldContext, dt: number, events: GameEvent[]): void {
  const o = world.objectives;
  if (o.mode === 'free') return;
  placeUnits(world, ctx, world.time);
  if (o.units.length > 0) stepAa(world, ctx, dt);
  if (o.zones.length > 0) stepZones(world, ctx, dt, events);
  if (o.escort) stepEscort(world, ctx, dt, events);
}

/** Damage scale for missiles hitting a bomber: a missile takes its % of missileHp, not of the bomber's HP. */
export function missileHpOf(world: WorldState, ctx: WorldContext, victim: PlaneState): number {
  if (!isBomber(world, victim.id)) return victim.maxHp;
  return Math.min(victim.maxHp, bomberFor(ctx, world.objectives.era).missileHp);
}

export const ENEMY_OF: Record<Team, Team> = { red: 'blue', blue: 'red' };

/** Plain helper for HUDs and bots: horizontal distance. */
export const flatDist = (a: Vec3, x: number, z: number): number => Math.hypot(a[0] - x, a[2] - z);
