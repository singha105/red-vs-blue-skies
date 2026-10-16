// Bot tournament (Day 10): 1v1 bot duels between adjacent tiers of one era, headless and as fast as the CPU
// goes. Both bots fly the same difficulty, start 3 km apart roughly head-on over open ocean, and fight until
// one goes down (shot down or crashed) or 3 minutes run out (then whoever did more damage wins on points;
// no damage at all is a draw).
import type { GameData, Plane } from '../../src/data/types';
import { createBrain, botInput } from '../../src/game/bots';
import type { ControlInput } from '../../src/game/controls';
import { normalize, quatLookRotation, scale, type Vec3 } from '../../src/game/math';
import { addPilot, createWorld, createWorldContext, random, spawnPlane, stepWorld, type BotDifficulty, type WorldContext } from '../../src/game/world';

export const DUEL_MAP = 'carrier_strike';
const DT = 1 / 60;

export interface DuelOptions {
  seed: number;
  difficulty?: BotDifficulty;
  maxS?: number;
  /** Called after every step (probing). */
  onStep?: (w: ReturnType<typeof createWorld>, brains: ReturnType<typeof createBrain>[]) => void;
}

export type DuelResult = 'a' | 'b' | 'draw';

/** One duel between plane a and plane b. Seeded, so the same seed gives the same fight. */
export function runDuel(ctx: WorldContext, a: string, b: string, opts: DuelOptions, trace?: Record<string, unknown>): DuelResult {
  const w = createWorld(ctx, opts.seed);
  const difficulty = opts.difficulty ?? 'normal';
  const ids = ['a', 'b'] as const;
  const planes = [a, b];
  const brains = ids.map((id) => {
    const brain = createBrain(id, difficulty);
    brain.role = 'fighter';
    return brain;
  });
  // Random geometry: 1.5–2.5 km apart at 1,800–2,200 m, each on a random heading, so some duels start
  // head-on, some crossing and some with one plane behind the other. Pairs of duels share a seed with the
  // planes swapped (eraTournament), so neither plane gets the better start more often.
  const bearing = random(w) * Math.PI * 2;
  const dist = 1500 + random(w) * 1000;
  const headings = [random(w) * Math.PI * 2, random(w) * Math.PI * 2];
  const alts = [1800 + random(w) * 400, 1800 + random(w) * 400];
  ids.forEach((id, i) => {
    addPilot(w, { id, name: id.toUpperCase(), team: i === 0 ? 'blue' : 'red', bot: true });
    const p = spawnPlane(w, ctx, { id, team: i === 0 ? 'blue' : 'red', planeId: planes[i]! });
    const side = i === 0 ? -0.5 : 0.5;
    const pos: Vec3 = [Math.cos(bearing) * dist * side, alts[i]!, Math.sin(bearing) * dist * side];
    const heading = normalize([Math.sin(headings[i]!), 0, Math.cos(headings[i]!)]);
    const params = ctx.params.get(planes[i]!)!;
    p.pos = pos;
    p.quat = quatLookRotation(heading);
    p.vel = scale(heading, params.topSpeedMs * 0.75);
    p.protectedFor = 0;
  });
  const maxSteps = Math.round((opts.maxS ?? 180) / DT);
  const inputs: Record<string, ControlInput> = {};
  for (let step = 0; step < maxSteps; step++) {
    for (const brain of brains) inputs[brain.id] = botInput(w, ctx, brain, DT);
    stepWorld(w, ctx, inputs, DT);
    opts.onStep?.(w, brains);
    const aliveA = w.planes[0]!.alive;
    const aliveB = w.planes[1]!.alive;
    if (!aliveA || !aliveB) {
      if (trace) Object.assign(trace, { t: w.time, events: w.events.filter((e) => e.t === 'kill'), hpA: w.planes[0]!.hp, hpB: w.planes[1]!.hp, posA: w.planes[0]!.pos, posB: w.planes[1]!.pos });
      return aliveA ? 'a' : aliveB ? 'b' : 'draw';
    }
  }
  // Time's up: a points decision on the share of HP each took off the other; no damage either way is a draw.
  const [pa, pb] = [w.planes[0]!, w.planes[1]!];
  const dealtA = 1 - pb.hp / pb.maxHp;
  const dealtB = 1 - pa.hp / pa.maxHp;
  if (trace) Object.assign(trace, { t: w.time, timeout: true, hpA: pa.hp, hpB: pb.hp });
  return Math.abs(dealtA - dealtB) < 1e-6 ? 'draw' : dealtA > dealtB ? 'a' : 'b';
}

/** runDuel plus how it ended (for probing). */
export function runDuelTrace(ctx: WorldContext, a: string, b: string, opts: DuelOptions): Record<string, unknown> {
  const trace: Record<string, unknown> = {};
  trace['result'] = runDuel(ctx, a, b, opts, trace);
  return trace;
}

export interface PairResult {
  era: string;
  lower: string;
  higher: string;
  lowerTier: number;
  higherWins: number;
  lowerWins: number;
  draws: number;
  /** Higher tier's share of the decided duels (draws left out). */
  higherRate: number;
}

/** `n` duels for every adjacent tier pair of an era; the higher tier flies as "a" in half of them. */
export function eraTournament(data: GameData, era: string, n: number, seed0 = 1, difficulty: BotDifficulty = 'normal'): PairResult[] {
  const ctx = createWorldContext(data, DUEL_MAP);
  const planes = data.planes.filter((p) => p.era === era).sort((x, y) => x.tier - y.tier);
  const out: PairResult[] = [];
  for (let i = 0; i + 1 < planes.length; i++) {
    const lo: Plane = planes[i]!;
    const hi: Plane = planes[i + 1]!;
    let higherWins = 0;
    let lowerWins = 0;
    let draws = 0;
    for (let k = 0; k < n; k++) {
      // Duels 2j and 2j+1 fly the same start with the planes swapped.
      const hiFirst = k % 2 === 0;
      const r = runDuel(ctx, hiFirst ? hi.id : lo.id, hiFirst ? lo.id : hi.id, { seed: seed0 + (k >> 1) * 7919 + lo.tier * 104729, difficulty });
      if (r === 'draw') draws++;
      else if ((r === 'a') === hiFirst) higherWins++;
      else lowerWins++;
    }
    const decided = higherWins + lowerWins;
    out.push({ era, lower: lo.id, higher: hi.id, lowerTier: lo.tier, higherWins, lowerWins, draws, higherRate: decided ? higherWins / decided : 0.5 });
  }
  return out;
}
