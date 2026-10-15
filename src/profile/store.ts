// The player's progress as the game sees it: the last profile Firestore confirmed (cached in localStorage so
// plane select works offline), plus results still waiting to be saved. Firebase loads in the background; when
// it can't be reached the game plays on and the queue syncs later (on the next start, when the browser comes
// back online, and every minute while anything is waiting).
import { env } from '../core/env';
import { readStorage, writeStorage } from '../core/storage';
import type { EraId } from '../data/types';
import type { Team } from '../game/flight';
import type { ResultRow } from '../game/results';
import { canUnlock, earnedRp, unlockCost, type Unlocks, type UnlockCheck } from '../game/unlocks';
import type { MatchRecorder } from '../net/hostServer';
import type { Account, Cloud, Usage } from './cloud';
import { EMULATOR_CONFIG, EMULATOR_PORTS, firebaseConfig } from './config';
import {
  applyResult,
  cleanCallsign,
  cleanProfile,
  cleanQueue,
  enqueue,
  makeMatchId,
  mergeFriends,
  newProfile,
  pendingRp,
  QUEUE_EXPIRY_MS,
  resultFromRow,
  type LeaderRow,
  type MatchResultDoc,
  type PendingResult,
  type Profile,
} from './model';

const PROFILE_KEY = 'rvbs.profile.v1';
const QUEUE_KEY = 'rvbs.pending.v1';
const BOARD_KEY = 'rvbs.leaders.v1';
/** Friends leaderboard cache (keeps reads low). */
export const BOARD_TTL_MS = 5 * 60 * 1000;
const CONNECT_TIMEOUT_MS = 12_000;
const RETRY_MS = 60_000;

export type CloudStatus = 'off' | 'connecting' | 'online' | 'offline';

/** What happened to a match's result, for the results screen. */
export type SaveState = 'saved' | 'queued' | 'unsaved' | 'rejected';

export interface ProfileStore {
  readonly profile: Profile;
  readonly status: CloudStatus;
  readonly account: Account | null;
  /** This player's uid: the signed-in account, or the last one seen on this device (offline). */
  readonly uid: string | null;
  /** RP earned in matches that aren't saved yet. */
  readonly pendingRp: number;
  /** What plane select may offer: the profile's unlocks, or everything in a local debug build. */
  unlocks(): Unlocks;
  /** Total RP ever earned (team balancing). */
  earned(): number;
  canUnlock(era: EraId, tier: number): UnlockCheck;
  /** Spend RP on the next tier of an era (needs Firebase). */
  buy(era: EraId, tier: number): Promise<'ok' | 'offline' | 'refused'>;
  setCallsign(callsign: string): void;
  /** The host's match record hooks (always present: offline hosts just get no match id). */
  readonly recorder: MatchRecorder;
  /** A network match ended: save this player's row under the host's match id. Returns the match id to ask
   * saveState about, or null when it can't be saved (the host was offline). */
  recordMatch(matchId: string | null, row: ResultRow | undefined, winner: Team | 'draw' | null, participants?: string[]): string | null;
  /** A solo match ended: this device is the host. */
  recordSolo(row: ResultRow | undefined, winner: Team | 'draw' | null): string | null;
  /** The latest save state of a match (the results screen asks again after a sync). */
  saveState(matchId: string | null): SaveState;
  /** The save state as a sentence for the results screen ('' for none). */
  saveText(matchId: string | null): string;
  leaderboard(force?: boolean): Promise<{ rows: LeaderRow[]; at: number } | null>;
  linkGoogle(): Promise<string>;
  /** Firestore operations this session and since the last match started, its saves included (?debug=1). */
  usage(): { session: Usage; match: Usage };
  markMatchStart(): void;
  onChange(fn: () => void): () => void;
}

interface Cached {
  uid: string | null;
  profile: Profile;
}

function readJson(key: string): unknown {
  try {
    return JSON.parse(readStorage(key) ?? 'null');
  } catch {
    return null;
  }
}

