// The lobby state machine, run only by the host: lobby → vote → teams → plane select → playing → results →
// lobby. Clients only send requests; every one is checked here against the phase and the rules. Pure logic
// (no transport, no DOM, time and randomness passed in) so it is easy to test.
import type { EraId, GameData } from '../data/types';
import type { Team } from '../game/flight';
import { splitTeams, TEAM_SIZE } from '../game/teams';
import { cleanUnlocks, isUnlocked, type UnlockMap } from '../game/unlocks';
import type { DeviceInfo, RoomPhase, RoomPlayer, RoomSettings, RoomState, VoteCategory } from './protocol';

export const VOTE_S = 20;
export const TEAMS_S = 5;
export const SELECT_S = 25;
export const RESULTS_S = 60;
export const PARTY_MAX = 3;
export const MATCH_LENGTHS_S = [300, 600, 900] as const;

export interface Room {
  readonly phase: RoomPhase;
  readonly settings: RoomSettings;
  readonly choice: RoomState['choice'];
  players(): RoomPlayer[];
  get(id: string): RoomPlayer | undefined;
  add(p: { id: string; name: string; host: boolean; device: DeviceInfo; rp: number; unlocked?: UnlockMap }): RoomPlayer;
  /** A player's progress changed between rounds (bought an unlock, saved RP). */
  setProgress(id: string, rp: number, unlocked: UnlockMap): void;
  remove(id: string): void;
  setPing(id: string, ms: number | null): void;
  ready(id: string, ready: boolean): boolean;
  party(id: string, withId: string | null): boolean;
  vote(id: string, cat: VoteCategory, option: string): boolean;
  override(cat: VoteCategory, option: string | null): boolean;
  pick(id: string, planeId: string, lock: boolean): boolean;
  /** May this player fly this plane in the chosen era (their unlocks, or everything with debug)? */
  allowedPlane(playerId: string, planeId: string): boolean;
  /** For anyone who doesn't pick: the best plane this player has unlocked in the era. */
  defaultPlane(playerId: string, era: EraId): string;
  setSettings(s: Partial<RoomSettings>): void;
  startVote(now: number): boolean;
  /** Advance timers. Returns 'start' when plane select is over and the host should create the match. */
  tick(now: number): 'start' | null;
  setBr(br: Record<Team, number> | null): void;
  /** A player joined mid-match on this team. */
  joinedMatch(id: string, team: Team): void;
  matchEnded(now: number): void;
  playAgain(): void;
  /** Humans who clicked "Play again" on the results screen (shown to the host). */
  readonly againCount: number;
  again(id: string): void;
  state(now: number): RoomState;
  /** Bumped on every change, so the host knows when to broadcast. */
  readonly version: number;
}

