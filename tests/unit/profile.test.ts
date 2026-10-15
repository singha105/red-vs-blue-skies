// Day 8: unlock rules, profile data checks, the offline queue and the leaderboard ranking (pure logic; the
// Firestore rules have their own emulator tests in tests/rules).
import { describe, expect, it } from 'vitest';
import { canUnlock, cleanUnlocks, earnedRp, freshUnlocks, isUnlocked, spentRp, unlockCost } from '../../src/game/unlocks';
import type { ResultRow } from '../../src/game/results';
import {
  applyResult,
  cleanProfile,
  cleanQueue,
  enqueue,
  makeMatchId,
  mergeFriends,
  newProfile,
  pendingRp,
  rankBoard,
  resultFromRow,
  RP_CAP,
  type LeaderRow,
  type PendingResult,
} from '../../src/profile/model';
import { loadGameData } from '../../src/data';

const loaded = loadGameData();
if (!loaded.ok) throw new Error('data');
const data = loaded.data;

const row = (over: Partial<ResultRow> = {}): ResultRow => ({
  id: 'h1',
  name: 'Maverick',
  team: 'blue',
  bot: false,
  planeId: 'spitfire_mk5',
  captures: 0,
  groundKills: 0,
  kills: 4,
  deaths: 1,
  assists: 2,
  damagePct: 320,
  score: 800,
  rp: 1038,
  awards: [],
  ...over,
});

describe('unlock trees', () => {
  it('costs 200 × tier, tier 1 free; a full era is 10,800 RP', () => {
    expect(unlockCost(1)).toBe(0);
    expect(unlockCost(2)).toBe(400);
    expect(unlockCost(10)).toBe(2000);
    const all = { ...freshUnlocks(), ww1: 10 };
    expect(spentRp(all)).toBe(10_800);
    expect(earnedRp(500, all)).toBe(11_300);
  });

  it('tiers unlock in order with enough RP', () => {
    const u = freshUnlocks();
    expect(canUnlock(10_000, u, 'modern', 1)).toBe('owned');
    expect(canUnlock(10_000, u, 'modern', 3)).toBe('order');
    expect(canUnlock(399, u, 'modern', 2)).toBe('rp');
    expect(canUnlock(400, u, 'modern', 2)).toBe('ok');
  });

  it('a new player flies only tier 1 of each era; "all" opens everything', () => {
    const u = freshUnlocks();
    for (const p of data.planes) {
      expect(isUnlocked(p, u)).toBe(p.tier === 1);
      expect(isUnlocked(p, 'all')).toBe(true);
    }
  });

  it('cleans untrusted unlock maps', () => {
    expect(cleanUnlocks({ ww1: 99, modern: -3, cold_war: 4.7, atlantis: 5 })).toEqual({ ...freshUnlocks(), ww1: 10, modern: 1, cold_war: 4 });
    expect(cleanUnlocks('nope')).toEqual(freshUnlocks());
  });
});

describe('profiles and results', () => {
  it('a result row becomes a saved result, RP capped at 3,000 like the rules', () => {
    expect(resultFromRow(row(), 'blue')).toEqual({ rp: 1038, kills: 4, deaths: 1, assists: 2, won: true });
    expect(resultFromRow(row({ rp: 9000 }), 'red')).toMatchObject({ rp: RP_CAP, won: false });
    expect(resultFromRow(row(), 'draw').won).toBe(false);
  });

  it('applying a result adds RP and stats the way the rules check them', () => {
    const p = applyResult(newProfile('Maverick'), resultFromRow(row(), 'blue'), ['uB']);
    expect(p.rp).toBe(1038);
    expect(p.stats).toEqual({ kills: 4, deaths: 1, assists: 2, matches: 1, wins: 1 });
    expect(p.friends).toEqual(['uB']);
  });

  it('cleans profiles from storage or Firestore', () => {
    const p = cleanProfile({ callsign: '<b>Ice</b>man the great pilot', rp: -5, unlocked: { ww1: 3 }, stats: { kills: 'x', wins: 2 }, friends: ['a', 7, 'b'] });
    expect(p.callsign).toBe('bIce/bman the gr'); // no markup characters, 16 max
    expect(p.rp).toBe(0);
    expect(p.unlocked.ww1).toBe(3);
    expect(p.stats).toEqual({ kills: 0, deaths: 0, assists: 0, matches: 0, wins: 2 });
    expect(p.friends).toEqual(['a', 'b']);
  });

  it('friends: recent match-mates first, never yourself, at most 50', () => {
    expect(mergeFriends(['a', 'b'], ['me', 'c', 'a'], 'me')).toEqual(['c', 'a', 'b']);
    const many = Array.from({ length: 80 }, (_, i) => `u${i}`);
    expect(mergeFriends(many, [], 'me')).toHaveLength(50);
  });
});

describe('offline queue', () => {
  const entry = (matchId: string, rp: number, uid: string | null = 'u1'): PendingResult => ({
    matchId,
    uid,
    solo: false,
    participants: [],
    result: { rp, kills: 1, deaths: 0, assists: 0, won: false },
    at: 1000,
  });

  it('queues a match once and survives a round trip through localStorage', () => {
    let q = enqueue([], entry('m-aaaa', 300));
    q = enqueue(q, entry('m-aaaa', 300));
    q = enqueue(q, entry('m-bbbb', 200, null));
    expect(q).toHaveLength(2);
    expect(cleanQueue(JSON.parse(JSON.stringify(q)))).toEqual(q);
    expect(pendingRp(q, 'u1')).toBe(500);
    expect(pendingRp(q, 'other')).toBe(200); // only the account-less solo result follows a new account
  });

  it('drops junk and caps forged RP in stored entries', () => {
    const q = cleanQueue([null, { matchId: '../x' }, { ...entry('m-cccc', 0), result: { rp: 1e9 } }]);
    expect(q).toHaveLength(1);
    expect(q[0]!.result.rp).toBe(RP_CAP);
  });

  it('match ids are Firestore-safe and unique', () => {
    const ids = new Set(Array.from({ length: 500 }, () => makeMatchId('s')));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^s-[a-z0-9]+-[a-z0-9]{8}$/);
  });
});

describe('friends leaderboard', () => {
  const lr = (uid: string, rp: number, kills: number, deaths: number, unlocked = freshUnlocks()): LeaderRow => ({
    uid,
    callsign: uid,
    rp,
    unlocked,
    stats: { kills, deaths, assists: 0, matches: 3, wins: 1 },
  });
  const rows = [lr('a', 100, 10, 10), lr('b', 900, 5, 0), lr('c', 0, 30, 20, { ...freshUnlocks(), modern: 5 })];

  it('ranks by RP earned (spent included), kills and K/D', () => {
    expect(rankBoard(rows, 'rp').map((r) => r.uid)).toEqual(['c', 'b', 'a']); // c spent 2,800
    expect(rankBoard(rows, 'kills').map((r) => r.uid)).toEqual(['c', 'a', 'b']);
    expect(rankBoard(rows, 'kd').map((r) => r.uid)).toEqual(['b', 'c', 'a']); // 5/1, 1.5, 1
  });
});
