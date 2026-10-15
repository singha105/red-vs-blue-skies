// What the cockpit shows and plays about missiles, worked out from the world (solo or networked alike):
// the lock and picked-target boxes, loadout, radar warning, launch warning, and the seeker and warning tones.
// Also picks targets for R / RB (next enemy off the nose) and for taps on the screen.
import type { SeekerTone, WarningTone } from '../core/audio';
import type { Missile } from '../data/types';
import type { PlaneState } from '../game/flight';
import { FORWARD, rotate, type Vec3 } from '../game/math';
import { inbound, lockSeeker } from '../game/missiles';
import type { WorldContext, WorldState } from '../game/world';
import type { WeaponsFrame } from '../ui/missileHud';

type ScreenOf = (id: string) => { x: number; y: number } | null;

const TARGET_RANGE_M = 9000;
/** A tap picks the enemy marker within this many pixels. */
export const TAP_RADIUS_PX = 70;

/** Short cockpit label: "AIM-9L Sidewinder" → "AIM-9L", "K-13 (R-3S)" → "K-13". */
export const missileLabel = (m: Missile): string => m.name.replace(/\s*\(.*\)$/, '').replace(/ (Sidewinder|Sparrow|AMRAAM)$/, '');

const bearing = (d: Vec3): number => Math.atan2(-d[0], d[2]);
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Next enemy for R / RB: enemies within reach and ahead of the wing line, by angle off the nose. */
export function cycleTarget(w: WorldState, me: PlaneState, current: string | null): string | null {
  const nose = rotate(me.quat, FORWARD);
  const list = w.planes
    .filter((p) => p.alive && p.team !== me.team)
    .map((p) => {
      const d: Vec3 = [p.pos[0] - me.pos[0], p.pos[1] - me.pos[1], p.pos[2] - me.pos[2]];
      const dist = Math.hypot(d[0], d[1], d[2]);
      return { id: p.id, dist, angle: Math.acos(Math.max(-1, Math.min(1, (d[0] * nose[0] + d[1] * nose[1] + d[2] * nose[2]) / Math.max(dist, 1)))) };
    })
    .filter((t) => t.dist < TARGET_RANGE_M && t.angle < Math.PI / 2)
    .sort((a, b) => a.angle - b.angle);
  if (list.length === 0) return null;
  const i = list.findIndex((t) => t.id === current);
  return list[(i + 1) % list.length]!.id;
}

/** The enemy whose marker is nearest a tap, if it's close enough. */
export function targetAt(w: WorldState, me: PlaneState, screenOf: ScreenOf, x: number, y: number): string | null {
  let best: string | null = null;
  let bestD = TAP_RADIUS_PX;
  for (const p of w.planes) {
    if (!p.alive || p.team === me.team) continue;
    const s = screenOf(p.id);
    if (!s) continue;
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < bestD) {
      bestD = d;
      best = p.id;
    }
  }
  return best;
}

export interface CockpitState {
  frame: WeaponsFrame | null;
  seeker: SeekerTone;
  warning: WarningTone;
  /** For the touch Missile button. */
  touch: null | { progress: number; locked: boolean; missiles: number; flares: number; chaff: number };
}

export function cockpitState(w: WorldState, ctx: WorldContext, me: PlaneState, picked: string | null, screenOf: ScreenOf): CockpitState {
  const def = ctx.planeDefs.get(me.planeId);
  if (!def || !me.alive) return { frame: null, seeker: 'off', warning: 'off', touch: null };
  const nose = rotate(me.quat, FORWARD);
  const heading = bearing(nose);

  // Lock and picked target.
  let lock: WeaponsFrame['lock'] = null;
  let seeker: SeekerTone = 'off';
  const kind = lockSeeker(ctx, me);
  const lockedOn = me.lockTarget ? w.planes.find((p) => p.id === me.lockTarget && p.alive) : undefined;
  if (lockedOn && kind && me.lockProgress > 0) {
    const s = screenOf(lockedOn.id);
    const m = ctx.missileDefs.get(def.missiles[me.lockMount]?.type ?? '');
    const dist = Math.hypot(lockedOn.pos[0] - me.pos[0], lockedOn.pos[1] - me.pos[1], lockedOn.pos[2] - me.pos[2]);
    const locked = me.lockProgress >= 1;
    const inRange = m ? dist >= m.minRangeM && dist <= m.maxRangeM : false;
    if (s) lock = { x: s.x, y: s.y, progress: me.lockProgress, locked, radar: kind === 'radar', inRange };
    seeker = kind === 'ir' ? (locked ? 'ir_lock' : 'ir_search') : locked ? 'radar_lock' : 'radar_search';
  }
  const pickedPlane = picked && picked !== me.lockTarget ? w.planes.find((p) => p.id === picked && p.alive) : undefined;
  const pickedScreen = pickedPlane ? screenOf(pickedPlane.id) : null;

  // Threats: radar locks on us (spikes) and missiles guiding on us.
  const rwr: WeaponsFrame['rwr'] = [];
  for (const p of w.planes) {
    if (!p.alive || p.team === me.team || p.lockTarget !== me.id || p.lockProgress < 0.25) continue;
    if (lockSeeker(ctx, p) !== 'radar') continue;
    rwr.push({ angle: wrap(bearing([p.pos[0] - me.pos[0], 0, p.pos[2] - me.pos[2]]) - heading), kind: 'spike' });
  }
  const threats = inbound(w, me.id);
  let ir = false;
  let radar = false;
  for (const m of threats) {
    rwr.push({ angle: wrap(bearing([m.pos[0] - me.pos[0], 0, m.pos[2] - me.pos[2]]) - heading), kind: 'missile' });
    const md = ctx.missileDefs.get(m.type);
    if (md && ctx.missileClasses.get(md.class)?.seeker === 'radar') radar = true;
    else ir = true;
  }

  const loadout = def.missiles.map((mount, i) => {
    const md = ctx.missileDefs.get(mount.type);
    return { label: md ? missileLabel(md) : mount.type, count: me.missiles[i] ?? 0, active: i === me.lockMount };
  });
  const total = me.missiles.reduce((a, b) => a + b, 0);
  return {
    frame: {
      lock,
      picked: pickedScreen,
      loadout,
      flares: me.flares,
      chaff: me.chaff,
      rwr,
      warning: threats.length > 0 ? { ir, radar } : null,
    },
    seeker,
    warning: threats.length > 0 ? 'launch' : rwr.length > 0 ? 'spike' : 'off',
    touch: def.missiles.length + def.countermeasures.flares + def.countermeasures.chaff > 0
      ? { progress: lockedOn ? me.lockProgress : 0, locked: Boolean(lockedOn) && me.lockProgress >= 1, missiles: total, flares: me.flares, chaff: me.chaff }
      : null,
  };
}