export function createRoom(data: GameData, opts: { allUnlocked: boolean; settings: RoomSettings; random?: () => number }): Room {
  const random = opts.random ?? Math.random;
  const settings: RoomSettings = { ...opts.settings };
  const list: RoomPlayer[] = [];
  let phase: RoomPhase = 'lobby';
  let endsAt: number | null = null;
  let overrides: Partial<Record<VoteCategory, string>> = {};
  let choice: RoomState['choice'] = null;
  let br: Record<Team, number> | null = null;
  let round = 1;
  let version = 1;
  const changed = (): void => {
    version++;
  };

  const options = (cat: VoteCategory): string[] =>
    cat === 'era' ? data.eras.map((e) => e.id) : cat === 'map' ? data.maps.map((m) => m.id) : data.modes.filter((m) => m.playable).map((m) => m.id);

  const planeById = new Map(data.planes.map((p) => [p.id, p]));
  const unlocksOf = (playerId: string): UnlockMap | 'all' => (opts.allUnlocked ? 'all' : (list.find((p) => p.id === playerId)?.unlocked ?? cleanUnlocks(null)));
  const allowedPlane = (playerId: string, planeId: string): boolean => {
    const p = planeById.get(planeId);
    return Boolean(p && choice && p.era === choice.era && isUnlocked(p, unlocksOf(playerId)));
  };
  const defaultPlane = (playerId: string, era: EraId): string => {
    const open = unlocksOf(playerId);
    const pool = data.planes.filter((p) => p.era === era && isUnlocked(p, open)).sort((a, b) => b.tier - a.tier);
    return pool[0]!.id;
  };

  const decide = (cat: VoteCategory): string => {
    const forced = overrides[cat];
    if (forced) return forced;
    const counts = new Map<string, number>();
    for (const p of list) {
      const v = p.votes[cat];
      if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const top = Math.max(0, ...counts.values());
    if (top === 0) {
      // Nobody voted: the data's default (map, mode), or a random era.
      if (cat === 'map') return (data.maps.find((m) => m.default) ?? data.maps[0]!).id;
      if (cat === 'mode') return (data.modes.find((m) => m.default && m.playable) ?? data.modes.find((m) => m.playable)!).id;
      const all = options('era');
      return all[Math.floor(random() * all.length)]!;
    }
    const tied = [...counts.entries()].filter(([, n]) => n === top).map(([id]) => id).sort();
    return tied[Math.floor(random() * tied.length)]!;
  };

  const assignTeams = (): void => {
    const t = splitTeams(list.map((p) => ({ id: p.id, rp: p.rp, party: p.party })));
    for (const p of list) p.team = t[p.id] ?? null;
  };

  const teamCount = (team: Team): number => list.filter((p) => p.team === team).length;
  const smallerTeam = (): Team => (teamCount('blue') <= teamCount('red') ? 'blue' : 'red');

  const enter = (next: RoomPhase, now: number, seconds: number | null): void => {
    phase = next;
    endsAt = seconds === null ? null : now + seconds * 1000;
    changed();
  };

  const backToLobby = (): void => {
    phase = 'lobby';
    endsAt = null;
    overrides = {};
    choice = null;
    br = null;
    round++;
    for (const p of list) {
      p.ready = p.host;
      p.votes = {};
      p.locked = false;
      p.team = null;
      p.inMatch = false;
    }
    changed();
  };

  const room: Room = {
    get phase() {
      return phase;
    },
    get settings() {
      return settings;
    },
    get choice() {
      return choice;
    },
    get version() {
      return version;
    },
    get againCount() {
      return phase === 'results' ? list.filter((p) => !p.host && p.ready).length : 0;
    },
    players: () => list,
    get: (id) => list.find((p) => p.id === id),
    allowedPlane,
    defaultPlane,

    add(p) {
      const player: RoomPlayer = {
        id: p.id,
        name: p.name,
        host: p.host,
        pingMs: p.host ? 0 : null,
        device: p.device,
        ready: p.host,
        party: null,
        rp: Math.max(0, Math.min(1e7, Math.round(p.rp))),
        unlocked: cleanUnlocks(p.unlocked),
        team: null,
        planeId: null,
        locked: false,
        votes: {},
        inMatch: false,
      };
      // Late arrivals: after teams are drawn they join the smaller team and get a default plane.
      list.push(player);
      if (phase === 'teams' || phase === 'select' || phase === 'playing') {
        player.team = smallerTeam();
        if (choice) player.planeId = defaultPlane(player.id, choice.era);
      }
      changed();
      return player;
    },
    setProgress(id, rp, unlocked) {
      const p = room.get(id);
      if (!p) return;
      p.rp = Math.max(0, Math.min(1e7, Math.round(rp)));
      p.unlocked = cleanUnlocks(unlocked);
      changed();
    },
    remove(id) {
      const i = list.findIndex((p) => p.id === id);
      if (i < 0) return;
      const [gone] = list.splice(i, 1);
      if (gone?.party) {
        const rest = list.filter((p) => p.party === gone.party);
        if (rest.length === 1) rest[0]!.party = null;
      }
      changed();
    },
    setPing(id, ms) {
      const p = room.get(id);
      if (p && !p.host && p.pingMs !== ms) {
        p.pingMs = ms;
        changed();
      }
    },
    ready(id, ready) {
      const p = room.get(id);
      if (!p || phase !== 'lobby') return false;
      p.ready = ready;
      changed();
      return true;
    },
    party(id, withId) {
      const p = room.get(id);
      if (!p || phase !== 'lobby') return false;
      const leave = (): void => {
        const old = p.party;
        p.party = null;
        if (old) {
          const rest = list.filter((x) => x.party === old);
          if (rest.length === 1) rest[0]!.party = null;
        }
      };
      if (withId === null) {
        leave();
        changed();
        return true;
      }
      const target = room.get(withId);
      if (!target || target.id === p.id) return false;
      if (target.party && target.party === p.party) return true;
      const partyId = target.party ?? `party-${target.id}`;
      if (list.filter((x) => x.party === partyId).length >= PARTY_MAX) return false;
      leave();
      target.party = partyId;
      p.party = partyId;
      changed();
      return true;
    },
    vote(id, cat, option) {
      const p = room.get(id);
      if (!p || phase !== 'vote' || !options(cat).includes(option)) return false;
      p.votes[cat] = option;
      changed();
      return true;
    },
    override(cat, option) {
      if (phase !== 'vote') return false;
      if (option === null) delete overrides[cat];
      else if (options(cat).includes(option)) overrides[cat] = option;
      else return false;
      changed();
      return true;
    },
    pick(id, planeId, lock) {
      const p = room.get(id);
      if (!p || (phase !== 'select' && phase !== 'teams') || !allowedPlane(id, planeId)) return false;
      p.planeId = planeId;
      p.locked = lock && phase === 'select';
      changed();
      return true;
    },
    setSettings(s) {
      if (s.difficulty === 'easy' || s.difficulty === 'normal' || s.difficulty === 'hard') settings.difficulty = s.difficulty;
      if (typeof s.bots === 'boolean') settings.bots = s.bots;
      if (typeof s.matchLengthS === 'number' && Number.isFinite(s.matchLengthS)) settings.matchLengthS = Math.max(20, Math.min(3600, Math.round(s.matchLengthS)));
      changed();
    },
    startVote(now) {
      if (phase !== 'lobby' || list.length === 0) return false;
      for (const p of list) p.votes = {};
      overrides = {};
      enter('vote', now, VOTE_S);
      return true;
    },
    tick(now) {
      const due = endsAt !== null && now >= endsAt;
      if (phase === 'vote') {
        const everyone = list.every((p) => p.votes.era && p.votes.map && p.votes.mode);
        if (due || everyone) {
          choice = { era: decide('era') as EraId, mapId: decide('map'), mode: decide('mode') };
          assignTeams();
          for (const p of list) {
            p.locked = false;
            if (!p.planeId || !allowedPlane(p.id, p.planeId)) p.planeId = defaultPlane(p.id, choice.era);
          }
          enter('teams', now, TEAMS_S);
        }
      } else if (phase === 'teams') {
        if (due) enter('select', now, SELECT_S);
      } else if (phase === 'select') {
        if (due || list.every((p) => p.locked)) {
          for (const p of list) {
            if (!p.planeId || !allowedPlane(p.id, p.planeId)) p.planeId = defaultPlane(p.id, choice!.era);
            p.locked = true;
            p.inMatch = true;
            p.team ??= smallerTeam();
          }
          // A team can't hold more than 10 humans.
          for (const team of ['blue', 'red'] as Team[]) {
            const extra = list.filter((p) => p.team === team).slice(TEAM_SIZE);
            for (const p of extra) p.team = team === 'blue' ? 'red' : 'blue';
          }
          enter('playing', now, null);
          return 'start';
        }
      } else if (phase === 'results') {
        if (due) backToLobby();
      }
      return null;
    },
    setBr(b) {
      br = b;
      changed();
    },
    joinedMatch(id, team) {
      const p = room.get(id);
      if (!p) return;
      p.team = team;
      p.inMatch = true;
      changed();
    },
    matchEnded(now) {
      if (phase !== 'playing') return;
      // On the results screen "ready" means "clicked Play again".
      for (const p of list) p.ready = p.host;
      enter('results', now, RESULTS_S);
    },
    playAgain() {
      if (phase === 'results') backToLobby();
    },
    again(id) {
      const p = room.get(id);
      if (phase !== 'results' || !p) return;
      p.ready = true;
      changed();
    },
    state(now) {
      // In the lobby, show the teams as they would be drawn right now (parties included).
      const preview = phase === 'lobby' ? splitTeams(list.map((p) => ({ id: p.id, rp: p.rp, party: p.party }))) : null;
      return {
        phase,
        endsInMs: endsAt === null ? null : Math.max(0, endsAt - now),
        players: list.map((p) => ({ ...p, votes: { ...p.votes }, device: { ...p.device }, unlocked: { ...p.unlocked }, team: preview ? (preview[p.id] ?? null) : p.team })),
        settings: { ...settings },
        overrides: { ...overrides },
        choice: choice ? { ...choice } : null,
        br: br ? { ...br } : null,
        allUnlocked: opts.allUnlocked,
        round,
      };
    },
  };
  return room;
}

/** Live vote counts from a room state (clients and host draw the same numbers). */
export function voteCounts(room: RoomState, cat: VoteCategory): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of room.players) {
    const v = p.votes[cat];
    if (v) out[v] = (out[v] ?? 0) + 1;
  }
  return out;
}
