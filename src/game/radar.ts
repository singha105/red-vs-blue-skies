// Aircraft radar (jets with a `radar` block in planes.json). Pure simulation: the host runs it for every plane,
// and the cockpit scope uses the same visibility test, so what the scope shows is what the radar can lock.
//
// * Search: the scope shows every contact the radar can see (contacts refresh when the sweep passes them;
//   that part is drawn by the cockpit, the radar itself always knows).
// * Lock: a continuous track on one plane. Semi-active missiles guide only while it holds; the target's radar
//   warning shows a lock. The lock survives short gaps (RADAR_MEMORY_S) but drops when the target notches,
//   hides in ground clutter, leaves the cone or the range for longer.
// * Dogfight: no scope picture; the radar locks the first enemy inside a narrow cone ahead within 10 km.
import type { Plane, PlaneRadar } from '../data/types';
import type { ControlInput } from './controls';
import type { PlaneState } from './flight';
import { FORWARD, rotate } from './math';
import { radarBlocked } from './missiles';

/** Scope ranges the pilot cycles through with the range key (km). Detection uses the radar's own rangeKm. */
export const RADAR_RANGES_KM = [5, 10, 20] as const;
/** Dogfight mode: half-angle of the auto-lock cone, and its range. */
export const DOGFIGHT_CONE_DEG = 10;
export const DOGFIGHT_RANGE_M = 10_000;
/** A lock rides out gaps shorter than this. */
export const RADAR_MEMORY_S = 1;

export const radarOf = (def: Plane | undefined): PlaneRadar | undefined => def?.radar;

/** Can `me`'s radar see `target` right now? Cone and range from the plane's radar, plus clutter and notching. */
export function radarSees(me: PlaneState, radar: PlaneRadar, target: PlaneState, targetDef: Plane | undefined, coneDeg = radar.coneDeg, rangeM = radar.rangeKm * 1000): boolean {
  if (!target.alive) return false;
  return radarBlocked(me.pos, rotate(me.quat, FORWARD), target, rangeM, coneDeg, targetDef) === null;
}

/** Enemy nearest the nose that the radar sees (inside `coneDeg`), or null. */
function nearestContact(me: PlaneState, radar: PlaneRadar, planes: readonly PlaneState[], defs: Map<string, Plane>, coneDeg: number, rangeM: number): PlaneState | null {
  const nose = rotate(me.quat, FORWARD);
  let best: PlaneState | null = null;
  let bestCos = -2;
  for (const p of planes) {
    if (!p.alive || p.team === me.team || p.id === me.id) continue;
    if (!radarSees(me, radar, p, defs.get(p.planeId), coneDeg, rangeM)) continue;
    const dx = p.pos[0] - me.pos[0], dy = p.pos[1] - me.pos[1], dz = p.pos[2] - me.pos[2];
    const c = (dx * nose[0] + dy * nose[1] + dz * nose[2]) / (Math.hypot(dx, dy, dz) || 1);
    if (c > bestCos) {
      bestCos = c;
      best = p;
    }
  }
  return best;
}

/** One tick of a plane's radar: power, mode and range from the input, then keep, drop or acquire the lock. */
export function stepRadar(me: PlaneState, def: Plane | undefined, input: ControlInput, planes: readonly PlaneState[], defs: Map<string, Plane>, dt: number): void {
  const radar = radarOf(def);
  if (!radar) {
    me.radarOn = false;
    me.radarLock = null;
    return;
  }
  me.radarOn = input.radarOn ?? true;
  me.radarMode = input.radarDogfight && radar.modes.includes('dogfight') ? 'dogfight' : 'search';
  me.radarRange = Math.max(0, Math.min(RADAR_RANGES_KM.length - 1, Math.round(input.radarRange ?? 1)));
  if (!me.radarOn || !input.radarLock) {
    me.radarLock = null;
    me.radarLostFor = 0;
    return;
  }
  if (me.radarLock) {
    const t = planes.find((p) => p.id === me.radarLock);
    if (!t || !t.alive) {
      me.radarLock = null;
    } else if (radarSees(me, radar, t, defs.get(t.planeId))) {
      me.radarLostFor = 0;
    } else {
      me.radarLostFor += dt;
      if (me.radarLostFor > RADAR_MEMORY_S) me.radarLock = null;
    }
    if (me.radarLock) return;
  }
  me.radarLostFor = 0;
  if (me.radarMode === 'dogfight') {
    me.radarLock = nearestContact(me, radar, planes, defs, DOGFIGHT_CONE_DEG, Math.min(DOGFIGHT_RANGE_M, radar.rangeKm * 1000))?.id ?? null;
    return;
  }
  // Search: lock the picked target if the radar sees it, else the contact nearest the nose.
  const picked = input.target ? planes.find((p) => p.id === input.target && p.team !== me.team) : undefined;
  if (picked && radarSees(me, radar, picked, defs.get(picked.planeId))) me.radarLock = picked.id;
  else me.radarLock = nearestContact(me, radar, planes, defs, radar.coneDeg, radar.rangeKm * 1000)?.id ?? null;
}
