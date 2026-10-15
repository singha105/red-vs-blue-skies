// Everything that talks to Firebase. Loaded with a dynamic import only after the title screen is up, so the
// game starts (and solo plays) without it. Firestore Lite: plain HTTPS requests, no listeners or offline cache;
// the store keeps its own queue in localStorage instead, which is simpler to reason about.
import { initializeApp, type FirebaseOptions } from 'firebase/app';
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  connectAuthEmulator,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
  linkWithPopup,
  onAuthStateChanged,
  signInAnonymously,
  signInWithCredential,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  documentId,
  getDoc,
  getDocs,
  getFirestore,
  increment,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore/lite';
import type { EraId } from '../data/types';
import { unlockCost } from '../game/unlocks';
import { cleanProfile, newProfile, type LeaderRow, type MatchResultDoc, type Profile } from './model';

/** Firestore operations so far: what we're billed for. ruleReads are the reads our rules make (get/getAfter). */
export interface Usage {
  reads: number;
  writes: number;
  ruleReads: number;
}

export interface Account {
  uid: string;
  anonymous: boolean;
  email: string | null;
}

export type SaveOutcome = 'saved' | 'duplicate' | 'rejected';

export interface Cloud {
  readonly account: Account;
  readonly usage: Usage;
  /** players/{uid}, created on first sign-in. */
  loadProfile(callsign: string): Promise<Profile>;
  setCallsign(callsign: string): Promise<void>;
  /** Host: matches/{id} with every human's uid. */
  createMatch(matchId: string, participants: string[]): Promise<'created' | 'exists'>;
  addParticipant(matchId: string, uid: string): Promise<void>;
  /** One batch: matches/{id}/results/{uid} + the profile increments. */
  saveResult(matchId: string, r: MatchResultDoc, friends: string[]): Promise<SaveOutcome>;
  buyUnlock(era: EraId, tier: number): Promise<void>;
  leaderboard(uids: string[]): Promise<LeaderRow[]>;
  /** Link Google to this account; if that Google account already has progress, switch to it. */
  linkGoogle(): Promise<'linked' | 'switched'>;
}

/** Rule reads per operation (see firestore.rules): a result batch reads the match and the result-after. */
const RULE_READS = { result: 2, other: 0 } as const;

const errCode = (e: unknown): string => (e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '');
export const isDenied = (e: unknown): boolean => /permission-denied/.test(errCode(e));
/** Network trouble rather than a refusal: try again later. */
export const isOffline = (e: unknown): boolean =>
  /unavailable|network|deadline|timeout|internal/.test(errCode(e)) ||
  e instanceof TypeError ||
  // Firestore Lite reports a failed fetch as code "unknown" (Chrome: Failed to fetch, Safari: Load failed).
  /failed to fetch|load failed|networkerror|network request failed/i.test(e instanceof Error ? e.message : '');

function firstUser(auth: Auth): Promise<User | null> {
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, (u) => {
      stop();
      resolve(u);
    });
  });
}

const account = (u: User): Account => ({ uid: u.uid, anonymous: u.isAnonymous, email: u.email });

