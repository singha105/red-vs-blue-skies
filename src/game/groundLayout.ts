// Where each map's ground targets sit and how they move, generated from the map's seed and heightmap at no
// storage cost. The host sends its layout in the match start message, so clients never depend on their own
// floating point agreeing with the host's. Pure data, no Three.js.
//
// Per team, on its own half of the map: two convoys (three trucks and a tank) driving back and forth on a road
// found across flat ground, three bunkers with an AA gun beside each, a supply depot near the back (the Bomber
// Escort target), and two destroyers circling offshore where there is open water. Carrier Strike has a carrier
// and three destroyers per team instead (there is no land). Positions move as a function of match time only.
import type { GameMap, UnitKind } from '../data/types';
import type { Team } from './flight';
import { createRng, range } from './rng';
import type { Terrain } from './terrain';

export type Vec2 = [number, number];

export interface UnitSlot {
  kind: UnitKind;
  team: Team;
  /** Convoys: a road driven back and forth (ping-pong), and how far behind the convoy's lead this vehicle is. */
  road: Vec2[] | null;
  roadOffsetM: number;
  /** Ships: a circle, its start angle and direction (+1 counter-clockwise). */
  circle: { x: number; z: number; r: number; a0: number; dir: number } | null;
  /** Static units (and where a moving one starts). */
  x: number;
  z: number;
  heading: number;
}

export interface GroundLayout {
  slots: UnitSlot[];
  /** Index of each team's Bomber Escort target (its depot, or its carrier). */
  depot: Record<Team, number>;
}

export interface UnitPose {
  x: number;
  z: number;
  heading: number;
}

const TEAMS: readonly Team[] = ['red', 'blue'];
/** Red holds the west half (negative x), blue the east, matching the spawns. */
const sideSign = (team: Team): number => (team === 'red' ? -1 : 1);
const CONVOY = ['truck', 'truck', 'tank', 'truck'] as const;
const CONVOY_GAP_M = 45;

const cache = new Map<string, GroundLayout>();

export function groundLayout(map: GameMap, terrain: Terrain): GroundLayout {
  const cached = cache.get(map.id);
  if (cached) return cached;
  const layout = map.terrain === 'ocean' ? navalLayout(map, terrain) : landLayout(map, terrain);
  cache.set(map.id, layout);
  return layout;
}

/** Flat dry ground: above the water and less than ~10° of slope. */
function flatLand(t: Terrain, x: number, z: number): boolean {
  const h = t.heightAt(x, z);
  if (h < 8) return false;
  const d = 30;
  return (
    Math.abs(t.heightAt(x + d, z) - h) < 6 &&
    Math.abs(t.heightAt(x - d, z) - h) < 6 &&
    Math.abs(t.heightAt(x, z + d) - h) < 6 &&
    Math.abs(t.heightAt(x, z - d) - h) < 6
  );
}

/** Open water deep enough for a ship all the way round a circle. */
function openWater(t: Terrain, x: number, z: number, r: number): boolean {
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    if (t.heightAt(x + Math.cos(a) * (r + 60), z + Math.sin(a) * (r + 60)) > -25) return false;
  }
  return t.heightAt(x, z) < -25;
}

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

function landLayout(map: GameMap, t: Terrain): GroundLayout {
  const rng = createRng((map.seed ^ 0x5bd1e995) >>> 0);
  const half = map.sizeM / 2;
  const slots: UnitSlot[] = [];
  const depot = { red: -1, blue: -1 } as Record<Team, number>;

  for (const team of TEAMS) {
    const s = sideSign(team);
    // Candidate flat spots on this team's half, away from the middle and the very edge.
    const flat: Vec2[] = [];
    for (let x = 1300; x <= half - 900; x += 200) {
      for (let z = -half + 900; z <= half - 900; z += 200) {
        const px = s * x + range(rng, -60, 60);
        const pz = z + range(rng, -60, 60);
        if (flatLand(t, px, pz)) flat.push([px, pz]);
      }
    }
    const used: Vec2[] = [];
    const free = (p: Vec2, gap: number): boolean => used.every((u) => dist(u, p) >= gap);

    // Two convoy roads: walk across flat ground from a random start, turning as little as possible.
    let convoys = 0;
    for (let attempt = 0; attempt < 60 && convoys < 2 && flat.length > 0; attempt++) {
      const start = flat[Math.floor(rng() * flat.length)]!;
      if (!free(start, 1200)) continue;
      const road = walkRoad(t, start, rng() * Math.PI * 2, s, half);
      if (road.length < 7) continue;
      for (const p of road) used.push(p);
      CONVOY.forEach((kind, i) => slots.push({ kind, team, road, roadOffsetM: i * CONVOY_GAP_M, circle: null, x: road[0]![0], z: road[0]![1], heading: 0 }));
      convoys++;
    }

    // Three bunkers, spread out, each with an AA gun beside it.
    let bunkers = 0;
    // Fisher–Yates: a random-comparator sort would differ between browsers.
    const order = [...flat];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    for (const p of order) {
      if (bunkers >= 3) break;
      if (!free(p, 1100)) continue;
      const aa = findNear(t, p, 160, rng);
      if (!aa) continue;
      used.push(p);
      slots.push({ kind: 'bunker', team, road: null, roadOffsetM: 0, circle: null, x: p[0], z: p[1], heading: rng() * Math.PI * 2 });
      slots.push({ kind: 'aa', team, road: null, roadOffsetM: 0, circle: null, x: aa[0], z: aa[1], heading: 0 });
      bunkers++;
    }

    // The depot: the flat spot nearest the team's rear, on the spawn line.
    const rear: Vec2 = [s * (half - 2200), 0];
    const depotAt = flat.filter((p) => free(p, 500)).sort((a, b) => dist(a, rear) - dist(b, rear))[0] ?? rear;
    depot[team] = slots.length;
    slots.push({ kind: 'depot', team, road: null, roadOffsetM: 0, circle: null, x: depotAt[0], z: depotAt[1], heading: 0 });

    // Destroyers where there's open water on this side.
    let ships = 0;
    for (let attempt = 0; attempt < 400 && ships < 2; attempt++) {
      const p: Vec2 = [s * range(rng, 1500, half - 1500), range(rng, -half + 1500, half - 1500)];
      const r = range(rng, 350, 600);
      if (!openWater(t, p[0], p[1], r) || !free(p, r * 2 + 300)) continue;
      used.push(p);
      slots.push({ kind: 'ship', team, road: null, roadOffsetM: 0, circle: { x: p[0], z: p[1], r, a0: rng() * Math.PI * 2, dir: rng() < 0.5 ? 1 : -1 }, x: p[0], z: p[1], heading: 0 });
      ships++;
    }
  }
  return { slots, depot };
}

