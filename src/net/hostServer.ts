// The authoritative host. It runs the real match (bots included) and is the only one that decides hits,
// damage, kills and scores. Clients only ever send ControlInput, which is validated and clamped here.
import type { EraId } from '../data/types';
import { neutralInput, type ControlInput } from '../game/controls';
import { addHumanToMatch, botTakeOver, createMatch, stepMatch, type HumanSlot, type Match } from '../game/match';
import type { BotDifficulty, GameEvent, WorldContext } from '../game/world';
import {
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
  SNAPSHOT_HZ,
  type ClientMsg,
  type DeviceInfo,
  type HostMsg,
  type LobbyPlayer,
  type RosterEntry,
} from './protocol';
import { payloadBytes, type Channel, type HostTransport, type Payload } from './transport';

export const MAX_PLAYERS = 20;
export const TAKEOVER_S = 10;
const MAX_INPUTS_PER_S = 70; // clients send 30/s; anything far above that is ignored

interface ClientRec {
  peerId: string;
  playerId: string;
  name: string;
  device: DeviceInfo;
  welcomed: boolean;
  isHost: boolean;
  lastSeq: number;
  input: ControlInput;
  tokens: number;
  pingMs: number | null;
  connected: boolean;
  leftAt: number;
  inMatch: boolean;
  lastHeard: number;
}

export interface HostOptions {
  version: string;
  era: EraId;
  mapId: string;
  difficulty: BotDifficulty;
  /** Picks the plane a newly joined player flies (Day 6 adds a plane picker). */
  planeFor(playerIndex: number): string;
  timeLimitS?: number;
  killLimit?: number;
  /** Peer id of the host's own loopback client, so it can be marked as the host in the lobby. */
  hostPeerId?: string;
  now?: () => number;
}

export interface NetCounters {
  bytesIn: number;
  bytesOut: number;
  /** Input packets accepted (after rate limiting and sequence checks). */
  inputsAccepted: number;
}

export interface HostServer {
  readonly state: 'lobby' | 'playing' | 'ended';
  readonly match: Match | null;
  readonly counters: NetCounters;
  lobby(): LobbyPlayer[];
  start(): void;
  tick(dt: number): void;
  setDifficulty(d: BotDifficulty): void;
  close(): void;
}

