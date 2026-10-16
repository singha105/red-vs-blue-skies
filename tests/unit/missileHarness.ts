// Shared missile engagement harness for the missile tests (not a test file itself).
import { loadGameData } from '../../src/data';
import type { GameData } from '../../src/data/types';
import { aimControl, createAimPd } from '../../src/game/autopilot';
import { neutralInput, type ControlInput } from '../../src/game/controls';
import type { PlaneState } from '../../src/game/flight';
import { len, normalize, quatLookRotation, scale, type Vec3 } from '../../src/game/math';
import { inbound, launch, type MissileContext, type MissileEvent } from '../../src/game/missiles';
import { addPilot, createWorld, createWorldContext, random, spawnPlane, stepWorld, type WorldState } from '../../src/game/world';

export const DT = 1 / 60;
const result = loadGameData();
if (!result.ok) throw new Error('data invalid');
export const data: GameData = result.data;
export const ctx = createWorldContext(data, 'island_chain');
export const ALT = 3000;

export const mcOf = (w: WorldState): MissileContext => ({
  missileDefs: ctx.missileDefs,
  missileClasses: ctx.missileClasses,
  planeDefs: ctx.planeDefs,
  surfaceAt: ctx.terrain.surfaceAt,
  random: () => random(w),
});

export function place(p: PlaneState, pos: Vec3, heading: Vec3, speedFrac: number): void {
  const h = normalize(heading);
  p.pos = pos;
  p.quat = quatLookRotation(h);
  p.vel = scale(h, ctx.params.get(p.planeId)!.topSpeedMs * speedFrac);
  p.protectedFor = 0;
}

export type Defense = (w: WorldState, target: PlaneState, shooter: PlaneState, t: number) => ControlInput;

export interface Engagement {
  missile: string;
  /** Target heading relative to the line of sight from the shooter: 0 = flying away, 180 = head-on. */
  aspectDeg: number;
  rangeM: number;
  shooterPlane?: string;
  targetPlane?: string;
  targetThrottle?: number;
  /** Target speed as a fraction of its top speed (default 0.75). */
  targetSpeed?: number;
  defend?: Defense;
  seed?: number;
}

/** Fly one shot: returns whether the missile hit and how long it flew. */
export function engage(e: Engagement): { hit: boolean; time: number; w: WorldState } {
  const w = createWorld(ctx, e.seed ?? 7);
  addPilot(w, { id: 's', name: 'S', team: 'blue', bot: false });
  addPilot(w, { id: 't', name: 'T', team: 'red', bot: false });
  const s = spawnPlane(w, ctx, { id: 's', team: 'blue', planeId: e.shooterPlane ?? 'f15c' });
  const t = spawnPlane(w, ctx, { id: 't', team: 'red', planeId: e.targetPlane ?? 'su27s' });
  const a = (e.aspectDeg * Math.PI) / 180;
  place(s, [0, ALT, -4000], [0, 0, 1], 0.75);
  place(t, [0, ALT, -4000 + e.rangeM], [Math.sin(a), 0, Math.cos(a)], e.targetSpeed ?? 0.75);
  t.throttle = e.targetThrottle ?? 0.8;
  s.hp = t.hp = t.maxHp = 1e6; // count hits, don't kill
  const m = ctx.missileDefs.get(e.missile)!;
  const events: MissileEvent[] = [];
  // Radar missiles need the shooter's radar locked on the target (semi-active ones until impact).
  s.radarLock = 't';
  launch(w, s, 0, m, t, events);
  const sIn: ControlInput = { ...neutralInput(0.8), target: 't', radarOn: true, radarLock: true };
  let time = 0;
  for (; time < 40 && w.missiles.length > 0; time += DT) {
    const tIn = e.defend ? e.defend(w, t, s, time) : neutralInput(t.throttle);
    stepWorld(w, ctx, { s: sIn, t: tIn }, DT);
    if (w.events.some((ev) => ev.t === 'detonate' && ev.victim === 't')) return { hit: true, time, w };
  }
  return { hit: false, time, w };
}

/** Fly level toward a world direction with the mouse-aim autopilot. */
export function steer(target: PlaneState, dir: Vec3, pd = createAimPd()): Pick<ControlInput, 'pitch' | 'roll' | 'yaw'> {
  return aimControl(target, normalize([dir[0], 0, dir[2]]), pd, DT);
}

/** Notch: turn the missile's line of sight onto the wing (90°), drop chaff once it's close. */
export const notchDefense = (chaff: boolean): Defense => {
  const pd = createAimPd();
  return (w, t, s) => {
    const ms = inbound(w, t.id)[0];
    const from = ms ? ms.pos : s.pos;
    const los = normalize([t.pos[0] - from[0], 0, t.pos[2] - from[2]]);
    // Pick the side of the beam closest to where we're already heading.
    const left: Vec3 = [los[2], 0, -los[0]];
    const side = left[0] * t.vel[0] + left[2] * t.vel[2] >= 0 ? left : scale(left, -1);
    const close = ms ? len([t.pos[0] - ms.pos[0], t.pos[1] - ms.pos[1], t.pos[2] - ms.pos[2]]) < 2500 : false;
    return { ...steer(t, side, pd), throttle: 1, fire: false, missile: false, flare: false, target: null, ...(chaff && close ? { flare: true } : {}) };
  };
};

/** IR defence: cut the throttle, pop flares once the missile is close, and break across its path. */
export const flareDefense = (): Defense => {
  const pd = createAimPd();
  return (w, t) => {
    const ms = inbound(w, t.id)[0] ?? w.missiles[0];
    if (!ms) return neutralInput(0.3);
    const d = len([t.pos[0] - ms.pos[0], t.pos[1] - ms.pos[1], t.pos[2] - ms.pos[2]]);
    const los = normalize([t.pos[0] - ms.pos[0], 0, t.pos[2] - ms.pos[2]]);
    const beam: Vec3 = [los[2], 0, -los[0]];
    const side = beam[0] * t.vel[0] + beam[2] * t.vel[2] >= 0 ? beam : scale(beam, -1);
    return { ...steer(t, d < 1500 ? side : los, pd), throttle: 0.3, fire: false, missile: false, flare: d < 1800, target: null };
  };
};