/** A road across flat ground: up to 14 steps of 120 m, each turning by the smallest angle that stays flat. */
function walkRoad(t: Terrain, start: Vec2, heading: number, side: number, half: number): Vec2[] {
  const road: Vec2[] = [start];
  let h = heading;
  let p = start;
  for (let step = 0; step < 14; step++) {
    let next: Vec2 | null = null;
    for (const turn of [0, 0.25, -0.25, 0.5, -0.5, 0.8, -0.8]) {
      const a = h + turn;
      const q: Vec2 = [p[0] + Math.cos(a) * 120, p[1] + Math.sin(a) * 120];
      const inSide = q[0] * side > 1100 && Math.abs(q[0]) < half - 800 && Math.abs(q[1]) < half - 800;
      if (!inSide || !flatLand(t, q[0], q[1])) continue;
      // No climbing a cliff between the two points.
      const mid = t.heightAt((p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
      if (Math.abs(t.heightAt(q[0], q[1]) - t.heightAt(p[0], p[1])) > 18 || Math.abs(mid - t.heightAt(p[0], p[1])) > 14) continue;
      next = q;
      h = a;
      break;
    }
    if (!next) break;
    road.push(next);
    p = next;
  }
  return road;
}

function findNear(t: Terrain, p: Vec2, r: number, rng: () => number): Vec2 | null {
  for (let k = 0; k < 12; k++) {
    const a = rng() * Math.PI * 2;
    const q: Vec2 = [p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r];
    if (flatLand(t, q[0], q[1])) return q;
  }
  return null;
}

/** Carrier Strike: per team a carrier steaming in a wide circle behind its side, with three destroyers. */
function navalLayout(map: GameMap, _t: Terrain): GroundLayout {
  const rng = createRng((map.seed ^ 0x2545f491) >>> 0);
  const slots: UnitSlot[] = [];
  const depot = { red: -1, blue: -1 } as Record<Team, number>;
  for (const team of TEAMS) {
    const s = sideSign(team);
    // Offset from the zone line (z = 0) so the carriers aren't right under the fight over the zones.
    const cx = s * 4700;
    const cz = s * -2600;
    depot[team] = slots.length;
    slots.push({ kind: 'carrier', team, road: null, roadOffsetM: 0, circle: { x: cx, z: cz, r: 1300, a0: rng() * Math.PI * 2, dir: 1 }, x: cx, z: cz, heading: 0 });
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + rng();
      const x = cx + Math.cos(a) * 2300;
      const z = cz + Math.sin(a) * 2300;
      slots.push({ kind: 'ship', team, road: null, roadOffsetM: 0, circle: { x, z, r: range(rng, 300, 500), a0: rng() * Math.PI * 2, dir: k % 2 ? 1 : -1 }, x, z, heading: 0 });
    }
  }
  return { slots, depot };
}

/** Where a unit is at match time `time` (seconds), moving at `speedMs`. */
export function unitPose(slot: UnitSlot, speedMs: number, time: number, out: UnitPose): UnitPose {
  if (slot.road && slot.road.length > 1) {
    const road = slot.road;
    let total = 0;
    for (let i = 1; i < road.length; i++) total += dist(road[i - 1]!, road[i]!);
    // Ping-pong along the road; the vehicles behind the lead trail it by their offset.
    let s = (speedMs * time + total * 2 - slot.roadOffsetM) % (total * 2);
    let dir = 1;
    if (s > total) {
      s = total * 2 - s;
      dir = -1;
    }
    for (let i = 1; i < road.length; i++) {
      const a = road[i - 1]!;
      const b = road[i]!;
      const seg = dist(a, b);
      if (s <= seg || i === road.length - 1) {
        const k = Math.min(1, s / seg);
        out.x = a[0] + (b[0] - a[0]) * k;
        out.z = a[1] + (b[1] - a[1]) * k;
        out.heading = Math.atan2((b[0] - a[0]) * dir, (b[1] - a[1]) * dir);
        return out;
      }
      s -= seg;
    }
  }
  if (slot.circle) {
    const c = slot.circle;
    const a = c.a0 + (c.dir * speedMs * time) / c.r;
    out.x = c.x + Math.cos(a) * c.r;
    out.z = c.z + Math.sin(a) * c.r;
    // Tangent of the circle in the direction of travel.
    out.heading = Math.atan2(-Math.sin(a) * c.dir, Math.cos(a) * c.dir);
    return out;
  }
  out.x = slot.x;
  out.z = slot.z;
  out.heading = slot.heading;
  return out;
}
