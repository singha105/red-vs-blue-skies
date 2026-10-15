// Firestore security rules against the local emulator: `npm run test:rules` (starts the emulator itself).
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, increment, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

let env: RulesTestEnvironment;

const fresh = (callsign = 'Maverick') => ({
  callsign,
  rp: 0,
  unlocked: { ww1: 1, early_ww2: 1, late_ww2: 1, early_jets: 1, cold_war: 1, modern: 1 },
  stats: { kills: 0, deaths: 0, assists: 0, matches: 0, wins: 0 },
  friends: [] as string[],
  lastMatch: null,
  lastUnlock: null,
  createdAt: serverTimestamp(),
});

const result = (rp: number) => ({ rp, kills: 3, deaths: 1, assists: 2, won: true, createdAt: serverTimestamp() });

const db = (uid: string): Firestore => env.authenticatedContext(uid).firestore() as unknown as Firestore;

/** The batch the game writes after a match: the result plus the profile increments. */
function saveResult(fs: Firestore, uid: string, matchId: string, r: ReturnType<typeof result>, profileRp = r.rp) {
  const b = writeBatch(fs);
  b.set(doc(fs, 'matches', matchId, 'results', uid), r);
  b.update(doc(fs, 'players', uid), {
    rp: increment(profileRp),
    'stats.kills': increment(r.kills),
    'stats.deaths': increment(r.deaths),
    'stats.assists': increment(r.assists),
    'stats.matches': increment(1),
    'stats.wins': increment(r.won ? 1 : 0),
    lastMatch: matchId,
    friends: [],
  });
  return b.commit();
}

/** Seed data with the rules switched off (for a profile with RP, or an old match). */
async function seed(path: string, data: Record<string, unknown>): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore() as unknown as Firestore, path), data);
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-rvbs',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8187 },
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

async function newPlayer(uid: string): Promise<Firestore> {
  const fs = db(uid);
  await assertSucceeds(setDoc(doc(fs, 'players', uid), fresh(uid)));
  return fs;
}

async function newMatch(host: string, participants: string[], id = 'm-1'): Promise<void> {
  await assertSucceeds(setDoc(doc(db(host), 'matches', id), { host, participants, createdAt: serverTimestamp() }));
}

describe('profiles', () => {
  it('only you can create your profile, and only a fresh one', async () => {
    await assertFails(setDoc(doc(db('alice'), 'players', 'bob'), fresh()));
    await assertFails(setDoc(doc(db('alice'), 'players', 'alice'), { ...fresh(), rp: 5000 }));
    await assertFails(setDoc(doc(db('alice'), 'players', 'alice'), { ...fresh(), unlocked: { ...fresh().unlocked, modern: 10 } }));
    await assertFails(setDoc(doc(env.unauthenticatedContext().firestore() as unknown as Firestore, 'players', 'alice'), fresh()));
    await newPlayer('alice');
  });

  it("can't write someone else's profile", async () => {
    await newPlayer('bob');
    await newPlayer('alice');
    await assertFails(updateDoc(doc(db('alice'), 'players', 'bob'), { callsign: 'Goose' }));
    await assertSucceeds(updateDoc(doc(db('bob'), 'players', 'bob'), { callsign: 'Goose' }));
    await assertFails(updateDoc(doc(db('bob'), 'players', 'bob'), { callsign: '' }));
  });

  it('rejects a forged +100,000 RP write', async () => {
    const fs = await newPlayer('alice');
    // Straight onto the profile.
    await assertFails(updateDoc(doc(fs, 'players', 'alice'), { rp: 100_000 }));
    await assertFails(updateDoc(doc(fs, 'players', 'alice'), { rp: increment(100_000) }));
    // Dressed up as a match result, in a real match she played.
    await newMatch('alice', ['alice']);
    await assertFails(saveResult(fs, 'alice', 'm-1', result(100_000)));
    // A capped result but a profile increment that doesn't match it.
    await assertFails(saveResult(fs, 'alice', 'm-1', result(3000), 100_000));
    // Pointing at a result that doesn't exist.
    await assertFails(updateDoc(doc(fs, 'players', 'alice'), { rp: increment(1000), 'stats.matches': increment(1), lastMatch: 'm-1' }));
    const p = await getDoc(doc(fs, 'players', 'alice'));
    expect(p.data()?.rp).toBe(0);
  });

  it('saves a real result once: RP and stats grow by exactly that result', async () => {
    const fs = await newPlayer('alice');
    await newPlayer('bob');
    await newMatch('bob', ['bob', 'alice']);
    await assertSucceeds(saveResult(fs, 'alice', 'm-1', result(1038)));
    const p = (await getDoc(doc(fs, 'players', 'alice'))).data()!;
    expect(p.rp).toBe(1038);
    expect(p.stats).toEqual({ kills: 3, deaths: 1, assists: 2, matches: 1, wins: 1 });
    // One result per uid per match.
    await assertFails(saveResult(fs, 'alice', 'm-1', result(1038)));
    // And an old result can't be replayed onto the profile.
    await assertFails(updateDoc(doc(fs, 'players', 'alice'), { rp: increment(1038), 'stats.matches': increment(1), lastMatch: 'm-1' }));
  });

  it('caps RP per match at 3,000', async () => {
    const fs = await newPlayer('alice');
    await newMatch('alice', ['alice']);
    await assertFails(saveResult(fs, 'alice', 'm-1', result(3001)));
    await assertSucceeds(saveResult(fs, 'alice', 'm-1', result(3000)));
  });

  it('only participants of a match under an hour old can save a result', async () => {
    const fs = await newPlayer('carol');
    await newPlayer('bob');
    await newMatch('bob', ['bob']);
    await assertFails(saveResult(fs, 'carol', 'm-1', result(500)));
    // Nobody can save into a match that doesn't exist.
    await assertFails(saveResult(fs, 'carol', 'm-missing', result(500)));
    // An hour-old match.
    await seed('matches/m-old', { host: 'carol', participants: ['carol'], createdAt: Timestamp.fromMillis(Date.now() - 61 * 60 * 1000) });
    await assertFails(saveResult(fs, 'carol', 'm-old', result(500)));
    // Someone else's result slot.
    await newMatch('bob', ['bob', 'carol'], 'm-2');
    await assertFails(setDoc(doc(fs, 'matches', 'm-2', 'results', 'bob'), result(500)));
  });

  it('a match record lists its host; only the host adds late joiners', async () => {
    await assertFails(setDoc(doc(db('bob'), 'matches', 'm-x'), { host: 'alice', participants: ['alice', 'bob'], createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db('bob'), 'matches', 'm-x'), { host: 'bob', participants: ['alice'], createdAt: serverTimestamp() }));
    await newMatch('bob', ['bob']);
    await assertFails(updateDoc(doc(db('alice'), 'matches', 'm-1'), { participants: ['bob', 'alice'] }));
    await assertSucceeds(updateDoc(doc(db('bob'), 'matches', 'm-1'), { participants: ['bob', 'alice'] }));
    await assertFails(updateDoc(doc(db('bob'), 'matches', 'm-1'), { participants: ['alice'] }));
  });
});

