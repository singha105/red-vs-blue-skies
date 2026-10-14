// Solo Team Deathmatch: the player plus bots fill a 10 vs 10 match. stepMatch runs the bots, the world
// and the match clock. (Day 5 runs this on the host; Day 6 adds lobby, voting and BR balancing.)
import type { EraId } from '../data/types';
import { botInput, createBrain, type BotBrain } from './bots';
import type { ControlInput } from './controls';
import type { Team } from './flight';
import { addPilot, createWorld, random, spawnPlane, stepWorld, type BotDifficulty, type WorldContext, type WorldState } from './world';

export const TEAM_SIZE = 10;

const CALLSIGNS = [
  'Ace', 'Banshee', 'Cobra', 'Dagger', 'Echo', 'Falcon', 'Ghost', 'Hawk', 'Iceman', 'Jester',
  'Kestrel', 'Lancer', 'Maverick', 'Nomad', 'Osprey', 'Phoenix', 'Raptor', 'Sabre', 'Talon', 'Viper',
];

export interface SoloOptions {
  era: EraId;
  planeId: string;
  difficulty: BotDifficulty;
  playerName?: string;
  /** Touch aim assist for the player (0 = off). */
  assist?: number;
  timeLimitS?: number;
  killLimit?: number;
  seed?: number;
}

export interface Match {
  world: WorldState;
  brains: BotBrain[];
  playerId: string;
}

export const PLAYER_ID = 'p1';

export function createSoloMatch(ctx: WorldContext, opts: SoloOptions): Match {
  const world = createWorld(ctx, opts.seed ?? (Date.now() & 0xffffffff));
  const mode = ctx.data.modes.find((m) => m.id === 'tdm');
  world.match = {
    mode: 'tdm',
    timeLeftS: opts.timeLimitS ?? mode?.timeLimitS ?? 600,
    killLimit: opts.killLimit ?? mode?.killLimit ?? 50,
    score: { red: 0, blue: 0 },
    state: 'playing',
    winner: null,
  };

  const player = ctx.planeDefs.get(opts.planeId);
  if (!player || player.era !== opts.era) throw new Error(`plane ${opts.planeId} is not in era ${opts.era}`);
  const eraPlanes = ctx.data.planes.filter((p) => p.era === opts.era);
  // Bots fly planes within two tiers of the player's, so nobody is hopelessly outclassed.
  const pool = eraPlanes.filter((p) => Math.abs(p.tier - player.tier) <= 2);

  addPilot(world, { id: PLAYER_ID, name: opts.playerName ?? 'You', team: 'blue', bot: false });
  spawnPlane(world, ctx, { id: PLAYER_ID, team: 'blue', planeId: opts.planeId, assist: opts.assist ?? 0 });

  const brains: BotBrain[] = [];
  let n = 0;
  for (const team of ['blue', 'red'] as Team[]) {
    const count = team === 'blue' ? TEAM_SIZE - 1 : TEAM_SIZE;
    for (let i = 0; i < count; i++) {
      const id = `b${++n}`;
      const plane = pool[Math.floor(random(world) * pool.length)] ?? player;
      addPilot(world, { id, name: CALLSIGNS[(n - 1) % CALLSIGNS.length]!, team, bot: true });
      spawnPlane(world, ctx, { id, team, planeId: plane.id });
      brains.push(createBrain(id, opts.difficulty));
    }
  }
  world.events = [];
  return { world, brains, playerId: PLAYER_ID };
}

/** One fixed step: bots decide, the world moves, the clock and kill limit are checked. */
export function stepMatch(match: Match, ctx: WorldContext, humanInputs: Record<string, ControlInput>, dt: number): void {
  const w = match.world;
  if (w.match.state === 'ended') {
    w.events = [];
    return;
  }
  const inputs: Record<string, ControlInput> = { ...humanInputs };
  for (const brain of match.brains) inputs[brain.id] = botInput(w, ctx, brain, dt);
  stepWorld(w, ctx, inputs, dt);

  const m = w.match;
  m.timeLeftS = Math.max(0, m.timeLeftS - dt);
  if (m.score.red >= m.killLimit || m.score.blue >= m.killLimit || m.timeLeftS <= 0) {
    m.state = 'ended';
    m.winner = m.score.red === m.score.blue ? 'draw' : m.score.red > m.score.blue ? 'red' : 'blue';
  }
}
