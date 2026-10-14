// The world: every plane plus the map. stepWorld is the one place the simulation advances.
import type { GameData, GameMap, Plane } from '../data/types';
import type { ControlInput } from './controls';
import { neutralInput } from './controls';
import { edgeTurnInput, flightParams, stepPlane, type FlightParams, type PlaneState, type Team } from './flight';
import { normalize, quatLookRotation, scale, type Vec3 } from './math';
import { createTerrain, type Terrain } from './terrain';

export const RESPAWN_S = 3;

/** Serializable world state. */
export interface WorldState {
  tick: number;
  time: number;
  mapId: string;
  planes: PlaneState[];
}

/** Non-serializable helpers built from the data files; every peer rebuilds the same thing from the map id. */
export interface WorldContext {
  map: GameMap;
  terrain: Terrain;
  planeDefs: Map<string, Plane>;
  params: Map<string, FlightParams>;
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
  return { map, terrain: createTerrain(map), planeDefs: new Map(data.planes.map((p) => [p.id, p])), params };
}

export function createWorld(ctx: WorldContext): WorldState {
  return { tick: 0, time: 0, mapId: ctx.map.id, planes: [] };
}

/** Puts a plane in the air at its team's spawn, heading for the map centre at cruise speed. */
export function spawnPlane(
  world: WorldState,
  ctx: WorldContext,
  opts: { id: string; team: Team; planeId: string; offset?: Vec3 },
): PlaneState {
  const params = ctx.params.get(opts.planeId);
  if (!params) throw new Error(`unknown plane "${opts.planeId}"`);
  const base = ctx.map.spawns[opts.team];
  const off = opts.offset ?? [0, 0, 0];
  const pos: Vec3 = [base[0] + off[0], base[1] + off[1], base[2] + off[2]];
  const heading = normalize([-pos[0], 0, -pos[2]]);
  const cruise = params.topSpeedMs * 0.75;
  const state: PlaneState = {
    id: opts.id,
    team: opts.team,
    planeId: opts.planeId,
    pos,
    quat: quatLookRotation(heading),
    vel: scale(heading, cruise),
    throttle: 0.8,
    hp: ctx.planeDefs.get(opts.planeId)?.stats.hp ?? 100,
    stalled: false,
    alive: true,
    g: 1,
    edgeWarning: false,
    autoTurn: false,
    respawnIn: 0,
  };
  const existing = world.planes.findIndex((p) => p.id === opts.id);
  if (existing >= 0) world.planes[existing] = state;
  else world.planes.push(state);
  return state;
}

/** Advance the whole world one fixed step. Inputs are keyed by plane id; missing inputs mean "hands off". */
export function stepWorld(world: WorldState, ctx: WorldContext, inputs: Record<string, ControlInput>, dt: number): void {
  world.tick++;
  world.time += dt;
  const env = { surfaceAt: ctx.terrain.surfaceAt, half: ctx.terrain.half };
  for (let i = 0; i < world.planes.length; i++) {
    const plane = world.planes[i]!;
    if (!plane.alive) {
      if (plane.respawnIn <= 0) plane.respawnIn = RESPAWN_S;
      plane.respawnIn -= dt;
      if (plane.respawnIn <= 0) {
        spawnPlane(world, ctx, { id: plane.id, team: plane.team, planeId: plane.planeId });
      }
      continue;
    }
    const params = ctx.params.get(plane.planeId);
    if (!params) continue;
    let input = inputs[plane.id] ?? neutralInput(plane.throttle);
    if (plane.autoTurn) input = edgeTurnInput(plane, input);
    stepPlane(plane, input, params, env, dt);
  }
}
