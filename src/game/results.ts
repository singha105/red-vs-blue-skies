// End of match: RP earned (the GAME_DESIGN formula) and awards. The host computes this once and sends it to
// everyone, so every screen shows the same numbers. Day 8 saves the RP to each player's profile.
import type { Team } from './flight';
import type { WorldState } from './world';

export type AwardId = 'mvp' | 'ace' | 'wingman' | 'survivor';

export const AWARDS: Record<AwardId, { name: string; why: string }> = {
  mvp: { name: 'MVP', why: 'Top score' },
  ace: { name: 'Ace', why: '5+ kills in one life' },
  wingman: { name: 'Wingman', why: 'Most assists' },
  survivor: { name: 'Survivor', why: 'Fewest deaths' },
};

export const RP_ASSIST = 40;
export const RP_SURVIVE = 30;
export const RP_WIN_BONUS = 0.25;
export const RP_MVP_BONUS = 0.2;
export const RP_MINIMUM = 50;

export interface ResultRow {
  id: string;
  name: string;
  team: Team;
  bot: boolean;
  planeId: string;
  kills: number;
  deaths: number;
  assists: number;
  /** Damage dealt, in percent of a plane's HP (summed over victims). */
  damagePct: number;
  /** Score before the win and MVP bonuses; MVP is the top score. */
  score: number;
  /** Research points earned (humans only; bots show 0). */
  rp: number;
  awards: AwardId[];
}

export interface MatchResults {
  winner: Team | 'draw' | null;
  score: Record<Team, number>;
  rows: ResultRow[];
  /** Total Battle Rating per team at the start (network matches). */
  br: Record<Team, number> | null;
}

/** Best by `key` (higher wins) with tie-breaks; null when nobody qualifies. */
function best(rows: ResultRow[], keys: ((r: ResultRow) => number)[], qualifies: (r: ResultRow) => boolean = () => true): ResultRow | null {
  const pool = rows.filter(qualifies);
  pool.sort((a, b) => {
    for (const k of keys) {
      const d = k(b) - k(a);
      if (d !== 0) return d;
    }
    return a.id < b.id ? -1 : 1;
  });
  return pool[0] ?? null;
}

export function computeResults(world: WorldState, br: Record<Team, number> | null = null): MatchResults {
  const m = world.match;
  const bestLife = (id: string): number => world.stats[id]?.bestLifeKills ?? 0;
  const rows: ResultRow[] = Object.values(world.pilots).map((p) => {
    const st = world.stats[p.id];
    const plane = world.planes.find((x) => x.id === p.id);
    const kills = st?.kills ?? 0;
    const assists = st?.assists ?? 0;
    const damagePct = Math.round(st?.damagePct ?? 0);
    const survived = plane?.alive ?? false;
    const score = Math.round((st?.killRp ?? 0) + RP_ASSIST * assists + damagePct + (survived ? RP_SURVIVE : 0));
    return {
      id: p.id,
      name: p.name,
      team: p.team,
      bot: p.bot,
      planeId: plane?.planeId ?? '',
      kills,
      deaths: st?.deaths ?? 0,
      assists,
      damagePct,
      score,
      rp: 0,
      awards: [],
    };
  });

  // Awards need something to show for it: nobody is MVP or Survivor of a match where nothing happened.
  const active = (r: ResultRow): boolean => r.kills + r.assists + r.damagePct > 0;
  const mvp = best(rows, [(r) => r.score, (r) => r.kills], active);
  const wingman = best(rows, [(r) => r.assists, (r) => r.damagePct], (r) => r.assists > 0);
  const survivor = best(rows, [(r) => -r.deaths, (r) => r.kills, (r) => r.damagePct], active);
  for (const r of rows) {
    if (r === mvp) r.awards.push('mvp');
    if (bestLife(r.id) >= 5) r.awards.push('ace');
    if (r === wingman) r.awards.push('wingman');
    if (r === survivor) r.awards.push('survivor');
    if (!r.bot) {
      const won = m.winner === r.team;
      const total = r.score * (1 + (won ? RP_WIN_BONUS : 0) + (r === mvp ? RP_MVP_BONUS : 0));
      r.rp = Math.max(RP_MINIMUM, Math.round(total));
    }
  }
  rows.sort((a, b) => (a.team === b.team ? b.score - a.score || b.kills - a.kills : a.team === 'blue' ? -1 : 1));
  return { winner: m.winner, score: { ...m.score }, rows, br };
}
