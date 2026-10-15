// Team balancing. Humans are split evenly (by headcount, then research points) with parties kept together;
// then bots pick planes so both teams' total Battle Rating ends up within 10%. Bots are the only lever:
// humans always fly what they picked.
import type { Plane } from '../data/types';
import type { Team } from './flight';

export const TEAM_SIZE = 10;
/** Teams count as balanced when |blue − red| ≤ 10% of the larger total. */
export const BR_TOLERANCE = 0.1;

export interface TeamCandidate {
  id: string;
  rp: number;
  /** Players with the same party id stay on the same team (up to 3). */
  party: string | null;
}

/** Humans → teams. Counts differ by at most one where parties allow it; ties go to the team with less RP. */
export function splitTeams(players: readonly TeamCandidate[]): Record<string, Team> {
  const groups = new Map<string, TeamCandidate[]>();
  for (const p of players) {
    const key = p.party ?? `solo:${p.id}`;
    const g = groups.get(key) ?? [];
    g.push(p);
    groups.set(key, g);
  }
  const rpOf = (g: TeamCandidate[]): number => g.reduce((s, p) => s + p.rp, 0);
  const ordered = [...groups.entries()].sort(([ka, a], [kb, b]) => b.length - a.length || rpOf(b) - rpOf(a) || (ka < kb ? -1 : 1));
  const out: Record<string, Team> = {};
  const size: Record<Team, number> = { blue: 0, red: 0 };
  const rp: Record<Team, number> = { blue: 0, red: 0 };
  for (const [, g] of ordered) {
    let team: Team = size.blue < size.red ? 'blue' : size.red < size.blue ? 'red' : rp.blue <= rp.red ? 'blue' : 'red';
    if (size[team] + g.length > TEAM_SIZE) team = team === 'blue' ? 'red' : 'blue';
    for (const p of g) out[p.id] = team;
    size[team] += g.length;
    rp[team] += rpOf(g);
  }

  // Fix-ups with solo players only (parties never split): even out the headcount, then the RP.
  const solos = players.filter((p) => !p.party);
  const move = (p: TeamCandidate, to: Team): void => {
    const from = out[p.id]!;
    out[p.id] = to;
    size[from]--;
    size[to]++;
    rp[from] -= p.rp;
    rp[to] += p.rp;
  };
  for (let guard = 0; guard < 20 && Math.abs(size.blue - size.red) > 1; guard++) {
    const big: Team = size.blue > size.red ? 'blue' : 'red';
    const small: Team = big === 'blue' ? 'red' : 'blue';
    const candidate = solos.filter((p) => out[p.id] === big).sort((a, b) => a.rp - b.rp)[0];
    if (!candidate) break;
    move(candidate, small);
  }
  for (let guard = 0; guard < 50; guard++) {
    const diff = rp.blue - rp.red;
    let best: [TeamCandidate, TeamCandidate] | null = null;
    let bestDiff = Math.abs(diff);
    for (const a of solos) {
      if (out[a.id] !== 'blue') continue;
      for (const b of solos) {
        if (out[b.id] !== 'red') continue;
        const d = Math.abs(diff - 2 * (a.rp - b.rp));
        if (d < bestDiff - 1e-9) {
          bestDiff = d;
          best = [a, b];
        }
      }
    }
    if (!best) break;
    move(best[0], 'red');
    move(best[1], 'blue');
  }
  return out;
}

export interface BotLineup {
  blue: string[];
  red: string[];
  /** Team totals including humans. */
  br: Record<Team, number>;
  balanced: boolean;
}

export const brGap = (br: Record<Team, number>): number => {
  const top = Math.max(br.blue, br.red);
  return top > 0 ? Math.abs(br.blue - br.red) / top : 0;
};

/**
 * Picks bot planes from the era so the two teams' total BR end up close (aiming for 3%, must be ≤ 10%).
 * Bots start near the humans' median tier with a little variety, then the weaker team's bots step up a tier
 * or the stronger team's step down, one at a time, while that narrows the gap.
 */
export function balanceBots(
  eraPlanes: readonly Plane[],
  humans: readonly { team: Team; br: number }[],
  botSlots: Record<Team, number>,
  random: () => number,
): BotLineup {
  const ladder = [...eraPlanes].sort((a, b) => a.tier - b.tier);
  if (ladder.length === 0) throw new Error('balanceBots: no planes');
  const humanBr: Record<Team, number> = { blue: 0, red: 0 };
  for (const h of humans) humanBr[h.team] += h.br;
  const brs = humans.map((h) => h.br).sort((a, b) => a - b);
  const medianBr = brs.length ? brs[Math.floor(brs.length / 2)]! : ladder[Math.floor(ladder.length / 2)]!.br;
  let centre = 0;
  for (let i = 1; i < ladder.length; i++) if (Math.abs(ladder[i]!.br - medianBr) < Math.abs(ladder[centre]!.br - medianBr)) centre = i;
  const clampIdx = (i: number): number => Math.max(0, Math.min(ladder.length - 1, i));

  // Indexes into the ladder, per team.
  const bots: Record<Team, number[]> = { blue: [], red: [] };
  for (const team of ['blue', 'red'] as Team[]) {
    for (let i = 0; i < botSlots[team]; i++) bots[team].push(clampIdx(centre + Math.floor(random() * 3) - 1));
  }
  const total = (team: Team): number => humanBr[team] + bots[team].reduce((s, i) => s + ladder[i]!.br, 0);

  for (let guard = 0; guard < 400; guard++) {
    const br = { blue: total('blue'), red: total('red') };
    if (brGap(br) <= 0.03) break;
    const low: Team = br.blue < br.red ? 'blue' : 'red';
    const high: Team = low === 'blue' ? 'red' : 'blue';
    const gap = Math.abs(br.blue - br.red);
    // Candidate moves: raise the weakest bot on the low team, or lower the strongest on the high team.
    const moves: { team: Team; slot: number; to: number; newGap: number }[] = [];
    const lowSlots = bots[low].map((idx, slot) => ({ idx, slot })).sort((a, b) => a.idx - b.idx);
    const highSlots = bots[high].map((idx, slot) => ({ idx, slot })).sort((a, b) => b.idx - a.idx);
    const up = lowSlots.find((s) => s.idx < ladder.length - 1);
    if (up) moves.push({ team: low, slot: up.slot, to: up.idx + 1, newGap: Math.abs(gap - (ladder[up.idx + 1]!.br - ladder[up.idx]!.br)) });
    const down = highSlots.find((s) => s.idx > 0);
    if (down) moves.push({ team: high, slot: down.slot, to: down.idx - 1, newGap: Math.abs(gap - (ladder[down.idx]!.br - ladder[down.idx - 1]!.br)) });
    moves.sort((a, b) => a.newGap - b.newGap);
    const m = moves[0];
    if (!m || m.newGap >= gap - 1e-9) break;
    bots[m.team][m.slot] = m.to;
  }
  const br = { blue: round1(total('blue')), red: round1(total('red')) };
  return {
    blue: bots.blue.map((i) => ladder[i]!.id),
    red: bots.red.map((i) => ladder[i]!.id),
    br,
    balanced: brGap(br) <= BR_TOLERANCE,
  };
}

const round1 = (x: number): number => Math.round(x * 10) / 10;
