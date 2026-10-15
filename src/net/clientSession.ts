// A networked player (including the host's own player, over a zero-delay loopback).
//
// * Own plane: predicted locally with the same flight model, then reconciled with every snapshot
//   (reset to the host's state, replay inputs the host hasn't acknowledged yet, smooth out the jump).
// * Other planes: drawn 100 ms in the past, interpolated between snapshots; extrapolated with velocity
//   for up to 250 ms when packets go missing.
// * Bullets: never sent. Each plane's "firing" flag drives local cosmetic tracers; the host decides hits.
import type { GameData } from '../data/types';
import { fireGuns, stepBullets, type HitSpheres } from '../game/ballistics';
import { neutralInput, type ControlInput } from '../game/controls';
import { edgeTurnInput, stepPlane, type PlaneState, type Team } from '../game/flight';
import type { Quat, Vec3 } from '../game/math';
import { addPilot, createWorld, createWorldContext, spawnPlane, type GameEvent, type PilotStats, type WorldContext, type WorldState } from '../game/world';
import { lerp, nlerpQuat, type NetStats, type RenderPose, type Session } from '../app/session';
import type { MatchResults } from '../game/results';
import {
  decodeJson,
  decodePing,
  decodeSnapshot,
  encodeInput,
  encodeJson,
  encodePing,
  INPUT_HZ,
  messageType,
  MSG_PING,
  MSG_PONG,
  MSG_SNAPSHOT,
  SNAPSHOT_HZ,
  type ClientMsg,
  type DeviceInfo,
  type HostMsg,
  type RoomState,
  type RosterEntry,
  type Snapshot,
  type SnapshotPlane,
} from './protocol';
import { payloadBytes, type ClientTransport } from './transport';

export const INTERP_DELAY_TICKS = 6; // 100 ms at 60 Hz
export const MAX_EXTRAPOLATE_TICKS = 15; // 250 ms
const TICK_HZ = 60;
const TICKS_PER_INPUT = Math.round(TICK_HZ / INPUT_HZ);
const SNAP_TICKS = Math.round(TICK_HZ / SNAPSHOT_HZ);
const SMOOTH_RATE = 10; // how fast prediction corrections are blended away (1/s)
const SNAP_DISTANCE = 60; // corrections bigger than this snap instead of blending

interface Buffered {
  tick: number;
  p: SnapshotPlane;
}

export type ClientPhase = 'connecting' | 'lobby' | 'playing' | 'ended' | 'closed' | 'rejected';

export interface ChatLine {
  from: string;
  team: Team | null;
  text: string;
}

export interface ClientEvents {
  onWelcome?(playerId: string, hostName: string): void;
  /** The host's room changed (phase, players, votes, timers). */
  onRoom?(room: RoomState): void;
  onStart?(session: ClientSession): void;
  onResults?(results: MatchResults): void;
  onChat?(line: ChatLine): void;
  onReject?(reason: string): void;
  onClosed?(): void;
}

export interface ClientSession extends Session {
  readonly phase: ClientPhase;
  readonly room: RoomState | null;
  /** Milliseconds left on the room's phase timer, counted down locally between updates. */
  timeLeftMs(): number | null;
  readonly results: MatchResults | null;
  readonly chat: readonly ChatLine[];
  readonly rejectReason: string | null;
  /** Ask the host for something (ready, vote, pick a plane, chat…). */
  request(m: ClientMsg): void;
  /** Feed real time to the session while not in a match (lobby pings, stats). */
  idle(dt: number): void;
}