export async function connectCloud(config: FirebaseOptions, opts: { emulator: boolean; emulatorPorts: { auth: number; firestore: number } }): Promise<Cloud> {
  // The default app name: the signed-in user is persisted per app name, so it must not change between loads.
  const app = initializeApp(config);
  const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence], popupRedirectResolver: browserPopupRedirectResolver });
  const db: Firestore = getFirestore(app);
  if (opts.emulator) {
    connectAuthEmulator(auth, `http://127.0.0.1:${opts.emulatorPorts.auth}`, { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', opts.emulatorPorts.firestore);
  }
  // A returning player is restored from IndexedDB (works offline); a new one signs in anonymously.
  const user = (await firstUser(auth)) ?? (await signInAnonymously(auth)).user;
  let acc = account(user);
  const usage: Usage = { reads: 0, writes: 0, ruleReads: 0 };
  const me = () => doc(db, 'players', acc.uid);

  const cloud: Cloud = {
    get account() {
      return acc;
    },
    usage,

    async loadProfile(callsign) {
      usage.reads++;
      const snap = await getDoc(me());
      if (snap.exists()) return cleanProfile(snap.data());
      const p = newProfile(callsign);
      usage.writes++;
      await setDoc(me(), { ...p, lastMatch: null, lastUnlock: null, createdAt: serverTimestamp() });
      return p;
    },

    async setCallsign(callsign) {
      usage.writes++;
      await updateDoc(me(), { callsign });
    },

    async createMatch(matchId, participants) {
      usage.writes++;
      try {
        await setDoc(doc(db, 'matches', matchId), { host: acc.uid, participants, createdAt: serverTimestamp() });
        return 'created';
      } catch (e) {
        // A retry after a lost response: the record is there already (an overwrite is refused).
        if (!isDenied(e)) throw e;
        usage.reads++;
        const snap = await getDoc(doc(db, 'matches', matchId));
        if (snap.exists()) return 'exists';
        throw e;
      }
    },

    async addParticipant(matchId, uid) {
      const ref = doc(db, 'matches', matchId);
      usage.reads++;
      const snap = await getDoc(ref);
      const list = snap.exists() && Array.isArray(snap.data().participants) ? (snap.data().participants as string[]) : null;
      if (!list || list.includes(uid)) return;
      usage.writes++;
      await updateDoc(ref, { participants: [...list, uid] });
    },

    async saveResult(matchId, r, friends) {
      const resultRef = doc(db, 'matches', matchId, 'results', acc.uid);
      const batch = writeBatch(db);
      batch.set(resultRef, { ...r, createdAt: serverTimestamp() });
      batch.update(me(), {
        rp: increment(r.rp),
        'stats.kills': increment(r.kills),
        'stats.deaths': increment(r.deaths),
        'stats.assists': increment(r.assists),
        'stats.matches': increment(1),
        'stats.wins': increment(r.won ? 1 : 0),
        lastMatch: matchId,
        friends,
      });
      usage.writes += 2;
      usage.ruleReads += RULE_READS.result;
      try {
        await batch.commit();
        return 'saved';
      } catch (e) {
        if (!isDenied(e)) throw e;
        // Already saved (a retry), or not allowed (no match record, too old, not a participant).
        usage.reads++;
        const snap = await getDoc(resultRef);
        return snap.exists() ? 'duplicate' : 'rejected';
      }
    },

    async buyUnlock(era, tier) {
      usage.writes++;
      usage.ruleReads += RULE_READS.other;
      await updateDoc(me(), { rp: increment(-unlockCost(tier)), [`unlocked.${era}`]: tier, lastUnlock: { era, tier } });
    },

    async leaderboard(uids) {
      const rows: LeaderRow[] = [];
      const ids = [...new Set(uids)];
      for (let i = 0; i < ids.length; i += 30) {
        const chunk = ids.slice(i, i + 30);
        const snap = await getDocs(query(collection(db, 'players'), where(documentId(), 'in', chunk)));
        usage.reads += Math.max(1, snap.size);
        for (const d of snap.docs) {
          const p = cleanProfile(d.data());
          rows.push({ uid: d.id, callsign: p.callsign, rp: p.rp, unlocked: p.unlocked, stats: p.stats });
        }
      }
      return rows;
    },

    async linkGoogle() {
      const provider = new GoogleAuthProvider();
      const current = auth.currentUser;
      if (!current) throw new Error('not signed in');
      try {
        acc = account((await linkWithPopup(current, provider)).user);
        return 'linked';
      } catch (e) {
        if (errCode(e) !== 'auth/credential-already-in-use') throw e;
        // This Google account already has a profile (another device): continue as that player.
        const cred = GoogleAuthProvider.credentialFromError(e as Parameters<typeof GoogleAuthProvider.credentialFromError>[0]);
        if (!cred) throw e;
        acc = account((await signInWithCredential(auth, cred)).user);
        return 'switched';
      }
    },
  };
  return cloud;
}

export { errCode };
