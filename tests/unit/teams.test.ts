import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/data';
import type { GameData, Plane } from '../../src/data/types';
import type { Team } from '../../src/game/flight';
import { createMatch } from '../../src/game/match';
import { computeResults } from '../../src/game/results';
import { balanceBots, brGap, splitTeams, TEAM_SIZE, type TeamCandidate } from '../../src/game/teams';
import { spawnCost } from '../../src/game/unlocks';
import { addPilot, applyDamage, createWorld, createWorldContext, spawnPlane, stepWorld, underdogMultiplier } from '../../src/game/world';

const result = loadGameData();
if (!result.ok) throw new Error('data invalid');
const data: GameData = result.data;
const ctx = createWorldContext(data, 'island_chain');
const era = (id: string): Plane[] => data.planes.filter((p) => p.era === id);
const byTier = (eraId: string, tier: number): Plane => era(eraId).find((p) => p.tier === tier)!;

/** Small deterministic RNG for the fuzz tests. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('splitTeams', () => {
  it('splits humans evenly and evens out research points', () => {
    const players: TeamCandidate[] = [5000, 4000, 3000, 2000, 1000, 500].map((rp, i) => ({ id: `p${i}`, rp, party: null }));
    const t = splitTeams(players);
    const size = (team: Team) => players.filter((p) => t[p.id] === team).length;
    const rp = (team: Team) => players.filter((p) => t[p.id] === team).reduce((s, p) => s + p.rp, 0);
    expect(size('blue')).toBe(3);
    expect(size('red')).toBe(3);
    // 15,500 total: the best split is 7,500 vs 8,000.
    expect(Math.abs(rp('blue') - rp('red'))).toBeLessThanOrEqual(500);
  });

  it('keeps parties together (up to 3) and stays within one player of even', () => {
    const players: TeamCandidate[] = [
      { id: 'a', rp: 100, party: 'x' },
      { id: 'b', rp: 100, party: 'x' },
      { id: 'c', rp: 100, party: 'x' },
      { id: 'd', rp: 100, party: 'y' },
      { id: 'e', rp: 100, party: 'y' },
      { id: 'f', rp: 100, party: null },
      { id: 'g', rp: 100, party: null },
    ];
    const t = splitTeams(players);
    expect(new Set(['a', 'b', 'c'].map((id) => t[id])).size).toBe(1);
    expect(new Set(['d', 'e'].map((id) => t[id])).size).toBe(1);
    const blue = players.filter((p) => t[p.id] === 'blue').length;
    expect(Math.abs(blue - (players.length - blue))).toBeLessThanOrEqual(1);
  });

  it('never puts more than 10 on a team', () => {
    const players: TeamCandidate[] = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, rp: i * 10, party: i < 6 ? `party${Math.floor(i / 3)}` : null }));
    const t = splitTeams(players);
    expect(players.filter((p) => t[p.id] === 'blue').length).toBe(TEAM_SIZE);
    expect(players.filter((p) => t[p.id] === 'red').length).toBe(TEAM_SIZE);
  });
});

describe('balanceBots', () => {
  it('the BUILD_PLAN example: blue 7.9 vs red 6.4 in humans ends within 10%', () => {
    const humans = [
      ...[7, 5, 3, 2].map((tier) => ({ team: 'blue' as Team, br: byTier('late_ww2', tier).br })),
      ...[4, 4, 3, 1].map((tier) => ({ team: 'red' as Team, br: byTier('late_ww2', tier).br })),
    ];
    expect(humans.filter((h) => h.team === 'blue').reduce((s, h) => s + h.br, 0)).toBeCloseTo(7.9);
    expect(humans.filter((h) => h.team === 'red').reduce((s, h) => s + h.br, 0)).toBeCloseTo(6.4);
    const lineup = balanceBots(era('late_ww2'), humans, { blue: 6, red: 6 }, rng(1));
    expect(lineup.blue).toHaveLength(6);
    expect(lineup.red).toHaveLength(6);
    expect(lineup.balanced).toBe(true);
    expect(brGap(lineup.br)).toBeLessThanOrEqual(0.1);
    // Every bot flies a plane from the era.
    for (const id of [...lineup.blue, ...lineup.red]) expect(era('late_ww2').some((p) => p.id === id)).toBe(true);
  });

  it('balances 500 random lobbies (0–4 humans a side, any tiers, every era) within 10%', () => {
    const r = rng(7);
    let worst = 0;
    for (let i = 0; i < 500; i++) {
      const e = data.eras[i % data.eras.length]!.id;
      const humans: { team: Team; br: number }[] = [];
      const counts = { blue: Math.floor(r() * 5), red: Math.floor(r() * 5) };
      for (const team of ['blue', 'red'] as Team[]) {
        for (let k = 0; k < counts[team]; k++) humans.push({ team, br: byTier(e, 1 + Math.floor(r() * 10)).br });
      }
      const lineup = balanceBots(era(e), humans, { blue: TEAM_SIZE - counts.blue, red: TEAM_SIZE - counts.red }, r);
      worst = Math.max(worst, brGap(lineup.br));
      expect(lineup.balanced, `lobby ${i}: ${JSON.stringify(lineup.br)}`).toBe(true);
    }
    expect(worst).toBeLessThanOrEqual(0.1);
  });

  it('createMatch fields the balanced bots: actual team BR within 10%', () => {
    const m = createMatch(ctx, {
      era: 'early_ww2',
      difficulty: 'normal',
      humans: [
        { id: 'h1', name: 'A', planeId: byTier('early_ww2', 10).id, team: 'blue' },
        { id: 'h2', name: 'B', planeId: byTier('early_ww2', 9).id, team: 'blue' },
        { id: 'h3', name: 'C', planeId: byTier('early_ww2', 1).id, team: 'red' },
      ],
      seed: 5,
    });
    const total = (team: Team) => m.world.planes.filter((p) => p.team === team).reduce((s, p) => s + ctx.planeDefs.get(p.planeId)!.br, 0);
    expect(m.world.planes).toHaveLength(20);
    expect(brGap({ blue: total('blue'), red: total('red') })).toBeLessThanOrEqual(0.1);
    expect(m.lineup?.balanced).toBe(true);
  });
});

describe('spawn points', () => {
  const setup = () => {
    const w = createWorld(ctx, 3);
    w.spawnRules = true;
    addPilot(w, { id: 'me', name: 'Me', team: 'blue', bot: false });
    addPilot(w, { id: 'foe', name: 'Foe', team: 'red', bot: false });
    const me = spawnPlane(w, ctx, { id: 'me', team: 'blue', planeId: byTier('early_ww2', 3).id });
    const foe = spawnPlane(w, ctx, { id: 'foe', team: 'red', planeId: byTier('early_ww2', 3).id });
    me.protectedFor = 0;
    foe.protectedFor = 0;
    return { w, me, foe };
  };
  const respawn = (w: ReturnType<typeof setup>['w']) => {
    for (let i = 0; i < 6 * 60; i++) stepWorld(w, ctx, {}, 1 / 60);
  };

  it('a kill earns 100 SP and an assist 40', () => {
    const { w, me, foe } = setup();
    addPilot(w, { id: 'wing', name: 'Wing', team: 'blue', bot: false });
    applyDamage(w, foe, 'wing', foe.maxHp * 0.4, 'fuselage', 'test');
    applyDamage(w, foe, 'me', foe.maxHp, 'fuselage', 'test');
    expect(w.stats['me']!.sp).toBe(100);
    expect(w.stats['wing']!.sp).toBe(40);
    void me;
  });

  it('later spawns cost 100 + 50 × tier; with too few SP you get the free tier-1 reserve', () => {
    const { w, me } = setup();
    const tier3 = byTier('early_ww2', 3);
    // Shot down with no SP: the reserve plane.
    applyDamage(w, me, 'foe', me.maxHp, 'fuselage', 'test');
    respawn(w);
    let mine = w.planes.find((p) => p.id === 'me')!;
    expect(mine.alive).toBe(true);
    expect(mine.planeId).toBe(byTier('early_ww2', 1).id);
    // Earn enough for the tier-3 plane and pick it on the respawn screen.
    w.stats['me']!.sp = spawnCost(3) + 20;
    w.respawnPlane['me'] = tier3.id;
    mine.protectedFor = 0;
    applyDamage(w, mine, 'foe', mine.maxHp, 'fuselage', 'test');
    respawn(w);
    mine = w.planes.find((p) => p.id === 'me')!;
    expect(mine.planeId).toBe(tier3.id);
    expect(w.stats['me']!.sp).toBe(20);
  });
});

describe('research points and awards', () => {
  it('underdog multiplier follows GAME_DESIGN', () => {
    expect(underdogMultiplier(3, 6)).toBe(3);
    expect(underdogMultiplier(3, 5)).toBe(2);
    expect(underdogMultiplier(3, 4)).toBe(1);
    expect(underdogMultiplier(3, 2)).toBe(1);
    expect(underdogMultiplier(5, 3)).toBe(0.5);
    expect(underdogMultiplier(6, 3)).toBe(0.25);
  });

  it('reproduces the GAME_DESIGN worked example (1,038 RP) and hands out awards', () => {
    const w = createWorld(ctx, 1);
    addPilot(w, { id: 'me', name: 'Me', team: 'blue', bot: false });
    addPilot(w, { id: 'ace', name: 'Ace', team: 'red', bot: true });
    addPilot(w, { id: 'wing', name: 'Wing', team: 'red', bot: true });
    for (const [id, team] of [['me', 'blue'], ['ace', 'red'], ['wing', 'red']] as const) spawnPlane(w, ctx, { id, team, planeId: byTier('early_ww2', 3).id });
    // 2 kills on tier-5s (×2) + 1 on a tier-3: 500 kill RP; 1 assist; 260% damage; alive at the end.
    Object.assign(w.stats['me']!, { kills: 3, assists: 1, damagePct: 260, killRp: 500, deaths: 0 });
    Object.assign(w.stats['ace']!, { kills: 6, bestLifeKills: 5, killRp: 100, deaths: 4 });
    Object.assign(w.stats['wing']!, { assists: 6, deaths: 2 });
    w.match = { mode: 'tdm', timeLeftS: 0, killLimit: 50, score: { blue: 10, red: 5 }, state: 'ended', winner: 'blue' };
    const r = computeResults(w);
    const me = r.rows.find((x) => x.id === 'me')!;
    // Subtotal 830; +25% team win; MVP (top score) +20% too.
    expect(me.score).toBe(830);
    expect(me.rp).toBe(Math.round(830 * 1.45));
    expect(me.awards).toContain('mvp');
    expect(me.awards).toContain('survivor');
    expect(r.rows.find((x) => x.id === 'ace')!.awards).toContain('ace');
    expect(r.rows.find((x) => x.id === 'wing')!.awards).toContain('wingman');
    expect(r.rows.find((x) => x.id === 'ace')!.rp).toBe(0); // bots don't earn RP
  });

  it('without MVP the worked example is exactly 1,038, and a quiet match still pays 50', () => {
    const w = createWorld(ctx, 1);
    addPilot(w, { id: 'me', name: 'Me', team: 'blue', bot: false });
    addPilot(w, { id: 'top', name: 'Top', team: 'red', bot: false });
    addPilot(w, { id: 'idle', name: 'Idle', team: 'red', bot: false });
    for (const [id, team] of [['me', 'blue'], ['top', 'red'], ['idle', 'red']] as const) spawnPlane(w, ctx, { id, team, planeId: byTier('early_ww2', 3).id });
    Object.assign(w.stats['me']!, { kills: 3, assists: 1, damagePct: 260, killRp: 500 });
    Object.assign(w.stats['top']!, { kills: 9, killRp: 900 });
    w.planes.find((p) => p.id === 'idle')!.alive = false;
    w.match = { mode: 'tdm', timeLeftS: 0, killLimit: 50, score: { blue: 3, red: 9 }, state: 'ended', winner: 'blue' };
    const r = computeResults(w);
    expect(r.rows.find((x) => x.id === 'me')!.rp).toBe(1038);
    expect(r.rows.find((x) => x.id === 'idle')!.rp).toBe(50);
  });
});