export function createClientSession(
  transport: ClientTransport,
  data: GameData,
  opts: { version: string; callsign: string; device: DeviceInfo; rp?: number; now?: () => number; assist?: number },
  events: ClientEvents = {},
): ClientSession {
  const now = opts.now ?? (() => performance.now());
  let phase: ClientPhase = 'connecting';
  let playerId = '';
  let ctx: WorldContext | null = null;
  let world: WorldState | null = null;
  let roster: RosterEntry[] = [];
  let rosterVersion = 0;
  let respawnChoice: string | null = null;
  let room: RoomState | null = null;
  let roomAt = 0;
  let results: MatchResults | null = null;
  const chat: ChatLine[] = [];
  let rejectReason: string | null = null;
  let ended: Session['ended'] = null;
  const pendingEvents: GameEvent[] = [];

  // Snapshot buffers per plane id, newest last.
  const buffers = new Map<string, Buffered[]>();
  let latest: Snapshot | null = null;
  let serverTick = 0; // our running estimate of the host's current tick
  let synced = false;

  // Prediction.
  let own: PlaneState | null = null;
  let seq = 0;
  let current: ControlInput = neutralInput();
  let tickInInput = 0;
  const history: { seq: number; input: ControlInput }[] = [];
  const smooth = { pos: [0, 0, 0] as Vec3 };
  const prevPose = new Map<string, RenderPose>();

  // Stats.
  let bytesIn = 0;
  let bytesOut = 0;
  let snapCount = 0;
  let snapsExpected = 0;
  let snapsGot = 0;
  let lastSnapTick = -1;
  let pingMs: number | null = null;
  let pingId = 0;
  let lastPing = 0;
  let windowStart = now();
  let lastHeard = now();
  const SILENCE_MS = 8000; // the host pings every second; this long without a word means it's gone
  const stats: NetStats = { pingMs: null, loss: 0, snapshotsPerS: 0, bytesInPerS: 0, bytesOutPerS: 0 };

  const send = (channel: 'reliable' | 'unreliable', d: ArrayBuffer | string): void => {
    bytesOut += payloadBytes(d);
    transport.send(channel, d);
  };

  const buildWorld = (mapId: string, r: RosterEntry[], pilots: { id: string; name: string; team: Team; bot: boolean }[]): void => {
    ctx = createWorldContext(data, mapId);
    const w = createWorld(ctx);
    for (const p of pilots) addPilot(w, p);
    for (const e of r) spawnPlane(w, ctx, { id: e.id, team: e.team, planeId: e.planeId, assist: e.id === playerId ? (opts.assist ?? 0) : 0 });
    w.events = [];
    w.match = { mode: 'tdm', timeLeftS: 600, killLimit: 50, score: { red: 0, blue: 0 }, state: 'playing', winner: null };
    world = w;
    own = w.planes.find((p) => p.id === playerId) ?? null;
    buffers.clear();
    prevPose.clear();
  };

  const applyRoster = (r: RosterEntry[], pilots: { id: string; name: string; team: Team; bot: boolean }[]): void => {
    if (!world || !ctx) return;
    const w = world;
    const byId = new Map(w.planes.map((p) => [p.id, p]));
    // A plane that came back as a different type is rebuilt (its state arrives with the next snapshot).
    w.planes = r.map((e) => {
      const p = byId.get(e.id);
      return p && p.planeId === e.planeId ? p : spawnPlane(w, ctx!, { id: e.id, team: e.team, planeId: e.planeId });
    });
    for (const p of pilots) addPilot(w, p);
    for (const p of pilots) w.pilots[p.id] = p;
    for (const id of Object.keys(w.pilots)) if (!pilots.some((p) => p.id === id)) delete w.pilots[id];
    w.events = [];
    own = w.planes.find((p) => p.id === playerId) ?? null;
  };

  const copyFromSnapshot = (target: PlaneState, s: SnapshotPlane, kinematics: boolean): void => {
    if (kinematics) {
      target.pos = [...s.pos];
      target.quat = [...s.quat];
      target.vel = [...s.vel];
    }
    target.alive = s.alive;
    target.wreck = s.wreck;
    target.firing = s.firing;
    target.stalled = s.stalled;
    target.fireFor = s.onFire ? Math.max(target.fireFor, 1) : 0;
    target.protectedFor = s.protectedNow ? Math.max(target.protectedFor, 0.5) : 0;
    target.autoTurn = s.autoTurn;
    target.edgeWarning = s.edgeWarning;
    target.damaged = { ...s.damaged };
    target.hp = s.hp;
    target.respawnIn = s.respawnIn;
    target.g = s.g;
    if (kinematics) target.throttle = s.throttle;
  };

  /** Advance our own plane one tick with an input, exactly as the host's world does. */
  const predictTick = (p: PlaneState, input: ControlInput, dt: number): void => {
    if (!ctx || !p.alive) return;
    const params = ctx.params.get(p.planeId);
    if (!params) return;
    const used = p.autoTurn ? edgeTurnInput(p, input) : input;
    stepPlane(p, used, params, { surfaceAt: ctx.terrain.surfaceAt, half: ctx.terrain.half }, dt);
    if (!p.alive) {
      // Let the host decide crashes; keep flying until it says so.
      p.alive = true;
    }
  };

  const reconcile = (s: Snapshot, index: number): void => {
    if (!own || !ctx) return;
    const sp = s.planes[index];
    if (!sp) return;
    const before: Vec3 = [...own.pos];
    const wasAlive = own.alive;
    copyFromSnapshot(own, sp, true);
    own.ammo = s.ownAmmo.length ? [...s.ownAmmo] : own.ammo;
    while (history.length && history[0]!.seq <= s.ackSeq) history.shift();
    if (own.alive) {
      // Replay what the host hasn't seen yet: each input lasted TICKS_PER_INPUT ticks.
      for (const h of history) for (let k = 0; k < TICKS_PER_INPUT; k++) predictTick(own, h.input, 1 / TICK_HZ);
      const err: Vec3 = [before[0] - own.pos[0], before[1] - own.pos[1], before[2] - own.pos[2]];
      const errLen = Math.hypot(err[0], err[1], err[2]);
      if (wasAlive && errLen < SNAP_DISTANCE) {
        smooth.pos[0] += err[0];
        smooth.pos[1] += err[1];
        smooth.pos[2] += err[2];
      } else smooth.pos = [0, 0, 0];
    } else {
      history.length = 0;
      smooth.pos = [0, 0, 0];
    }
  };

  const onSnapshot = (s: Snapshot): void => {
    if (!world || s.rosterVersion !== rosterVersion) return;
    snapCount++;
    if (lastSnapTick >= 0 && s.tick > lastSnapTick) {
      const gap = Math.round((s.tick - lastSnapTick) / SNAP_TICKS);
      snapsExpected += Math.max(1, gap);
      snapsGot += 1;
    }
    if (s.tick <= lastSnapTick) return; // out of order: older than what we have
    lastSnapTick = s.tick;
    latest = s;
    // Clock: snap the estimate on the first snapshot, then nudge it toward each new one.
    if (!synced) {
      serverTick = s.tick;
      synced = true;
    } else {
      serverTick += (s.tick - serverTick) * 0.1;
      if (Math.abs(s.tick - serverTick) > 30) serverTick = s.tick;
    }
    world.match.timeLeftS = s.timeLeftS;
    world.match.score = { ...s.score };
    s.planes.forEach((p, i) => {
      const id = roster[i]?.id;
      if (!id) return;
      const buf = buffers.get(id) ?? [];
      buf.push({ tick: s.tick, p });
      while (buf.length > 30) buf.shift();
      buffers.set(id, buf);
      if (id === playerId) reconcile(s, i);
    });
  };

  const onHostMsg = (m: HostMsg): void => {
    switch (m.t) {
      case 'welcome':
        playerId = m.playerId;
        phase = 'lobby';
        events.onWelcome?.(m.playerId, m.hostName);
        break;
      case 'reject':
        rejectReason = m.reason;
        phase = 'rejected';
        events.onReject?.(m.reason);
        break;
      case 'room':
        room = m.room;
        roomAt = now();
        if (phase === 'ended' && m.room.phase !== 'playing') phase = 'lobby';
        events.onRoom?.(m.room);
        break;
      case 'results':
        results = m.results;
        events.onResults?.(m.results);
        break;
      case 'start':
        // A new round on the same connection: forget everything about the last match.
        ended = null;
        latest = null;
        synced = false;
        lastSnapTick = -1;
        history.length = 0;
        tickInInput = 0;
        smooth.pos = [0, 0, 0];
        pendingEvents.length = 0;
        results = null;
        respawnChoice = null;
        playerId = m.you;
        roster = m.roster;
        rosterVersion = m.rosterVersion;
        buildWorld(m.mapId, m.roster, m.pilots);
        if (world) world.match.killLimit = m.killLimit;
        serverTick = m.tick;
        phase = 'playing';
        events.onStart?.(api);
        break;
      case 'roster':
        roster = m.roster;
        rosterVersion = m.rosterVersion;
        applyRoster(m.roster, m.pilots);
        break;
      case 'events':
        pendingEvents.push(...m.events);
        break;
      case 'stats':
        if (world) for (const [id, st] of Object.entries(m.stats)) world.stats[id] = st as PilotStats;
        break;
      case 'match':
        if (world) {
          world.match.state = m.state;
          world.match.winner = m.winner;
          world.match.score = m.score;
        }
        if (m.state === 'ended') {
          ended = 'finished';
          phase = 'ended';
        }
        break;
      case 'chat': {
        const line = { from: String(m.from).slice(0, 16), team: m.team === 'red' || m.team === 'blue' ? m.team : null, text: String(m.text).slice(0, 80) };
        chat.push(line);
        while (chat.length > 30) chat.shift();
        events.onChat?.(line);
        break;
      }
    }
  };

  transport.onMessage((_channel, d) => {
    bytesIn += payloadBytes(d);
    lastHeard = now();
    if (typeof d === 'string') {
      const m = decodeJson<HostMsg>(d);
      if (m) onHostMsg(m);
      return;
    }
    const type = messageType(d);
    if (type === MSG_SNAPSHOT) {
      const s = decodeSnapshot(d);
      if (s) onSnapshot(s);
    } else if (type === MSG_PING || type === MSG_PONG) {
      const p = decodePing(d);
      if (!p) return;
      if (p.type === MSG_PING) send('unreliable', encodePing(MSG_PONG, p.id, p.time));
      else pingMs = pingMs === null ? now() - p.time : pingMs * 0.7 + (now() - p.time) * 0.3;
    }
  });
  transport.onClose(() => {
    if (phase === 'ended' || phase === 'rejected') return;
    if (phase === 'playing') ended = 'hostLeft';
    phase = 'closed';
    events.onClosed?.();
  });

  send('reliable', encodeJson({ t: 'hello', callsign: opts.callsign, version: opts.version, device: opts.device, rp: opts.rp ?? 0 }));

  const updateStats = (): void => {
    const t = now();
    if ((phase === 'playing' || phase === 'lobby' || phase === 'ended') && t - lastHeard > SILENCE_MS) {
      if (phase === 'playing') ended = 'hostLeft';
      phase = 'closed';
      events.onClosed?.();
      transport.close();
      return;
    }
    if (t - lastPing > 1000) {
      lastPing = t;
      send('unreliable', encodePing(MSG_PING, pingId++, t));
    }
    const span = (t - windowStart) / 1000;
    if (span >= 1) {
      stats.bytesInPerS = bytesIn / span;
      stats.bytesOutPerS = bytesOut / span;
      stats.snapshotsPerS = snapCount / span;
      stats.loss = snapsExpected > 0 ? Math.max(0, 1 - snapsGot / snapsExpected) : 0;
      stats.pingMs = pingMs;
      bytesIn = bytesOut = snapCount = 0;
      snapsExpected = snapsGot = 0;
      windowStart = t;
    }
  };

  /** Pose of another plane at a (fractional) server tick, from its snapshot buffer. */
  const sample = (buf: Buffered[], tick: number, out: PlaneState): void => {
    let a: Buffered | null = null;
    let b: Buffered | null = null;
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i]!.tick <= tick) {
        a = buf[i]!;
        b = buf[i + 1] ?? null;
        break;
      }
    }
    if (!a) a = buf[0]!;
    if (b && b.tick > a.tick && a.p.alive === b.p.alive) {
      const t = (tick - a.tick) / (b.tick - a.tick);
      out.pos = [lerp(a.p.pos[0], b.p.pos[0], t), lerp(a.p.pos[1], b.p.pos[1], t), lerp(a.p.pos[2], b.p.pos[2], t)];
      out.quat = nlerpQuat(a.p.quat, b.p.quat, t);
      out.vel = [lerp(a.p.vel[0], b.p.vel[0], t), lerp(a.p.vel[1], b.p.vel[1], t), lerp(a.p.vel[2], b.p.vel[2], t)];
    } else {
      // Nothing newer yet: extrapolate with velocity, at most 250 ms.
      const dt = Math.min(Math.max(0, tick - a.tick), MAX_EXTRAPOLATE_TICKS) / TICK_HZ;
      out.pos = [a.p.pos[0] + a.p.vel[0] * dt, a.p.pos[1] + a.p.vel[1] * dt, a.p.pos[2] + a.p.vel[2] * dt];
      out.quat = [...a.p.quat];
      out.vel = [...a.p.vel];
    }
    copyFromSnapshot(out, a.p, false);
  };

  const api: ClientSession = {
    kind: 'net',
    get playerId() {
      return playerId;
    },
    get ctx() {
      if (!ctx) throw new Error('not started');
      return ctx;
    },
    get world() {
      if (!world) throw new Error('not started');
      return world;
    },
    get phase() {
      return phase;
    },
    get room() {
      return room;
    },
    timeLeftMs() {
      if (!room || room.endsInMs === null) return null;
      return Math.max(0, room.endsInMs - (now() - roomAt));
    },
    get results() {
      return results;
    },
    chat,
    request(m) {
      send('reliable', encodeJson(m));
    },
    chooseRespawn(planeId) {
      respawnChoice = planeId;
      send('reliable', encodeJson({ t: 'respawn', planeId }));
    },
    get respawnChoice() {
      return respawnChoice;
    },
    get rejectReason() {
      return rejectReason;
    },
    get ended() {
      return ended;
    },
    get net() {
      return stats;
    },
    idle() {
      updateStats();
    },
    step(dt, input) {
      updateStats();
      const out = pendingEvents.splice(0);
      if (!world || !ctx) return out;
      const w = world;
      serverTick += dt * TICK_HZ;
      w.tick++;
      w.time += dt;

      for (const p of w.planes) {
        const pp = prevPose.get(p.id);
        if (pp) {
          pp.pos = [...p.pos];
          pp.quat = [...p.quat];
        } else prevPose.set(p.id, { pos: [...p.pos], quat: [...p.quat] });
      }

      // Own plane: commit a new input every other tick (30 Hz), send it, predict with it.
      if (own && own.alive && latest) {
        if (tickInInput === 0) {
          current = input ?? neutralInput(own.throttle);
          seq++;
          history.push({ seq, input: current });
          while (history.length > 120) history.shift();
          send('unreliable', encodeInput(seq, current));
        }
        tickInInput = (tickInInput + 1) % TICKS_PER_INPUT;
        predictTick(own, current, dt);
        own.firing = current.fire && own.ammo.some((a) => a > 0);
      }
      const decay = Math.exp(-SMOOTH_RATE * dt);
      smooth.pos = [smooth.pos[0] * decay, smooth.pos[1] * decay, smooth.pos[2] * decay];

      // Others (and our own plane while dead): 100 ms in the past.
      const renderTick = serverTick - INTERP_DELAY_TICKS;
      for (const p of w.planes) {
        if (p === own && own.alive) continue;
        const buf = buffers.get(p.id);
        if (buf && buf.length) sample(buf, renderTick, p);
      }

      // Cosmetic tracers from every firing plane; the host decides what they hit.
      const fc = { guns: ctx.guns, nextBulletId: () => w.nextBulletId++, random: Math.random, enemies: [] as PlaneState[] };
      for (const p of w.planes) {
        if (!p.alive || !p.firing) continue;
        const def = ctx.planeDefs.get(p.planeId);
        if (!def) continue;
        if (p !== own) p.ammo = p.ammo.map(() => 9999);
        fireGuns(p, def, fc, dt, w.bullets);
      }
      stepBullets(w.bullets, [], () => ({}) as HitSpheres, ctx.terrain.surfaceAt, dt);
      return out;
    },
    pose(id, alpha, out) {
      if (!world) return false;
      const p = world.planes.find((x) => x.id === id);
      if (!p) return false;
      const before = prevPose.get(id);
      const pos: Vec3 = before
        ? [lerp(before.pos[0], p.pos[0], alpha), lerp(before.pos[1], p.pos[1], alpha), lerp(before.pos[2], p.pos[2], alpha)]
        : [...p.pos];
      const quat: Quat = before ? nlerpQuat(before.quat, p.quat, alpha) : [...p.quat];
      if (p === own && own.alive) {
        pos[0] += smooth.pos[0];
        pos[1] += smooth.pos[1];
        pos[2] += smooth.pos[2];
      }
      out.pos = pos;
      out.quat = quat;
      return true;
    },
    dispose() {
      transport.close();
    },
  };
  return api;
}
