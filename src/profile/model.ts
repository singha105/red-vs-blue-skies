// Player profiles and saved match results as plain data, with the checks the client makes before it writes.
// No Firebase or DOM here, so it is unit-tested; firestore.rules enforces the same limits on the server.
import type { Team } from '../game/flight';
import type { ResultRow } from '../game/results';
import { cleanUnlocks, earnedRp, freshUnlocks, type UnlockMap } from '../game/unlocks';

/** Firestore rule: RP gain per match is capped (friends-grade anti-cheat). */
export const RP_CAP = 3000;
/** Rule: results may only be saved while the match is under an hour old. */
export const MATCH_MAX_AGE_MS = 60 * 60 * 1000;
/** Queued results older than this can never be accepted (the match record expired): drop them. */
export const QUEUE_EXPIRY_MS = 2 * MATCH_MAX_AGE_MS;
export const FRIENDS_MAX = 50;
export const CALLSIGN_MAX = 16;
/** Most stats any match result may claim (rules use the same bound). */
export const STAT_MAX = 500;

export interface LifetimeStats {
  kills: number;
  deaths: number;
  assists: number;
  matches: number;
  wins: number;
}

/** players/{uid} */
export interface Profile {
  callsign: string;
  /** Research points to spend. */
  rp: number;
  /** Highest unlocked tier per era. */
  unlocked: UnlockMap;
  stats: LifetimeStats;
  /** uids of players you've shared a match with (the friends leaderboard), most recent first. */
  friends: string[];
}

/** matches/{matchId}/results/{uid} (createdAt is the server time, added by the cloud module). */
export interface MatchResultDoc {
  rp: number;
  kills: number;
  deaths: number;
  assists: number;
  won: boolean;
}

/** A result waiting to be saved (localStorage), in the order the matches ended. */
export interface PendingResult {
  matchId: string;
  /** Who earned it; null when this device had no account yet (solo only: saved under the next account). */
  uid: string | null;
  /** Solo: this device creates the match record too (it may never have reached the server). */
  solo: boolean;
  /** Everyone in the match (friends list); for solo just you. */
  participants: string[];
  result: MatchResultDoc;
  /** Local time the match ended. */
  at: number;
}

export const newStats = (): LifetimeStats => ({ kills: 0, deaths: 0, assists: 0, matches: 0, wins: 0 });

export const newProfile = (callsign: string): Profile => ({
  callsign: cleanCallsign(callsign),
  rp: 0,
  unlocked: freshUnlocks(),
  stats: newStats(),
  friends: [],
});

export const cleanCallsign = (raw: unknown): string =>
  (typeof raw === 'string' ? raw.replace(/[<>&"'`\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim() : '').slice(0, CALLSIGN_MAX) || 'Pilot';

const count = (v: unknown, max = 1e9): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0);
const uidList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 128) : []);

/** Firestore or localStorage → a valid profile. */
export function cleanProfile(raw: unknown): Profile {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const st = o.stats && typeof o.stats === 'object' ? (o.stats as Record<string, unknown>) : {};
  return {
    callsign: cleanCallsign(o.callsign),
    rp: count(o.rp),
    unlocked: cleanUnlocks(o.unlocked),
    stats: { kills: count(st.kills), deaths: count(st.deaths), assists: count(st.assists), matches: count(st.matches), wins: count(st.wins) },
    friends: uidList(o.friends).slice(0, FRIENDS_MAX),
  };
}

/** One player's row from the host's results → what gets saved. RP is capped like the rules cap it. */
export function resultFromRow(row: ResultRow, winner: Team | 'draw' | null): MatchResultDoc {
  return {
    rp: Math.min(RP_CAP, count(row.rp)),
    kills: count(row.kills, STAT_MAX),
    deaths: count(row.deaths, STAT_MAX),
    assists: count(row.assists, STAT_MAX),
    won: winner === row.team,
  };
}

/** Recent match-mates first, without yourself, at most FRIENDS_MAX. */
export function mergeFriends(friends: readonly string[], participants: readonly string[], self: string): string[] {
  const out: string[] = [];
  for (const id of [...participants, ...friends]) if (id !== self && !out.includes(id)) out.push(id);
  return out.slice(0, FRIENDS_MAX);
}

/** The profile after a saved result (the same arithmetic the rules check). */
export function applyResult(p: Profile, r: MatchResultDoc, friends: string[] = p.friends): Profile {
  return {
    ...p,
    rp: p.rp + r.rp,
    stats: {
      kills: p.stats.kills + r.kills,
      deaths: p.stats.deaths + r.deaths,
      assists: p.stats.assists + r.assists,
      matches: p.stats.matches + 1,
      wins: p.stats.wins + (r.won ? 1 : 0),
    },
    friends,
  };
}

export function cleanQueue(raw: unknown): PendingResult[] {
  if (!Array.isArray(raw)) return [];
  const out: PendingResult[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    const r = (o.result && typeof o.result === 'object' ? o.result : {}) as Record<string, unknown>;
    if (typeof o.matchId !== 'string' || !/^[\w-]{4,100}$/.test(o.matchId)) continue;
    out.push({
      matchId: o.matchId,
      uid: typeof o.uid === 'string' ? o.uid : null,
      solo: o.solo === true,
      participants: uidList(o.participants).slice(0, 24),
      result: {
        rp: Math.min(RP_CAP, count(r.rp)),
        kills: count(r.kills, STAT_MAX),
        deaths: count(r.deaths, STAT_MAX),
        assists: count(r.assists, STAT_MAX),
        won: r.won === true,
      },
      at: count(o.at, Number.MAX_SAFE_INTEGER),
    });
  }
  return out;
}

/** Add a result to the queue, once per match. */
export function enqueue(queue: readonly PendingResult[], e: PendingResult): PendingResult[] {
  return queue.some((q) => q.matchId === e.matchId) ? [...queue] : [...queue, e];
}

/** RP still waiting to be saved for this account (shown as "+N syncing"). */
export const pendingRp = (queue: readonly PendingResult[], uid: string | null): number =>
  queue.filter((q) => q.uid === null || q.uid === uid).reduce((s, q) => s + q.result.rp, 0);

export const kd = (s: LifetimeStats): number => s.kills / Math.max(1, s.deaths);

export interface LeaderRow {
  uid: string;
  callsign: string;
  rp: number;
  unlocked: UnlockMap;
  stats: LifetimeStats;
}

export type Board = 'rp' | 'kills' | 'kd';

/** Rank the friends leaderboard. RP ranks everything earned, so spending on unlocks doesn't drop you. */
export function rankBoard(rows: readonly LeaderRow[], board: Board): LeaderRow[] {
  const key = (r: LeaderRow): number => (board === 'rp' ? earnedRp(r.rp, r.unlocked) : board === 'kills' ? r.stats.kills : kd(r.stats));
  return [...rows].sort((a, b) => key(b) - key(a) || b.stats.kills - a.stats.kills || (a.uid < b.uid ? -1 : 1));
}

/** Short, URL-safe and unique enough: Firestore document ids for matches. */
export function makeMatchId(prefix: string, random: () => number = Math.random, now = Date.now()): string {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  let r = '';
  for (let i = 0; i < 8; i++) r += abc[Math.floor(random() * abc.length)];
  return `${prefix.replace(/[^\w]/g, '').slice(0, 12) || 'm'}-${now.toString(36)}-${r}`;
}
