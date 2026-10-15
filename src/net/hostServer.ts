// The authoritative host. It owns the room (lobby, vote, teams, plane select, results; see room.ts) and runs
// the real match (bots included). It is the only one that decides hits, damage, kills and scores. Clients
// only send ControlInput and requests (ready, vote, pick a plane…), which are validated here.
import type { GameData } from '../data/types';
import { neutralInput, type ControlInput } from '../game/controls';
import type { Team } from '../game/flight';
import { addHumanToMatch, botTakeOver, createMatch, rebalanceBots, stepMatch, type Match } from '../game/match';
import { computeResults, type MatchResults } from '../game/results';
import { cleanUnlocks } from '../game/unlocks';
import { lockSeeker, missileTypeIds } from '../game/missiles';
import { createWorldContext, type GameEvent, type WorldContext } from '../game/world';
import {
  CHAT_MAX,
  cleanCallsign,
  decodeInput,
  decodeJson,
  decodePing,
  encodeJson,
  encodePing,
  encodeSnapshot,
  messageType,
  MSG_INPUT,
  MSG_PING,
  MSG_PONG,
  NO_WEAPONS,
  SNAPSHOT_HZ,
  VOTE_CATEGORIES,
  type ClientMsg,
  type DeviceInfo,
  type HostMsg,
  type RoomPhase,
  type RoomSettings,
  type RoomState,
  type RosterEntry,
  type SnapshotContext,
  type VoteCategory,
} from './protocol';
import { createRoom, type Room } from './room';
import { payloadBytes, type Channel, type HostTransport, type Payload } from './transport';

export const MAX_PLAYERS = 20;
export const TAKEOVER_S = 10;
const MAX_INPUTS_PER_S = 70; // clients send 30/s; anything far above that is ignored
const MAX_REQUESTS_PER_S = 10; // lobby requests (votes, picks, chat…)
const CHAT_PER_S = 1;
const SILENCE_MS = 8000;

interface ClientRec {
  peerId: string;
  playerId: string;
  name: string;
  welcomed: boolean;
  isHost: boolean;
  lastSeq: number;
  input: ControlInput;
  tokens: number;
  requests: number;
  chat: number;
  connected: boolean;
  leftAt: number;
  inMatch: boolean;
  /** Firebase user id (null when that player is offline), listed in the match record. */
  uid: string | null;
  lastHeard: number;
}

export interface HostOptions {
  version: string;
  settings: RoomSettings;
  /** The host runs with ?debug=1: every plane may be picked. */
  allUnlocked: boolean;
  /** Debug: override the match length (?matchtime=30). */
  matchTimeS?: number;
  killLimit?: number;
  /** Saves each match to Firestore (main.ts wires the profile store; tests leave it out). */
  record?: MatchRecorder;
  /** Peer id of the host's own loopback client, so it can be marked as the host. */
  hostPeerId?: string;
  now?: () => number;
  random?: () => number;
}

/** The host's side of saving progress: create the match record with every human's uid, add late joiners. */
export interface MatchRecorder {
  /** Returns the match id sent to every player (they save their own result under it), or null when offline. */
  start(uids: string[]): string | null;
  join(matchId: string, uid: string): void;
}

const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export interface NetCounters {
  bytesIn: number;
  bytesOut: number;
  /** Input packets accepted (after rate limiting and sequence checks). */
  inputsAccepted: number;
}

export interface HostServer {
  readonly phase: RoomPhase;
  readonly match: Match | null;
  readonly ctx: WorldContext | null;
  readonly counters: NetCounters;
  /** The latest input from a remote player (tests and debugging). */
  inputOf(playerId: string): ControlInput | null;
  readonly results: MatchResults | null;
  room(): RoomState;
  // Host-only controls (the host's UI calls these directly).
  startVote(): boolean;
  override(cat: VoteCategory, id: string | null): void;
  setSettings(s: Partial<RoomSettings>): void;
  kick(playerId: string): void;
  playAgain(): void;
  tick(dt: number): void;
  close(): void;
}