export function createHostServer(ctx: WorldContext, transport: HostTransport, opts: HostOptions): HostServer {
  const now = opts.now ?? (() => performance.now());
  const clients = new Map<string, ClientRec>();
  const counters: NetCounters = { bytesIn: 0, bytesOut: 0, inputsAccepted: 0 };
  let state: 'lobby' | 'playing' | 'ended' = 'lobby';
  let match: Match | null = null;
  let rosterVersion = 0;
  let nextPlayer = 1;
  let tickCount = 0;
  let pingId = 0;
  let lastLobbySent = 0;
  let lastPing = 0;
  let lastStats = 0;
  let difficulty = opts.difficulty;

  const send = (peerId: string, channel: Channel, data: Payload): void => {
    counters.bytesOut += payloadBytes(data);
    transport.send(peerId, channel, data);
  };
  const sendMsg = (peerId: string, m: HostMsg): void => send(peerId, 'reliable', encodeJson(m));
  const broadcast = (m: HostMsg, filter: (c: ClientRec) => boolean = (c) => c.welcomed && c.connected): void => {
    const data = encodeJson(m);
    for (const c of clients.values()) if (filter(c)) send(c.peerId, 'reliable', data);
  };

  const lobbyPlayers = (): LobbyPlayer[] =>
    [...clients.values()]
      .filter((c) => c.welcomed && c.connected)
      .map((c) => ({ id: c.playerId, name: c.name, host: c.isHost, pingMs: c.isHost ? 0 : c.pingMs, device: c.device }));

  const roster = (): RosterEntry[] => (match ? match.world.planes.map((p) => ({ id: p.id, planeId: p.planeId, team: p.team })) : []);
  const pilots = () => (match ? Object.values(match.world.pilots) : []);

  const sendStart = (c: ClientRec): void => {
    if (!match) return;
    sendMsg(c.peerId, {
      t: 'start',
      era: opts.era,
      mapId: opts.mapId,
      you: c.playerId,
      rosterVersion,
      roster: roster(),
      pilots: pilots(),
      killLimit: match.world.match.killLimit,
      tick: match.world.tick,
    });
    c.inMatch = true;
  };

  const humanSlot = (c: ClientRec, index: number): HumanSlot => ({ id: c.playerId, name: c.name, planeId: opts.planeFor(index) });

  const onHello = (c: ClientRec, m: Extract<ClientMsg, { t: 'hello' }>): void => {
    if (c.welcomed) return;
    if (m.version !== opts.version) {
      sendMsg(c.peerId, { t: 'reject', reason: `Different game version (host ${opts.version}, you ${String(m.version)}). Reload the page.` });
      setTimeout(() => transport.kick(c.peerId), 400);
      return;
    }
    const active = [...clients.values()].filter((x) => x.welcomed && x.connected).length;
    if (active >= MAX_PLAYERS) {
      sendMsg(c.peerId, { t: 'reject', reason: 'This room is full.' });
      setTimeout(() => transport.kick(c.peerId), 400);
      return;
    }
    c.name = cleanCallsign(m.callsign);
    c.device = { touch: Boolean(m.device?.touch), connection: typeof m.device?.connection === 'string' ? m.device.connection.slice(0, 16) : null };
    c.welcomed = true;
    c.isHost = c.peerId === opts.hostPeerId;
    sendMsg(c.peerId, { t: 'welcome', playerId: c.playerId, version: opts.version, hostName: [...clients.values()].find((x) => x.isHost)?.name ?? c.name });
    if (state === 'playing' && match) {
      const team = addHumanToMatch(match, ctx, humanSlot(c, nextPlayer));
      if (!team) {
        sendMsg(c.peerId, { t: 'reject', reason: 'This match is full.' });
        return;
      }
      rosterVersion = (rosterVersion + 1) & 0xff;
      broadcast({ t: 'roster', rosterVersion, roster: roster(), pilots: pilots() }, (x) => x.inMatch && x.connected);
      sendStart(c);
    }
    lastLobbySent = 0;
  };

  transport.onPeer((peerId) => {
    clients.set(peerId, {
      peerId,
      playerId: `h${nextPlayer++}`,
      name: 'Pilot',
      device: { touch: false, connection: null },
      welcomed: false,
      isHost: false,
      lastSeq: 0,
      input: neutralInput(),
      tokens: MAX_INPUTS_PER_S,
      pingMs: null,
      connected: true,
      leftAt: 0,
      inMatch: false,
      lastHeard: now(),
    });
  });

  transport.onPeerLeft((peerId) => {
    const c = clients.get(peerId);
    if (!c) return;
    c.connected = false;
    c.leftAt = now();
    c.input = neutralInput(c.input.throttle);
    if (state === 'lobby') clients.delete(peerId);
    lastLobbySent = 0;
  });

  transport.onMessage((peerId, channel, data) => {
    const c = clients.get(peerId);
    if (!c) return;
    counters.bytesIn += payloadBytes(data);
    c.lastHeard = now();
    if (typeof data === 'string') {
      const m = decodeJson<ClientMsg>(data);
      if (!m) return;
      if (m.t === 'hello') onHello(c, m);
      else if (m.t === 'chat' && c.welcomed) broadcast({ t: 'chat', from: c.name, text: cleanCallsign(m.text).slice(0, 80) });
      return;
    }
    const type = messageType(data);
    if (type === MSG_INPUT) {
      if (!c.welcomed || state !== 'playing') return;
      if (c.tokens < 1) return; // flooding: drop
      c.tokens -= 1;
      const decoded = decodeInput(data);
      if (!decoded || decoded.seq <= c.lastSeq) return; // late or duplicate packet
      c.lastSeq = decoded.seq;
      c.input = decoded.input;
      counters.inputsAccepted++;
    } else if (type === MSG_PING || type === MSG_PONG) {
      const p = decodePing(data);
      if (!p) return;
      if (p.type === MSG_PING) send(peerId, 'unreliable', encodePing(MSG_PONG, p.id, p.time));
      else c.pingMs = Math.max(0, now() - p.time);
    }
    void channel;
  });

  const ticksPerSnapshot = Math.round(60 / SNAPSHOT_HZ);

  const api: HostServer = {
    get state() {
      return state;
    },
    get match() {
      return match;
    },
    counters,
    lobby: lobbyPlayers,
    setDifficulty(d) {
      difficulty = d;
    },
    start() {
      if (state !== 'lobby') return;
      const humans = [...clients.values()].filter((c) => c.welcomed && c.connected);
      // The host plays blue first, then teams alternate.
      humans.sort((a, b) => Number(b.isHost) - Number(a.isHost));
      match = createMatch(ctx, {
        era: opts.era,
        difficulty,
        humans: humans.map((c, i) => humanSlot(c, i)),
        ...(opts.timeLimitS ? { timeLimitS: opts.timeLimitS } : {}),
        ...(opts.killLimit ? { killLimit: opts.killLimit } : {}),
      });
      state = 'playing';
      rosterVersion = 1;
      for (const c of humans) sendStart(c);
    },
    tick(dt) {
      const t = now();
      for (const c of clients.values()) c.tokens = Math.min(MAX_INPUTS_PER_S, c.tokens + MAX_INPUTS_PER_S * dt);

      // Clients answer pings every second; 8 s of silence means the connection died without a close.
      for (const c of clients.values()) {
        if (c.connected && c.welcomed && !c.isHost && t - c.lastHeard > 8000) transport.kick(c.peerId);
      }
      if (t - lastPing > 1000) {
        lastPing = t;
        for (const c of clients.values()) if (c.welcomed && c.connected && !c.isHost) send(c.peerId, 'unreliable', encodePing(MSG_PING, pingId++, t));
      }
      if (state === 'lobby') {
        if (t - lastLobbySent > 1000) {
          lastLobbySent = t;
          broadcast({ t: 'lobby', players: lobbyPlayers(), era: opts.era, mapId: opts.mapId });
        }
        return;
      }
      if (!match || state === 'ended') return;

      // Players who left more than 10 s ago are handed to a bot.
      for (const c of clients.values()) {
        if (!c.connected && c.inMatch && t - c.leftAt > TAKEOVER_S * 1000) {
          botTakeOver(match, c.playerId);
          clients.delete(c.peerId);
          broadcast({ t: 'roster', rosterVersion, roster: roster(), pilots: pilots() }, (x) => x.inMatch && x.connected);
        }
      }

      const inputs: Record<string, ControlInput> = {};
      for (const c of clients.values()) if (c.inMatch && !match.world.pilots[c.playerId]?.bot) inputs[c.playerId] = c.input;
      stepMatch(match, ctx, inputs, dt);
      tickCount++;
      const w = match.world;

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
        for (const c of clients.values()) {
          if (!c.inMatch || !c.connected) continue;
          const mine = personal.get(c.playerId) ?? [];
          if (general.length + mine.length > 0) sendMsg(c.peerId, { t: 'events', events: [...general, ...mine] });
        }
        if (w.events.some((e) => e.t === 'kill')) lastStats = 0;
      }
      if (t - lastStats > 1000) {
        lastStats = t;
        broadcast({ t: 'stats', stats: w.stats }, (c) => c.inMatch && c.connected);
      }

      if (tickCount % ticksPerSnapshot === 0 || w.match.state === 'ended') {
        for (const c of clients.values()) {
          if (!c.inMatch || !c.connected) continue;
          const own = w.planes.find((p) => p.id === c.playerId);
          const snap = encodeSnapshot(
            { rosterVersion, tick: w.tick, ackSeq: c.lastSeq, timeLeftS: w.match.timeLeftS, score: w.match.score, ended: w.match.state === 'ended' },
            w.planes,
            own?.ammo ?? [],
          );
          send(c.peerId, 'unreliable', snap);
        }
      }
      if (w.match.state === 'ended') {
        state = 'ended';
        broadcast({ t: 'stats', stats: w.stats }, (c) => c.inMatch && c.connected);
        broadcast({ t: 'match', state: 'ended', winner: w.match.winner, score: w.match.score }, (c) => c.inMatch && c.connected);
      }
    },
    close() {
      transport.close();
    },
  };
  return api;
}