describe('unlocks', () => {
  async function richPlayer(uid: string, rp: number, unlocked: Partial<Record<string, number>> = {}): Promise<Firestore> {
    await seed(`players/${uid}`, {
      ...fresh(uid),
      rp,
      unlocked: { ...fresh().unlocked, ...unlocked },
      createdAt: Timestamp.now(),
    });
    return db(uid);
  }
  const buy = (fs: Firestore, uid: string, era: string, tier: number, cost = 200 * tier) =>
    updateDoc(doc(fs, 'players', uid), { rp: increment(-cost), [`unlocked.${era}`]: tier, lastUnlock: { era, tier } });

  it('buys tiers in order with enough RP', async () => {
    const fs = await richPlayer('alice', 1000);
    await assertSucceeds(buy(fs, 'alice', 'ww1', 2)); // 400
    await assertSucceeds(buy(fs, 'alice', 'ww1', 3)); // 600
    const p = (await getDoc(doc(fs, 'players', 'alice'))).data()!;
    expect(p.rp).toBe(0);
    expect(p.unlocked.ww1).toBe(3);
  });

  it('rejects an out-of-order unlock', async () => {
    const fs = await richPlayer('alice', 50_000);
    await assertFails(buy(fs, 'alice', 'modern', 10));
    await assertFails(buy(fs, 'alice', 'modern', 3));
    // Re-buying a tier you have, or skipping by setting the map directly.
    await assertFails(buy(fs, 'alice', 'modern', 1));
    await assertFails(updateDoc(doc(fs, 'players', 'alice'), { 'unlocked.modern': 10 }));
    const p = (await getDoc(doc(fs, 'players', 'alice'))).data()!;
    expect(p.unlocked.modern).toBe(1);
  });

  it('rejects an unlock without enough RP, at the wrong price, or of two eras at once', async () => {
    const fs = await richPlayer('alice', 399);
    await assertFails(buy(fs, 'alice', 'ww1', 2)); // needs 400
    const rich = await richPlayer('bob', 5000);
    await assertFails(buy(rich, 'bob', 'ww1', 2, 1)); // pays 1 RP instead of 400
    await assertFails(updateDoc(doc(rich, 'players', 'bob'), { rp: increment(-400), 'unlocked.ww1': 2, 'unlocked.modern': 2, lastUnlock: { era: 'ww1', tier: 2 } }));
    await assertFails(buy(rich, 'bob', 'atlantis', 2));
    await assertSucceeds(buy(rich, 'bob', 'ww1', 2));
  });
});