const cleanChat = (raw: unknown): string =>
  typeof raw === 'string' ? raw.replace(/[<>&"'`\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX) : '';

export function createHostServer(data: GameData, transport: HostTransport, opts: HostOptions): HostServer {
  const now = opts.now ?? (() => performance.now());
  const random = opts.random ?? Math.random;
  const clients = new Map<string, ClientRec>();
  const counters: NetCounters = { bytesIn: 0, bytesOut: 0, inputsAccepted: 0 };
  const room: Room = createRoom(data, { allUnlocked: opts.allUnlocked, settings: opts.settings, random });
  let match: Match | null = null;
  let ctx: WorldContext | null = null;
  let results: MatchResults | null = null;
  let matchId: string | null = null;
  let matchUids: string[] = [];
  let rosterVersion = 0;
  const rosterPlanes = new Map<string, string>();
  let nextPlayer = 1;
  let tickCount = 0;
  let pingId = 0;
  let lastPing = 0;
  let lastStats = 0;
  let sentVersion = 0;
  let lastRoomSent = 0;

  const send = (peerId: string, channel: Channel, data: Payload): void => {
    counters.bytesOut += payloadBytes(data);
    transport.send(peerId, channel, data);
  };
  const sendMsg = (peerId: string, m: HostMsg): void => send(peerId, 'reliable', encodeJson(m));
  const broadcast = (m: HostMsg, filter: (c: ClientRec) => boolean = (c) => c.welcomed && c.connected): void => {
    const data = encodeJson(m);
    for (const c of clients.values()) if (filter(c)) send(c.peerId, 'reliable', data);
  };
  const inMatch = (c: ClientRec): boolean => c.inMatch && c.connected;
  const byPlayer = (id: string): ClientRec | undefined => [...clients.values()].find((c) => c.playerId === id);

  const roster = (): RosterEntry[] => (match ? match.world.planes.map((p) => ({ id: p.id, planeId: p.planeId, team: p.team })) : []);
  const pilots = () => (match ? Object.values(match.world.pilots) : []);
  const sendRoster = (): void => {
    rosterVersion = (rosterVersion + 1) & 0xff;
    rosterPlanes.clear();
    if (match) for (const p of match.world.planes) rosterPlanes.set(p.id, p.planeId);
    broadcast({ t: 'roster', rosterVersion, roster: roster(), pilots: pilots() }, inMatch);
  };

  const sendStart = (c: ClientRec): void => {
    if (!match || !ctx || !room.choice) return;
    sendMsg(c.peerId, {
      t: 'start',
      matchId,
      uids: matchUids,
      era: room.choice.era,
      mapId: room.choice.mapId,
      you: c.playerId,
      rosterVersion,
      roster: roster(),
      pilots: pilots(),
      killLimit: match.world.match.killLimit,
      tick: match.world.tick,
    });
    c.inMatch = true;
  };

  const teamBr = (m: Match, c: WorldContext): Record<Team, number> => {
    const br = { blue: 0, red: 0 };
    for (const p of m.world.planes) br[p.team] += c.planeDefs.get(p.planeId)?.br ?? 0;
    return { blue: Math.round(br.blue * 10) / 10, red: Math.round(br.red * 10) / 10 };
  };

  const startMatch = (): void => {
    const choice = room.choice;
    if (!choice) return;
    ctx = createWorldContext(data, choice.mapId);
    const killLimit = opts.killLimit ?? data.modes.find((m) => m.id === choice.mode)?.killLimit;
    const players = room.players();
    match = createMatch(ctx, {
      era: choice.era,
      difficulty: room.settings.difficulty,
      humans: players.map((p) => ({ id: p.id, name: p.name, planeId: p.planeId!, team: p.team ?? 'blue' })),
      bots: room.settings.bots,
      timeLimitS: opts.matchTimeS ?? room.settings.matchLengthS,
      ...(killLimit ? { killLimit } : {}),
      spawnRules: true,
    });
    results = null;
    const uids = [...clients.values()].filter((c) => c.welcomed && c.uid && room.get(c.playerId)).map((c) => c.uid!);
    matchUids = [...new Set(uids)];
    matchId = opts.record && matchUids.length > 0 ? opts.record.start(matchUids) : null;
    room.setBr(teamBr(match, ctx));
    rosterVersion = (rosterVersion + 1) & 0xff;
    rosterPlanes.clear();
    for (const p of match.world.planes) rosterPlanes.set(p.id, p.planeId);
    for (const c of clients.values()) {
      c.inMatch = false;
      c.lastSeq = 0;
      c.input = neutralInput();
      if (c.welcomed && c.connected && room.get(c.playerId)) sendStart(c);
    }
  };

  /** A newcomer during a match takes a bot's seat on the team with fewer humans. */
  const joinInProgress = (c: ClientRec): void => {
    if (!match || !ctx || !room.choice) return;
    const p = room.get(c.playerId);
    if (!p) return;
    const planeId = p.planeId && room.allowedPlane(p.id, p.planeId) ? p.planeId : room.defaultPlane(p.id, room.choice.era);
    const team = addHumanToMatch(match, ctx, { id: c.playerId, name: c.name, planeId });
    if (!team) {
      sendMsg(c.peerId, { t: 'reject', reason: 'This match is full.' });
      setTimeout(() => transport.kick(c.peerId), 400);
      return;
    }
    room.joinedMatch(c.playerId, team);
    if (matchId && c.uid && !matchUids.includes(c.uid)) {
      matchUids.push(c.uid);
      opts.record?.join(matchId, c.uid);
    }
    rebalanceBots(match, ctx);
    room.setBr(teamBr(match, ctx));
    sendRoster();
    sendStart(c);
  };

  const onHello = (c: ClientRec, m: Extract<ClientMsg, { t: 'hello' }>): void => {
    if (c.welcomed) return;
    if (m.version !== opts.version) {
      sendMsg(c.peerId, { t: 'reject', reason: `Different game version (host ${opts.version}, you ${String(m.version)}). Reload the page.` });
      setTimeout(() => transport.kick(c.peerId), 400);
      return;
    }
    if (room.players().length >= MAX_PLAYERS) {
      sendMsg(c.peerId, { t: 'reject', reason: 'This room is full.' });
      setTimeout(() => transport.kick(c.peerId), 400);
      return;
    }
    c.name = cleanCallsign(m.callsign);
    const device: DeviceInfo = { touch: Boolean(m.device?.touch), connection: typeof m.device?.connection === 'string' ? m.device.connection.slice(0, 16) : null };
    c.welcomed = true;
    c.isHost = c.peerId === opts.hostPeerId;
    const rp = typeof m.rp === 'number' && Number.isFinite(m.rp) ? m.rp : 0;
    c.uid = typeof m.uid === 'string' && UID_RE.test(m.uid) ? m.uid : null;
    room.add({ id: c.playerId, name: c.name, host: c.isHost, device, rp, unlocked: cleanUnlocks(m.unlocked) });
    const hostName = room.players().find((p) => p.host)?.name ?? c.name;
    sendMsg(c.peerId, { t: 'welcome', playerId: c.playerId, version: opts.version, hostName });
    sendMsg(c.peerId, { t: 'room', room: room.state(now()) });
    if (room.phase === 'playing') joinInProgress(c);
    if (room.phase === 'results' && results) sendMsg(c.peerId, { t: 'results', results });
  };

  const onRequest = (c: ClientRec, m: ClientMsg): void => {
    if (!c.welcomed) return;
    if (c.requests < 1) return;
    c.requests -= 1;
    const id = c.playerId;
    switch (m.t) {
      case 'ready':
        room.ready(id, Boolean(m.ready));
        break;
      case 'party':
        room.party(id, typeof m.with === 'string' ? m.with : null);
        break;
      case 'vote':
        if (VOTE_CATEGORIES.includes(m.cat) && typeof m.id === 'string') room.vote(id, m.cat, m.id);
        break;
      case 'pick':
        if (typeof m.planeId === 'string') room.pick(id, m.planeId, Boolean(m.lock));
        break;
      case 'respawn':
        if (match && ctx && room.phase === 'playing' && typeof m.planeId === 'string' && room.allowedPlane(id, m.planeId) && match.world.pilots[id] && !match.world.pilots[id]!.bot) {
          match.world.respawnPlane[id] = m.planeId;
          const p = room.get(id);
          if (p) p.planeId = m.planeId;
          // Bots re-pick at their next respawn so the teams stay even.
          rebalanceBots(match, ctx);
        }
        break;
      case 'again':
        room.again(id);
        break;
      case 'chat': {
        if (c.chat < 1) return;
        c.chat -= 1;
        const text = cleanChat(m.text);
        if (text) broadcast({ t: 'chat', from: c.name, team: room.get(id)?.team ?? null, text });
        break;
      }
      case 'profile':
        if (typeof m.rp === 'number' && Number.isFinite(m.rp)) room.setProgress(id, m.rp, cleanUnlocks(m.unlocked));
        break;
      case 'hello':
        break;
    }
  };

  transport.onPeer((peerId) => {
    clients.set(peerId, {
      peerId,
      playerId: `h${nextPlayer++}`,
      name: 'Pilot',
      welcomed: false,
      isHost: false,
      lastSeq: 0,
      input: neutralInput(),
      tokens: MAX_INPUTS_PER_S,
      requests: MAX_REQUESTS_PER_S,
      chat: 3,
      connected: true,
      leftAt: 0,
      inMatch: false,
      uid: null,
      lastHeard: now(),
    });
  });

  transport.onPeerLeft((peerId) => {
    const c = clients.get(peerId);
    if (!c) return;
    c.connected = false;
    c.leftAt = now();
    c.input = neutralInput(c.input.throttle);
    room.remove(c.playerId);
    // Mid-match their plane flies on (hands off) and a bot takes over after 10 s.
    if (!(c.inMatch && match && room.phase === 'playing')) clients.delete(peerId);
  });

  transport.onMessage((peerId, _channel, data) => {
    const c = clients.get(peerId);
    if (!c) return;
    counters.bytesIn += payloadBytes(data);
    c.lastHeard = now();
    if (typeof data === 'string') {
      const m = decodeJson<ClientMsg>(data);
      if (!m) return;
      if (m.t === 'hello') onHello(c, m);
      else onRequest(c, m);
      return;
    }
    const type = messageType(data);
    if (type === MSG_INPUT) {
      if (!c.welcomed || !c.inMatch || room.phase !== 'playing') return;
      if (c.tokens < 1) return; // flooding: drop
      c.tokens -= 1;
      const decoded = decodeInput(data);
      if (!decoded || decoded.seq <= c.lastSeq) return; // late or duplicate packet
      c.lastSeq = decoded.seq;
      // The target arrives as a roster slot; the roster is the world's plane order.
      const target = decoded.targetSlot > 0 ? match?.world.planes[decoded.targetSlot - 1]?.id ?? null : null;
      c.input = { ...decoded.input, target };
      counters.inputsAccepted++;
    } else if (type === MSG_PING || type === MSG_PONG) {
      const p = decodePing(data);
      if (!p) return;
      if (p.type === MSG_PING) send(peerId, 'unreliable', encodePing(MSG_PONG, p.id, p.time));
      else room.setPing(c.playerId, Math.round(Math.max(0, now() - p.time)));
    }
  });

  const ticksPerSnapshot = Math.round(60 / SNAPSHOT_HZ);
  const snapshotContexts = new WeakMap<WorldContext, SnapshotContext>();
  const snapshotContext = (c: WorldContext): SnapshotContext => {
    let sc = snapshotContexts.get(c);
    if (!sc) {
      sc = { missileTypes: missileTypeIds(c.data), lockIsRadar: (p) => lockSeeker(c, p) === 'radar' };
      snapshotContexts.set(c, sc);
    }
    return sc;
  };

  const stepTheMatch = (m: Match, c: WorldContext, t: number, dt: number): void => {
    // Players who left more than 10 s ago are handed to a bot.
    for (const rec of [...clients.values()]) {
      if (!rec.connected && rec.inMatch && t - rec.leftAt > TAKEOVER_S * 1000) {
        botTakeOver(m, rec.playerId);
        clients.delete(rec.peerId);
        rebalanceBots(m, c);
        broadcast({ t: 'roster', rosterVersion, roster: roster(), pilots: pilots() }, inMatch);
      }
    }

    const inputs: Record<string, ControlInput> = {};
    for (const rec of clients.values()) if (rec.inMatch && !m.world.pilots[rec.playerId]?.bot) inputs[rec.playerId] = rec.input;
    stepMatch(m, c, inputs, dt);
    tickCount++;
    const w = m.world;

    // A respawn in a different plane (respawn screen, bot rebalancing, out of SP) changes the roster.
    if (w.events.some((e) => e.t === 'spawn' && rosterPlanes.get(e.id) !== w.planes.find((p) => p.id === e.id)?.planeId)) sendRoster();

    // Events: hits only to the two pilots involved; everything else to everyone.
    if (w.events.length > 0) {
      const general: GameEvent[] = [];
      const personal = new Map<string, GameEvent[]>();
      for (const e of w.events) {
        if (e.t === 'hit') {
          for (const id of [e.shooter, e.victim]) {
            const list = personal.get(id) ?? [];
            list.push(e);
            personal.set(id, list);
          }
        } else general.push(e);
      }
      for (const rec of clients.values()) {
        if (!inMatch(rec)) continue;
        const mine = personal.get(rec.playerId) ?? [];
        if (general.length + mine.length > 0) sendMsg(rec.peerId, { t: 'events', events: [...general, ...mine] });
      }
      if (w.events.some((e) => e.t === 'kill')) lastStats = 0;
    }
    if (t - lastStats > 1000) {
      lastStats = t;
      broadcast({ t: 'stats', stats: w.stats }, inMatch);
    }

    if (tickCount % ticksPerSnapshot === 0 || w.match.state === 'ended') {
      for (const rec of clients.values()) {
        if (!inMatch(rec)) continue;
        const own = w.planes.find((p) => p.id === rec.playerId);
        const snap = encodeSnapshot(
          { rosterVersion, tick: w.tick, ackSeq: rec.lastSeq, timeLeftS: w.match.timeLeftS, score: w.match.score, ended: w.match.state === 'ended' },
          w.planes,
          own ? { ammo: own.ammo, missiles: own.missiles, flares: own.flares, chaff: own.chaff, lockMount: own.lockMount } : NO_WEAPONS,
          w.missiles,
          snapshotContext(c),
        );
        send(rec.peerId, 'unreliable', snap);
      }
    }
    if (w.match.state === 'ended') {
      results = computeResults(w, room.state(t).br);
      broadcast({ t: 'stats', stats: w.stats }, inMatch);
      broadcast({ t: 'match', state: 'ended', winner: w.match.winner, score: w.match.score }, inMatch);
      broadcast({ t: 'results', results });
      room.matchEnded(t);
    }
  };

  const api: HostServer = {
    get phase() {
      return room.phase;
    },
    get match() {
      return match;
    },
    get ctx() {
      return ctx;
    },
    get results() {
      return results;
    },
    counters,
    inputOf(playerId) {
      for (const rec of clients.values()) if (rec.playerId === playerId) return rec.input;
      return null;
    },
    room: () => room.state(now()),
    startVote: () => room.startVote(now()),
    override: (cat, id) => {
      room.override(cat, id);
    },
    setSettings: (s) => room.setSettings(s),
    kick(playerId) {
      const c = byPlayer(playerId);
      if (!c || c.isHost) return;
      sendMsg(c.peerId, { t: 'reject', reason: 'The host removed you from the room.' });
      room.remove(playerId);
      if (match && ctx && c.inMatch) {
        botTakeOver(match, playerId);
        rebalanceBots(match, ctx);
        broadcast({ t: 'roster', rosterVersion, roster: roster(), pilots: pilots() }, inMatch);
      }
      c.inMatch = false;
      setTimeout(() => transport.kick(c.peerId), 300);
    },
    playAgain() {
      room.playAgain();
    },
    tick(dt) {
      const t = now();
      for (const c of clients.values()) {
        c.tokens = Math.min(MAX_INPUTS_PER_S, c.tokens + MAX_INPUTS_PER_S * dt);
        c.requests = Math.min(MAX_REQUESTS_PER_S, c.requests + MAX_REQUESTS_PER_S * dt);
        c.chat = Math.min(3, c.chat + CHAT_PER_S * dt);
      }
      // Clients answer pings every second; 8 s of silence means the connection died without a close.
      for (const c of clients.values()) {
        if (c.connected && c.welcomed && !c.isHost && t - c.lastHeard > SILENCE_MS) transport.kick(c.peerId);
      }
      if (t - lastPing > 1000) {
        lastPing = t;
        for (const c of clients.values()) if (c.welcomed && c.connected && !c.isHost) send(c.peerId, 'unreliable', encodePing(MSG_PING, pingId++, t));
      }

      const wasPhase = room.phase;
      if (room.tick(t) === 'start') startMatch();
      if (wasPhase === 'results' && room.phase === 'lobby') {
        match = null;
        for (const [peerId, c] of clients) {
          c.inMatch = false;
          if (!c.connected) clients.delete(peerId);
        }
      }
      if (match && ctx && room.phase === 'playing') stepTheMatch(match, ctx, t, dt);

      // The room goes out when it changes (at most 10/s) and once a second for pings and timers.
      if ((room.version !== sentVersion && t - lastRoomSent > 100) || t - lastRoomSent > 1000) {
        sentVersion = room.version;
        lastRoomSent = t;
        broadcast({ t: 'room', room: room.state(t) });
      }
    },
    close() {
      transport.close();
    },
  };
  return api;
}
