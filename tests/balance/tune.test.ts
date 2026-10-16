// Balance tuner (npm run balance -- tune): for each era in $ERAS, rounds of the bot tournament, nudging every
// plane's game stats (HP, and turn rate at half the strength) until each adjacent pair sits near 62.5% for
// the higher tier. Real figures (speed, guns, missiles) are never touched. Writes
// tests/balance/out/tune-<era>.json with the new stats; tools/balance.mjs writes them into planes.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { loadGameData, type GameData, type Plane } from '../../src/data';
import { eraTournament, type PairResult } from './tournament';

const result = loadGameData();
if (!result.ok) throw new Error('data invalid');
const base = result.data;
const eras = (process.env['ERAS'] ?? base.eras.map((e) => e.id).join(',')).split(',');
const duels = Number(process.env['DUELS'] ?? 120);
const rounds = Number(process.env['ROUNDS'] ?? 8);
const out = new URL('./out/', import.meta.url);

/** Aim a little above the middle of 60–65%: a 200-duel run has ±3.5% noise and the floor is 55%. */
const TARGET = Number(process.env['TARGET'] ?? 0.64);
const logit = (p: number): number => Math.log(p / (1 - p));
/** Win-odds change (logit) per unit of log stat multiplier; a first guess, corrected by the rounds. */
const SENSITIVITY = 4;
const GAIN = Number(process.env['GAIN'] ?? 0.7);
/** Most a plane's stats may move in one tuning run (log units: 0.7 ≈ ×2 HP, ×1.42 turn rate). */
const LIMIT = Number(process.env['LIMIT'] ?? 0.7);
/** Pairs already inside this band are left alone (chasing noise only shakes the others). */
const DEAD_BAND: [number, number] = [0.62, 0.7];

export interface TunedStats {
  id: string;
  hp: number;
  turnRateDegS: number;
}

function applyStats(data: GameData, originals: Plane[], a: number[]): { data: GameData; stats: TunedStats[] } {
  const planes = structuredClone(data.planes);
  const stats: TunedStats[] = originals.map((p, j) => {
    const m = Math.exp(a[j]!);
    const hp = Math.max(20, Math.min(300, Math.round(p.stats.hp * m)));
    const turnRateDegS = Math.max(5, Math.min(60, Math.round(p.stats.turnRateDegS * Math.sqrt(m) * 2) / 2));
    const plane = planes.find((x) => x.id === p.id)!;
    plane.stats = { ...plane.stats, hp, turnRateDegS };
    return { id: p.id, hp, turnRateDegS };
  });
  return { data: { ...data, planes }, stats };
}

for (const era of eras) {
  it(`tune ${era}`, () => {
    const originals = base.planes.filter((p) => p.era === era).sort((x, y) => x.tier - y.tier);
    let a = originals.map(() => 0);
    const history: { round: number; rates: number[]; stats: TunedStats[] }[] = [];
    let best: { score: number; stats: TunedStats[]; pairs: PairResult[] } | null = null;
    for (let round = 0; round < rounds; round++) {
      const { data, stats } = applyStats(base, originals, a);
      // A different seed each round, so the tuning doesn't fit one set of starts.
      const pairs = eraTournament(data, era, duels, 1000 + round * 31);
      const rates = pairs.map((p) => p.higherRate);
      history.push({ round, rates, stats });
      process.stdout.write(`\n${era} round ${round}: ${rates.map((r) => (r * 100).toFixed(0)).join(' ')}`);
      // Score: the worst distance from the 61–72% band (0 when every pair is inside it).
      const score = Math.max(...rates.map((r) => (r < 0.61 ? 0.61 - r : r > 0.72 ? r - 0.72 : 0)));
      if (!best || score < best.score) best = { score, stats, pairs };
      if (score === 0) break;
      // Each pair's gap in log-stat units; shift every plane by the sum of the gaps below it, then re-centre.
      const gaps = rates.map((r) => (r >= DEAD_BAND[0] && r <= DEAD_BAND[1] ? 0 : (GAIN * (logit(TARGET) - logit(Math.min(0.97, Math.max(0.03, r))))) / SENSITIVITY));
      const next = a.map((v, j) => v + gaps.slice(0, j).reduce((s, g) => s + g, 0));
      const mean = next.reduce((s, v) => s + v, 0) / next.length;
      a = next.map((v) => Math.max(-LIMIT, Math.min(LIMIT, v - mean)));
    }
    mkdirSync(out, { recursive: true });
    writeFileSync(new URL(`tune-${era}.json`, out), JSON.stringify({ era, duels, best, history }, null, 1));
  }, 3_600_000);
}