export function createProfileStore(opts: { callsign: () => string; now?: () => number }): ProfileStore {
  const now = opts.now ?? (() => Date.now());
  const cachedRaw = readJson(PROFILE_KEY) as Partial<Cached> | null;
  let cached: Cached = { uid: typeof cachedRaw?.uid === 'string' ? cachedRaw.uid : null, profile: cleanProfile(cachedRaw?.profile ?? newProfile(opts.callsign())) };
  let queue: PendingResult[] = cleanQueue(readJson(QUEUE_KEY));
  let cloud: Cloud | null = null;
  let status: CloudStatus = 'off';
  const outcome = new Map<string, SaveState>();
  const listeners = new Set<() => void>();
  const emptyUsage = (): Usage => ({ reads: 0, writes: 0, ruleReads: 0 });
  let matchBase = emptyUsage();
  let matchMarkedAt = -Infinity;
  let syncing: Promise<void> | null = null;
  let retryTimer = 0;

  const changed = (): void => {
    for (const fn of listeners) fn();
  };
  const saveProfile = (): void => {
    writeStorage(PROFILE_KEY, JSON.stringify(cached));
  };
  const saveQueue = (): void => {
    writeStorage(QUEUE_KEY, JSON.stringify(queue));
  };
  const setStatus = (s: CloudStatus): void => {
    if (status === s) return;
    status = s;
    changed();
  };

  const scheduleRetry = (): void => {
    window.clearTimeout(retryTimer);
    retryTimer = window.setTimeout(() => void connectOrSync(), RETRY_MS);
  };

  async function sync(): Promise<void> {
    const c = cloud;
    if (!c) return;
    const uid = c.account.uid;
    for (const e of [...queue]) {
      const drop = (state: SaveState): void => {
        queue = queue.filter((q) => q !== e);
        outcome.set(e.matchId, state);
        saveQueue();
        changed();
      };
      // Earned under another account (this device switched to a linked Google account): can't be saved.
      if (e.uid !== null && e.uid !== uid) {
        if (now() - e.at > QUEUE_EXPIRY_MS) drop('rejected');
        continue;
      }
      try {
        if (e.solo || e.uid === null) await c.createMatch(e.matchId, [uid]);
        const friends = mergeFriends(cached.profile.friends, e.participants, uid);
        const res = await c.saveResult(e.matchId, e.result, friends);
        if (res === 'saved') cached = { uid, profile: applyResult(cached.profile, e.result, friends) };
        if (res === 'saved' || res === 'duplicate') {
          saveProfile();
          drop('saved');
        } else if (now() - e.at > QUEUE_EXPIRY_MS) drop('rejected');
        // Otherwise the host's match record may not have reached the server yet: try again later.
      } catch (err) {
        const { isOffline } = await import('./cloud');
        if (isOffline(err)) {
          setStatus('offline');
          scheduleRetry();
          return;
        }
        console.warn('Saving a result failed', err);
        if (now() - e.at > QUEUE_EXPIRY_MS) drop('rejected');
      }
    }
    if (queue.some((q) => q.uid === null || q.uid === uid)) scheduleRetry();
  }

  async function connect(): Promise<void> {
    const config = env.emulator ? EMULATOR_CONFIG : firebaseConfig;
    if (!config || env.firebaseOff) return;
    setStatus('connecting');
    try {
      const mod = await import('./cloud');
      const c = await Promise.race([
        mod.connectCloud(config, { emulator: env.emulator, emulatorPorts: EMULATOR_PORTS }),
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('timeout')), CONNECT_TIMEOUT_MS)),
      ]);
      const profile = await c.loadProfile(cached.profile.callsign);
      cloud = c;
      cached = { uid: c.account.uid, profile };
      saveProfile();
      setStatus('online');
      changed();
      // A callsign chosen while offline wins over the one on the server.
      const local = cleanCallsign(opts.callsign());
      if (opts.callsign() && local !== profile.callsign) store.setCallsign(local);
    } catch (err) {
      console.warn('Firebase unreachable; progress stays on this device for now', err);
      setStatus('offline');
      scheduleRetry();
    }
  }

  function connectOrSync(): Promise<void> {
    syncing ??= (async () => {
      try {
        if (!cloud) await connect();
        if (cloud) {
          setStatus('online');
          await sync();
        }
      } finally {
        syncing = null;
      }
    })();
    return syncing;
  }

  const queueResult = (e: PendingResult): SaveState => {
    queue = enqueue(queue, e);
    saveQueue();
    outcome.set(e.matchId, 'queued');
    changed();
    void connectOrSync();
    return 'queued';
  };

  const store: ProfileStore = {
    get profile() {
      return cached.profile;
    },
    get status() {
      return status;
    },
    get account() {
      return cloud?.account ?? null;
    },
    get uid() {
      return cloud?.account.uid ?? cached.uid;
    },
    get pendingRp() {
      return pendingRp(queue, cloud?.account.uid ?? cached.uid);
    },
    unlocks: () => (env.allUnlocked ? 'all' : cached.profile.unlocked),
    earned: () => earnedRp(cached.profile.rp, cached.profile.unlocked),
    canUnlock: (era, tier) => canUnlock(cached.profile.rp, cached.profile.unlocked, era, tier),

    async buy(era, tier) {
      if (store.canUnlock(era, tier) !== 'ok') return 'refused';
      if (!cloud) {
        void connectOrSync();
        return 'offline';
      }
      try {
        await cloud.buyUnlock(era, tier);
        const p = cached.profile;
        cached = { ...cached, profile: { ...p, rp: p.rp - unlockCost(tier), unlocked: { ...p.unlocked, [era]: tier } } };
        saveProfile();
        changed();
        return 'ok';
      } catch (err) {
        const { isOffline } = await import('./cloud');
        if (isOffline(err)) {
          setStatus('offline');
          scheduleRetry();
          return 'offline';
        }
        // Refused: our cached profile is stale (another device spent the RP). Reload it.
        console.warn('Unlock refused', err);
        try {
          cached = { uid: cloud.account.uid, profile: await cloud.loadProfile(cached.profile.callsign) };
          saveProfile();
          changed();
        } catch {
          // Keep the cache.
        }
        return 'refused';
      }
    },

    setCallsign(callsign) {
      const cs = cleanCallsign(callsign);
      if (cs === cached.profile.callsign) return;
      cached = { ...cached, profile: { ...cached.profile, callsign: cs } };
      saveProfile();
      changed();
      cloud?.setCallsign(cs).catch((err: unknown) => console.warn('Callsign not saved', err));
    },

    recorder: {
      start(uids) {
        store.markMatchStart();
        if (!cloud) return null;
        const id = makeMatchId('m');
        cloud.createMatch(id, uids).catch((err: unknown) => console.warn('Match record not created', err));
        return id;
      },
      join(matchId, uid) {
        cloud?.addParticipant(matchId, uid).catch((err: unknown) => console.warn('Late joiner not added', err));
      },
    },

    recordMatch(matchId, row, winner, participants = []) {
      if (!row || row.bot) return null;
      const uid = cloud?.account.uid ?? cached.uid;
      // No match record (the host was offline) or no account at the start: nothing the rules would accept.
      if (!matchId || !uid) return null;
      if (!outcome.has(matchId)) queueResult({ matchId, uid, solo: false, participants, result: resultFromRow(row, winner), at: now() });
      return matchId;
    },

    recordSolo(row, winner) {
      if (!row || row.bot) return null;
      const uid = cloud?.account.uid ?? cached.uid;
      const result: MatchResultDoc = resultFromRow(row, winner);
      const matchId = makeMatchId('s');
      queueResult({ matchId, uid, solo: true, participants: [], result, at: now() });
      return matchId;
    },

    saveState(matchId) {
      return matchId ? (outcome.get(matchId) ?? 'unsaved') : 'unsaved';
    },

    saveText(matchId) {
      const state = store.saveState(matchId);
      if (state === 'saved') return 'RP saved to your profile.';
      if (state === 'rejected') return "The server didn't accept this result.";
      if (state === 'queued') {
        if (status === 'off') return 'RP saved on this device.';
        return status === 'online' || status === 'connecting' ? 'Saving RP…' : "RP saved on this device. It syncs when you're back online.";
      }
      return matchId === null && status !== 'off' ? "RP not saved: you or the host were offline when the match started." : '';
    },

    async leaderboard(force = false) {
      const uid = cloud?.account.uid ?? cached.uid;
      const hit = readJson(BOARD_KEY) as { uid?: string; at?: number; rows?: LeaderRow[] } | null;
      if (!force && hit && hit.uid === uid && typeof hit.at === 'number' && now() - hit.at < BOARD_TTL_MS && Array.isArray(hit.rows)) return { rows: hit.rows, at: hit.at };
      if (!cloud) {
        await connectOrSync();
        if (!cloud) return hit && Array.isArray(hit.rows) && typeof hit.at === 'number' ? { rows: hit.rows, at: hit.at } : null;
      }
      const me = cloud.account.uid;
      try {
        const rows = await cloud.leaderboard([me, ...cached.profile.friends]);
        const entry = { uid: me, at: now(), rows };
        writeStorage(BOARD_KEY, JSON.stringify(entry));
        return { rows, at: entry.at };
      } catch (err) {
        console.warn('Leaderboard unavailable', err);
        return null;
      }
    },

    async linkGoogle() {
      if (!cloud) {
        await connectOrSync();
        if (!cloud) return "Can't reach the server right now. Try again when you're online.";
      }
      try {
        const before = cloud.account.uid;
        const res = await cloud.linkGoogle();
        if (res === 'switched' && cloud.account.uid !== before) {
          cached = { uid: cloud.account.uid, profile: await cloud.loadProfile(cached.profile.callsign) };
          saveProfile();
          writeStorage(BOARD_KEY, 'null');
        }
        changed();
        void connectOrSync();
        return res === 'linked' ? 'Google account linked. Sign in with it on another device to bring your progress along.' : 'Signed in: this device now uses the progress saved on your Google account.';
      } catch (err) {
        const { errCode } = await import('./cloud');
        const code = errCode(err);
        console.warn('Google link failed', err);
        if (code === 'auth/popup-blocked') return 'The browser blocked the sign-in window. Allow pop-ups for this site and try again.';
        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'Sign-in cancelled.';
        if (code === 'auth/unauthorized-domain') return "This site isn't authorised for Google sign-in yet.";
        return "Couldn't link Google right now. Try again later.";
      }
    },

    usage() {
      const s = cloud?.usage ?? emptyUsage();
      return { session: { ...s }, match: { reads: s.reads - matchBase.reads, writes: s.writes - matchBase.writes, ruleReads: s.ruleReads - matchBase.ruleReads } };
    },
    markMatchStart() {
      // The host marks it when creating the record, just before its own player enters the match.
      if (now() - matchMarkedAt < 10_000) return;
      matchMarkedAt = now();
      matchBase = { ...(cloud?.usage ?? emptyUsage()) };
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  window.addEventListener('online', () => void connectOrSync());
  // Connect once the first frame is drawn: startup and solo never wait for Firebase.
  window.setTimeout(() => void connectOrSync(), 0);
  return store;
}
