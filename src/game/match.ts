// Team Deathmatch: humans plus bots fill a 10 vs 10 match, with bot planes chosen so both teams' Battle
// Rating totals match (teams.ts). stepMatch runs the bots, the world and the match clock. Solo runs it
// locally; in multiplayer only the host does.
import type { EraId } from '../data/types';
import { botInput, createBrain, type BotBrain } from './bots';
import type { ControlInput } from './controls';
import type { Team } from './flight';
import { balanceBots, TEAM_SIZE, type BotLineup } from './teams';
import { addPilot, createWorld, random, spawnPlane, stepWorld, type BotDifficulty, type WorldContext, type WorldState } from './world';

export { TEAM_SIZE };

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
  /** Bot planes and team BR totals from the last balance. */
  lineup: BotLineup | null;
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
  /** Fill empty seats with bots (default true). */
  bots?: boolean;
  /** Spawn points for humans' respawns (default true). */
  spawnRules?: boolean;
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
  world.spawnRules = opts.spawnRules ?? true;
  const match: Match = { world, brains: [], playerId: opts.humans[0]?.id ?? PLAYER_ID, era: opts.era, difficulty: opts.difficulty, nextBot: 0, lineup: null };
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
  if (opts.bots ?? true) {
    const lineup = lineupFor(match, ctx, { blue: TEAM_SIZE - counts.blue, red: TEAM_SIZE - counts.red });
    for (const team of ['blue', 'red'] as Team[]) for (const planeId of lineup[team]) addBot(match, ctx, team, planeId);
    match.lineup = lineup;
  }
  world.events = [];
  return match;
}

/** Bot planes that even out both teams' total BR, given the humans' planes (teams.ts). */
function lineupFor(match: Match, ctx: WorldContext, slots: Record<Team, number>): BotLineup {
  const w = match.world;
  const humans = w.planes.filter((p) => !w.pilots[p.id]?.bot).map((p) => ({ team: p.team, br: ctx.planeDefs.get(p.planeId)?.br ?? 1 }));
  const era = ctx.data.planes.filter((p) => p.era === match.era);
  return balanceBots(era, humans, slots, () => random(w));
}

function addBot(match: Match, ctx: WorldContext, team: Team, planeId: string): string {
  const id = `b${++match.nextBot}`;
  addPilot(match.world, { id, name: CALLSIGNS[(match.nextBot - 1) % CALLSIGNS.length]!, team, bot: true });
  spawnPlane(match.world, ctx, { id, team, planeId });
  match.brains.push(createBrain(id, match.difficulty));
  return id;
}

/**
 * After someone joins or a bot takes over, pick new bot planes so the teams stay balanced. Bots switch at
 * their next respawn (nobody is yanked out of the air). Returns the new lineup.
 */
export function rebalanceBots(match: Match, ctx: WorldContext): BotLineup | null {
  const w = match.world;
  const bots: Record<Team, string[]> = { blue: [], red: [] };
  for (const p of w.planes) if (w.pilots[p.id]?.bot) bots[p.team].push(p.id);
  if (bots.blue.length + bots.red.length === 0) return null;
  // Humans flying now count with their current plane; bots are re-picked.
  const humans = w.planes.filter((p) => !w.pilots[p.id]?.bot).map((p) => ({ team: p.team, br: ctx.planeDefs.get(w.respawnPlane[p.id] ?? p.planeId)?.br ?? 1 }));
  const era = ctx.data.planes.filter((p) => p.era === match.era);
  const lineup = balanceBots(era, humans, { blue: bots.blue.length, red: bots.red.length }, () => random(w));
  for (const team of ['blue', 'red'] as Team[]) bots[team].forEach((id, i) => (w.respawnPlane[id] = lineup[team][i]!));
  match.lineup = lineup;
  return lineup;
}

/** Join in progress: the newcomer takes a bot's slot on the team with fewer humans. Returns their team, or null if full. */
export function addHumanToMatch(match: Match, ctx: WorldContext, human: HumanSlot): Team | null {
  const w = match.world;
  const humans = (team: Team): number => w.planes.filter((p) => p.team === team && !w.pilots[p.id]?.bot).length;
  const order: Team[] = humans('blue') <= humans('red') ? ['blue', 'red'] : ['red', 'blue'];
  const size = (team: Team): number => w.planes.filter((p) => p.team === team).length;
  for (const team of order) {
    const bot = w.planes.find((p) => p.team === team && w.pilots[p.id]?.bot);
    if (!bot) {
      // Bots off: just add a seat if the team has room.
      if (size(team) >= TEAM_SIZE) continue;
      addPilot(w, { id: human.id, name: human.name, team, bot: false });
      spawnPlane(w, ctx, { id: human.id, team, planeId: human.planeId, assist: human.assist ?? 0 });
      return team;
    }
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
