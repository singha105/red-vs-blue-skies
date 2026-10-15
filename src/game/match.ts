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
  era: EraId;
  difficulty: BotDifficulty;
  nextBot: number;
}

export const PLAYER_ID = 'p1';

export interface HumanSlot {
  id: string;
  name: string;
  planeId: string;
  /** Leave out to auto-balance (alternating, blue first). */
  team?: Team;
  assist?: number;
}

export interface MatchOptions {
  era: EraId;
  difficulty: BotDifficulty;
  humans: HumanSlot[];
  timeLimitS?: number;
  killLimit?: number;
  seed?: number;
}

/** A 10 vs 10 Team Deathmatch: the given humans plus bots in every empty slot. */
export function createMatch(ctx: WorldContext, opts: MatchOptions): Match {
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
  const match: Match = { world, brains: [], playerId: opts.humans[0]?.id ?? PLAYER_ID, era: opts.era, difficulty: opts.difficulty, nextBot: 0 };
  const counts: Record<Team, number> = { blue: 0, red: 0 };
  for (const h of opts.humans) {
    const def = ctx.planeDefs.get(h.planeId);
    if (!def || def.era !== opts.era) throw new Error(`plane ${h.planeId} is not in era ${opts.era}`);
    const team = h.team ?? (counts.blue <= counts.red ? 'blue' : 'red');
    if (counts[team] >= TEAM_SIZE) continue;
    counts[team]++;
    addPilot(world, { id: h.id, name: h.name, team, bot: false });
    spawnPlane(world, ctx, { id: h.id, team, planeId: h.planeId, assist: h.assist ?? 0 });
  }
  for (const team of ['blue', 'red'] as Team[]) {
    while (counts[team] < TEAM_SIZE) {
      addBot(match, ctx, team);
      counts[team]++;
    }
  }
  world.events = [];
  return match;
}

/** Bots fly planes within two tiers of the humans' (median), so nobody is hopelessly outclassed. */
function botPlane(match: Match, ctx: WorldContext): string {
  const w = match.world;
  const tiers = w.planes.filter((p) => !w.pilots[p.id]?.bot).map((p) => ctx.planeDefs.get(p.planeId)?.tier ?? 3);
  const centre = tiers.length ? tiers.sort((a, b) => a - b)[Math.floor(tiers.length / 2)]! : 3;
  const pool = ctx.data.planes.filter((p) => p.era === match.era && Math.abs(p.tier - centre) <= 2);
  return pool[Math.floor(random(w) * pool.length)]?.id ?? pool[0]!.id;
}

function addBot(match: Match, ctx: WorldContext, team: Team): string {
  const id = `b${++match.nextBot}`;
  addPilot(match.world, { id, name: CALLSIGNS[(match.nextBot - 1) % CALLSIGNS.length]!, team, bot: true });
  spawnPlane(match.world, ctx, { id, team, planeId: botPlane(match, ctx) });
  match.brains.push(createBrain(id, match.difficulty));
  return id;
}

/** Join in progress: the newcomer takes a bot's slot on the team with fewer humans. Returns their team, or null if full. */
export function addHumanToMatch(match: Match, ctx: WorldContext, human: HumanSlot): Team | null {
  const w = match.world;
  const humans = (team: Team): number => w.planes.filter((p) => p.team === team && !w.pilots[p.id]?.bot).length;
  const order: Team[] = humans('blue') <= humans('red') ? ['blue', 'red'] : ['red', 'blue'];
  for (const team of order) {
    const bot = w.planes.find((p) => p.team === team && w.pilots[p.id]?.bot);
    if (!bot) continue;
    w.planes = w.planes.filter((p) => p.id !== bot.id);
    delete w.pilots[bot.id];
    delete w.stats[bot.id];
    match.brains = match.brains.filter((b) => b.id !== bot.id);
    addPilot(w, { id: human.id, name: human.name, team, bot: false });
    spawnPlane(w, ctx, { id: human.id, team, planeId: human.planeId, assist: human.assist ?? 0 });
    return team;
  }
  return null;
}

/** A human left: a bot takes over their plane (and keeps their score). */
export function botTakeOver(match: Match, id: string): void {
  const pilot = match.world.pilots[id];
  if (!pilot || pilot.bot) return;
  pilot.bot = true;
  pilot.name = `${pilot.name} (bot)`;
  match.brains.push(createBrain(id, match.difficulty));
}

export function createSoloMatch(ctx: WorldContext, opts: SoloOptions): Match {
  return createMatch(ctx, {
    era: opts.era,
    difficulty: opts.difficulty,
    humans: [{ id: PLAYER_ID, name: opts.playerName ?? 'You', planeId: opts.planeId, team: 'blue', assist: opts.assist ?? 0 }],
    ...(opts.timeLimitS !== undefined ? { timeLimitS: opts.timeLimitS } : {}),
    ...(opts.killLimit !== undefined ? { killLimit: opts.killLimit } : {}),
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
  });
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
