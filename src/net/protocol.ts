// Wire protocol. Binary for the hot path (inputs 30/s up, snapshots 20/s down), JSON for rare events.
//
// Input (13 bytes):  u8 type=1 | u32 seq | i8 pitch | i8 roll | i8 yaw | u8 throttle | u8 buttons | u8 target slot
//                    | u8 extra (bit 0 radar dogfight, bits 1–2 radar range, bits 3–7 secondary + 1, 0 = auto)
//                    | u8 config (Day 12: bits 0–1 flap step, bit 2 gear down)
//   buttons: fire, missile, flare, WEP, airbrake, flaps, radar lock wanted, radar on (bits 0–7)
// Ping/pong (11 B):  u8 type=3|4 | u16 id | f64 sender time (echoed back unchanged)
// Snapshot:          header 17 B + 26 B per plane + 1 B + 17 B per missile + objectives + own weapons trailer
//   header: u8 type=2 | u8 roster version | u32 tick | u32 ack seq | u16 time left ×10 | u16 red | u16 blue
//           | u8 state | u8 count   (red/blue: kills, tickets left or points, by mode)
//   plane:  u8 flags | u8 damage flags | i16 x×2 | u16 (y+2000)×2 | i16 z×2 | u32 quat (smallest three)
//           | i16 vx×20 | i16 vy×20 | i16 vz×20 | u8 hp | u8 throttle×254 (255 = WEP lit) | u8 respawn×10 | u8 g×10
//           | u8 lock target slot | u8 lock (bit 7 radar, bits 0–6 progress×127)
//           | u8 missiles left (mount 0 in bits 0–3, mount 1 in bits 4–7; drawn on the pylons), or for planes
//             with ordnance, rockets in bits 0–3 and bombs in bits 4–7 | u8 radar lock slot (0 none)
//   missile: u16 id | u8 type | u8 owner slot | u8 target slot (0 none, 255 a decoy) | i16 x×2 | u16 (y+2000)×2
//           | i16 z×2 | i16 vx×20 | i16 vy×20 | i16 vz×20
//   objectives: u8 zones | (i8 progress×127, u8 owner 0/1 red/2 blue) × zones | u8 units | u8 × units
//            (bit 7 firing, bits 0–6 health %; 0 = destroyed). Unit positions follow from the clock and the layout.
//   trailer: u8 n | u16 ammo × n | u8 m | u8 missiles × m | u8 flares | u8 chaff | u8 lock mount + 1 | u8 rockets
//            | u8 bombs | u8 engine heat×255 | u8 overheat s×10 | u8 secondary + 1 (the receiving player's own)
// "Slot" is a plane's index in the roster + 1 (0 = none). 20 planes ≈ 500 bytes per snapshot ≈ 10 KB/s per client
// at 20 Hz, plus 17 bytes per missile in the air. Flares and chaff are reliable events, simulated locally.
import { flapStepOf, type ControlInput } from '../game/controls';
import type { PlaneState, Team } from '../game/flight';
import type { MissileState } from '../game/missiles';
import type { GroundLayout } from '../game/groundLayout';
import type { GroundUnit, ModeId, ZoneState } from '../game/objectives';
import type { Quat, Vec3 } from '../game/math';
import type { EraId } from '../data/types';
import type { MatchResults } from '../game/results';
import type { UnlockMap } from '../game/unlocks';
import type { BotDifficulty, GameEvent, Pilot, PilotStats } from '../game/world';

export const MSG_INPUT = 1;
export const MSG_SNAPSHOT = 2;
export const MSG_PING = 3;
export const MSG_PONG = 4;

export const SNAPSHOT_HZ = 20;
export const INPUT_HZ = 30;
export const PLANE_BYTES = 26;
export const MISSILE_BYTES = 17;
const INPUT_BYTES = 13;
/** Missile target byte for "chasing a flare or chaff". */
const DECOY_SLOT = 255;
const HEADER_BYTES = 17;

// ---------------------------------------------------------------- reliable (JSON) messages

export interface DeviceInfo {
  touch: boolean;
  /** navigator.connection.type where the browser tells us (Android Chrome): wifi, cellular, ethernet… */
  connection: string | null;
}

export type VoteCategory = 'era' | 'map' | 'mode';
export const VOTE_CATEGORIES: readonly VoteCategory[] = ['era', 'map', 'mode'];

/** Everything a client can ask for. The host checks each request against the room phase and the rules. */
export type ClientMsg =
  /** rp: everything earned (for team balancing); uid: the Firebase user, listed as a match participant so this
   * player may save the result; unlocked: highest tier per era (plane select checks it). */
  | { t: 'hello'; callsign: string; version: string; device: DeviceInfo; rp?: number; uid?: string | null; unlocked?: Record<string, number> }
  /** The player's progress changed (an unlock bought or RP saved between rounds). */
  | { t: 'profile'; rp: number; unlocked: Record<string, number> }
  | { t: 'chat'; text: string }
  | { t: 'ready'; ready: boolean }
  /** Join this player's party (null = leave your party). */
  | { t: 'party'; with: string | null }
  | { t: 'vote'; cat: VoteCategory; id: string }
  | { t: 'pick'; planeId: string; lock: boolean }
  /** Plane for your next respawn (respawn screen). */
  | { t: 'respawn'; planeId: string }
  /** Results screen: ready for the next round. */
  | { t: 'again' };

export type RoomPhase = 'lobby' | 'vote' | 'teams' | 'select' | 'playing' | 'results';

export interface RoomSettings {
  difficulty: BotDifficulty;
  bots: boolean;
  matchLengthS: number;
}

export interface RoomPlayer {
  id: string;
  name: string;
  host: boolean;
  pingMs: number | null;
  device: DeviceInfo;
  ready: boolean;
  party: string | null;
  /** Research points earned in total (balance + spent on unlocks), for team balancing. */
  rp: number;
  /** Highest unlocked tier per era (what this player may pick). */
  unlocked: UnlockMap;
  team: Team | null;
  planeId: string | null;
  /** Plane select: confirmed. */
  locked: boolean;
  votes: Partial<Record<VoteCategory, string>>;
  /** Flying in the current match (joins in progress included). */
  inMatch: boolean;
}

/** The whole lobby, owned by the host and broadcast whenever it changes. */
export interface RoomState {
  phase: RoomPhase;
  /** Milliseconds left on the current phase's timer (vote, teams, select, results), or null. */
  endsInMs: number | null;
  players: RoomPlayer[];
  settings: RoomSettings;
  /** Host overrides in the vote. */
  overrides: Partial<Record<VoteCategory, string>>;
  /** The vote's result, from the end of the vote until back in the lobby. */
  choice: { era: EraId; mapId: string; mode: string } | null;
  /** Total Battle Rating per team for the current match (humans + bots). */
  br: Record<Team, number> | null;
  /** Everything unlocked for everyone (the host runs with ?debug=1 on localhost). */
  allUnlocked: boolean;
  round: number;
}

export interface LobbyPlayer {
  id: string;
  name: string;
  host: boolean;
  pingMs: number | null;
  device: DeviceInfo;
}

export interface RosterEntry {
  id: string;
  planeId: string;
  team: Team;
}

export type HostMsg =
  | { t: 'welcome'; playerId: string; version: string; hostName: string }
  | { t: 'reject'; reason: string }
  | { t: 'room'; room: RoomState }
  | { t: 'results'; results: MatchResults }
  /** matchId: the Firestore match this round is saved under (null when the host is offline). */
  /** mode, layout (ground targets) and escort (Bomber Escort's flying team) let clients set up the same objectives. */
  | { t: 'start'; matchId?: string | null; uids?: string[]; era: string; mapId: string; mode?: ModeId; layout?: GroundLayout | null; escort?: Team | null; you: string; rosterVersion: number; roster: RosterEntry[]; pilots: Pilot[]; killLimit: number; tick: number }
  | { t: 'roster'; rosterVersion: number; roster: RosterEntry[]; pilots: Pilot[] }
  | { t: 'events'; events: GameEvent[] }
  | { t: 'stats'; stats: Record<string, PilotStats> }
  | { t: 'match'; state: 'playing' | 'ended'; winner: Team | 'draw' | null; score: Record<Team, number> }
  | { t: 'chat'; from: string; team: Team | null; text: string };

export const QUICK_CHAT = ['Need help!', 'On my way', 'Nice shot', 'Good game'] as const;
export const CHAT_MAX = 80;

export const encodeJson = (m: ClientMsg | HostMsg): string => JSON.stringify(m);

export function decodeJson<T>(data: unknown): T | null {
  if (typeof data !== 'string' || data.length > 64_000) return null;
  try {
    const v = JSON.parse(data) as unknown;
    return typeof v === 'object' && v !== null && typeof (v as { t?: unknown }).t === 'string' ? (v as T) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- input

const clampNum = (v: unknown, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0);

/** `targetSlot`: the picked missile target's roster index + 1, or 0 for none. */
export function encodeInput(seq: number, i: ControlInput, targetSlot = 0): ArrayBuffer {
  const b = new ArrayBuffer(INPUT_BYTES);
  const v = new DataView(b);
  v.setUint8(0, MSG_INPUT);
  v.setUint32(1, seq >>> 0);
  v.setInt8(5, Math.round(clampNum(i.pitch, -1, 1) * 127));
  v.setInt8(6, Math.round(clampNum(i.roll, -1, 1) * 127));
  v.setInt8(7, Math.round(clampNum(i.yaw, -1, 1) * 127));
  v.setUint8(8, Math.round(clampNum(i.throttle, 0, 1) * 255));
  v.setUint8(
    9,
    (i.fire ? 1 : 0) | (i.missile ? 2 : 0) | (i.flare ? 4 : 0) | (i.wep ? 8 : 0) | (i.airbrake ? 16 : 0) | (i.flaps ? 32 : 0) | (i.radarLock ? 64 : 0) | (i.radarOn ? 128 : 0),
  );
  v.setUint8(10, targetSlot >= 0 && targetSlot <= 254 ? targetSlot : 0);
  const range = Math.round(clampNum(i.radarRange ?? 1, 0, 2));
  const sec = Math.round(clampNum((i.secondary ?? -1) + 1, 0, 31));
  v.setUint8(11, (i.radarDogfight ? 1 : 0) | (range << 1) | (sec << 3));
  v.setUint8(12, flapStepOf(i) | (i.gear ? 4 : 0));
  return b;
}

/** Decodes and clamps a client's input. Anything malformed comes back as null. The target comes back as a
 *  slot (the host maps it to a plane id); `input.target` is null. */
export function decodeInput(data: ArrayBuffer): { seq: number; input: ControlInput; targetSlot: number } | null {
  if (data.byteLength !== INPUT_BYTES) return null;
  const v = new DataView(data);
  if (v.getUint8(0) !== MSG_INPUT) return null;
  const buttons = v.getUint8(9);
  return {
    seq: v.getUint32(1),
    input: {
      pitch: Math.max(-1, v.getInt8(5) / 127),
      roll: Math.max(-1, v.getInt8(6) / 127),
      yaw: Math.max(-1, v.getInt8(7) / 127),
      throttle: v.getUint8(8) / 255,
      fire: (buttons & 1) !== 0,
      missile: (buttons & 2) !== 0,
      flare: (buttons & 4) !== 0,
      target: null,
      wep: (buttons & 8) !== 0,
      airbrake: (buttons & 16) !== 0,
      flaps: (buttons & 32) !== 0,
      radarLock: (buttons & 64) !== 0,
      radarOn: (buttons & 128) !== 0,
      radarDogfight: (v.getUint8(11) & 1) !== 0,
      radarRange: Math.min(2, (v.getUint8(11) >> 1) & 3),
      secondary: (v.getUint8(11) >> 3) - 1,
      flapStep: v.getUint8(12) & 3,
      gear: (v.getUint8(12) & 4) !== 0,
    },
    targetSlot: v.getUint8(10),
  };
}

// ---------------------------------------------------------------- ping

export function encodePing(type: typeof MSG_PING | typeof MSG_PONG, id: number, time: number): ArrayBuffer {
  const b = new ArrayBuffer(11);
  const v = new DataView(b);
  v.setUint8(0, type);
  v.setUint16(1, id & 0xffff);
  v.setFloat64(3, time);
  return b;
}

export function decodePing(data: ArrayBuffer): { type: number; id: number; time: number } | null {
  if (data.byteLength !== 11) return null;
  const v = new DataView(data);
  const type = v.getUint8(0);
  if (type !== MSG_PING && type !== MSG_PONG) return null;
  return { type, id: v.getUint16(1), time: v.getFloat64(3) };
}

export const messageType = (data: ArrayBuffer): number => (data.byteLength > 0 ? new DataView(data).getUint8(0) : 0);

// ---------------------------------------------------------------- quaternion: smallest three in 32 bits

const Q_SCALE = 511 / Math.SQRT1_2;

export function packQuat(q: Quat): number {
  let largest = 0;
  for (let i = 1; i < 4; i++) if (Math.abs(q[i]!) > Math.abs(q[largest]!)) largest = i;
  const sign = q[largest]! < 0 ? -1 : 1;
  let packed = largest << 30;
  let shift = 20;
  for (let i = 0; i < 4; i++) {
    if (i === largest) continue;
    const c = Math.round(q[i]! * sign * Q_SCALE) + 512; // 0..1023
    packed |= (Math.min(1023, Math.max(0, c)) & 0x3ff) << shift;
    shift -= 10;
  }
  return packed >>> 0;
}

export function unpackQuat(packed: number, out: Quat = [0, 0, 0, 1]): Quat {
  const largest = packed >>> 30;
  let shift = 20;
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    if (i === largest) continue;
    const c = (((packed >>> shift) & 0x3ff) - 512) / Q_SCALE;
    out[i] = c;
    sum += c * c;
    shift -= 10;
  }
  out[largest] = Math.sqrt(Math.max(0, 1 - sum));
  return out;
}

// ---------------------------------------------------------------- snapshot

export interface SnapshotPlane {
  alive: boolean;
  wreck: boolean;
  firing: boolean;
  stalled: boolean;
  onFire: boolean;
  protectedNow: boolean;
  autoTurn: boolean;
  edgeWarning: boolean;
  damaged: { engine: boolean; wingL: boolean; wingR: boolean };
  pos: Vec3;
  quat: Quat;
  vel: Vec3;
  hp: number;
  throttle: number;
  respawnIn: number;
  g: number;
  /** Roster slot of the plane this one is locking (0 = none), how far along, and whether it's a radar lock. */
  lockSlot: number;
  lockProgress: number;
  lockRadar: boolean;
  /** Missiles left on the first two mounts (no plane has more than two). */
  missiles: [number, number];
  wep: boolean;
  /** Roster slot of the plane this one's radar has locked (0 = none). */
  radarSlot: number;
}

export interface SnapshotMissile {
  id: number;
  type: string;
  ownerSlot: number;
  /** 0 = lost, 255 = chasing a decoy, else the target's slot. */
  targetSlot: number;
  pos: Vec3;
  vel: Vec3;
}

/** The receiving player's own weapons. */
export interface OwnWeapons {
  ammo: readonly number[];
  missiles: readonly number[];
  flares: number;
  chaff: number;
  lockMount: number;
  rockets: number;
  bombs: number;
  engineHeat: number;
  overheatFor: number;
  secondary: number;
}

export const NO_WEAPONS: OwnWeapons = { ammo: [], missiles: [], flares: 0, chaff: 0, lockMount: -1, rockets: 0, bombs: 0, engineHeat: 0, overheatFor: 0, secondary: -1 };

export interface SnapshotZone {
  progress: number;
  owner: Team | null;
}

export interface SnapshotUnit {
  /** 0–100; 0 = destroyed. */
  hpPct: number;
  firing: boolean;
}

/** What the objectives encoder reads (world.objectives). */
export interface SnapshotObjectives {
  zones: readonly ZoneState[];
  units: readonly GroundUnit[];
}

const NO_OBJECTIVES: SnapshotObjectives = { zones: [], units: [] };

export interface Snapshot {
  rosterVersion: number;
  tick: number;
  ackSeq: number;
  timeLeftS: number;
  score: Record<Team, number>;
  ended: boolean;
  planes: SnapshotPlane[];
  missiles: SnapshotMissile[];
  zones: SnapshotZone[];
  units: SnapshotUnit[];
  own: OwnWeapons;
}

/** What the snapshot encoder needs to know beyond the planes: missile type ids (index = wire type) and which
 *  planes are locking with a radar. */
export interface SnapshotContext {
  missileTypes: readonly string[];
  lockIsRadar(p: PlaneState): boolean;
}

const i16 = (v: number): number => Math.max(-32768, Math.min(32767, Math.round(v)));
const u16 = (v: number): number => Math.max(0, Math.min(65535, Math.round(v)));
const u8 = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));

export function encodeSnapshot(
  s: { rosterVersion: number; tick: number; ackSeq: number; timeLeftS: number; score: Record<Team, number>; ended: boolean },
  planes: readonly PlaneState[],
  own: OwnWeapons,
  missiles: readonly MissileState[] = [],
  sc: SnapshotContext = { missileTypes: [], lockIsRadar: () => false },
  obj: SnapshotObjectives = NO_OBJECTIVES,
): ArrayBuffer {
  const n = Math.min(127, planes.length);
  const nm = Math.min(255, missiles.length);
  const nz = Math.min(255, obj.zones.length);
  const nu = Math.min(255, obj.units.length);
  const slotOf = (id: string | null): number => {
    if (id === null) return 0;
    const i = planes.findIndex((p) => p.id === id);
    return i >= 0 && i < n ? i + 1 : 0;
  };
  const buf = new ArrayBuffer(HEADER_BYTES + n * PLANE_BYTES + 1 + nm * MISSILE_BYTES + 1 + nz * 2 + 1 + nu + 1 + own.ammo.length * 2 + 1 + own.missiles.length + 8);
  const v = new DataView(buf);
  v.setUint8(0, MSG_SNAPSHOT);
  v.setUint8(1, s.rosterVersion & 0xff);
  v.setUint32(2, s.tick >>> 0);
  v.setUint32(6, s.ackSeq >>> 0);
  v.setUint16(10, u16(Math.min(s.timeLeftS, 6553) * 10));
  // Tickets drain fractionally on the host; the wire carries what the HUD shows (rounded up).
  v.setUint16(12, u16(Math.ceil(s.score.red)));
  v.setUint16(14, u16(Math.ceil(s.score.blue)));
  v.setUint8(16, ((s.ended ? 1 : 0) << 7) | n);
  let o = HEADER_BYTES;
  for (let i = 0; i < n; i++) {
    const p = planes[i]!;
    v.setUint8(o, (p.alive ? 1 : 0) | (p.wreck ? 2 : 0) | (p.firing ? 4 : 0) | (p.stalled ? 8 : 0) | (p.fireFor > 0 ? 16 : 0) | (p.protectedFor > 0 ? 32 : 0) | (p.autoTurn ? 64 : 0) | (p.edgeWarning ? 128 : 0));
    v.setUint8(o + 1, (p.damaged.engine ? 1 : 0) | (p.damaged.wingL ? 2 : 0) | (p.damaged.wingR ? 4 : 0));
    v.setInt16(o + 2, i16(p.pos[0] * 2));
    v.setUint16(o + 4, u16((p.pos[1] + 2000) * 2));
    v.setInt16(o + 6, i16(p.pos[2] * 2));
    v.setUint32(o + 8, packQuat(p.quat));
    v.setInt16(o + 12, i16(p.vel[0] * 20));
    v.setInt16(o + 14, i16(p.vel[1] * 20));
    v.setInt16(o + 16, i16(p.vel[2] * 20));
    v.setUint8(o + 18, u8(p.hp));
    v.setUint8(o + 19, p.wep ? 255 : u8(p.throttle * 254));
    v.setUint8(o + 20, u8(p.respawnIn * 10));
    v.setUint8(o + 21, u8(p.g * 10));
    const lockSlot = p.lockProgress > 0 ? slotOf(p.lockTarget) : 0;
    v.setUint8(o + 22, lockSlot);
    v.setUint8(o + 23, lockSlot ? (sc.lockIsRadar(p) ? 128 : 0) | Math.round(Math.min(1, Math.max(0, p.lockProgress)) * 127) : 0);
    const loadA = p.missiles.length ? p.missiles[0] ?? 0 : p.rockets;
    const loadB = p.missiles.length ? p.missiles[1] ?? 0 : p.bombs;
    v.setUint8(o + 24, Math.min(15, loadA) | (Math.min(15, loadB) << 4));
    v.setUint8(o + 25, p.radarOn ? slotOf(p.radarLock) : 0);
    o += PLANE_BYTES;
  }
  v.setUint8(o++, nm);
  for (let i = 0; i < nm; i++) {
    const m = missiles[i]!;
    v.setUint16(o, m.id & 0xffff);
    v.setUint8(o + 2, Math.max(0, sc.missileTypes.indexOf(m.type)));
    v.setUint8(o + 3, slotOf(m.owner));
    v.setUint8(o + 4, m.target === null ? 0 : m.target.startsWith('d') ? DECOY_SLOT : slotOf(m.target));
    v.setInt16(o + 5, i16(m.pos[0] * 2));
    v.setUint16(o + 7, u16((m.pos[1] + 2000) * 2));
    v.setInt16(o + 9, i16(m.pos[2] * 2));
    v.setInt16(o + 11, i16(m.vel[0] * 20));
    v.setInt16(o + 13, i16(m.vel[1] * 20));
    v.setInt16(o + 15, i16(m.vel[2] * 20));
    o += MISSILE_BYTES;
  }
  v.setUint8(o++, nz);
  for (let i = 0; i < nz; i++) {
    const z = obj.zones[i]!;
    v.setInt8(o++, Math.round(Math.max(-1, Math.min(1, z.progress)) * 127));
    v.setUint8(o++, z.owner === 'red' ? 1 : z.owner === 'blue' ? 2 : 0);
  }
  v.setUint8(o++, nu);
  for (let i = 0; i < nu; i++) {
    const u = obj.units[i]!;
    const pct = u.alive ? Math.max(1, Math.min(100, Math.ceil((u.hp / u.maxHp) * 100))) : 0;
    v.setUint8(o++, (u.firing && u.alive ? 128 : 0) | pct);
  }
  v.setUint8(o++, own.ammo.length);
  for (const a of own.ammo) {
    v.setUint16(o, u16(a));
    o += 2;
  }
  v.setUint8(o++, own.missiles.length);
  for (const m of own.missiles) v.setUint8(o++, u8(m));
  v.setUint8(o++, u8(own.flares));
  v.setUint8(o++, u8(own.chaff));
  v.setUint8(o++, u8(own.lockMount + 1));
  v.setUint8(o++, u8(own.rockets));
  v.setUint8(o++, u8(own.bombs));
  v.setUint8(o++, u8(own.engineHeat * 255));
  v.setUint8(o++, u8(own.overheatFor * 10));
  v.setUint8(o++, u8(own.secondary + 1));
  return buf;
}

export function decodeSnapshot(data: ArrayBuffer, missileTypes: readonly string[] = []): Snapshot | null {
  if (data.byteLength < HEADER_BYTES + 1) return null;
  const v = new DataView(data);
  if (v.getUint8(0) !== MSG_SNAPSHOT) return null;
  const countByte = v.getUint8(16);
  const n = countByte & 0x7f;
  if (data.byteLength < HEADER_BYTES + n * PLANE_BYTES + 1) return null;
  const planes: SnapshotPlane[] = [];
  let o = HEADER_BYTES;
  for (let i = 0; i < n; i++) {
    const f = v.getUint8(o);
    const d = v.getUint8(o + 1);
    planes.push({
      alive: (f & 1) !== 0,
      wreck: (f & 2) !== 0,
      firing: (f & 4) !== 0,
      stalled: (f & 8) !== 0,
      onFire: (f & 16) !== 0,
      protectedNow: (f & 32) !== 0,
      autoTurn: (f & 64) !== 0,
      edgeWarning: (f & 128) !== 0,
      damaged: { engine: (d & 1) !== 0, wingL: (d & 2) !== 0, wingR: (d & 4) !== 0 },
      pos: [v.getInt16(o + 2) / 2, v.getUint16(o + 4) / 2 - 2000, v.getInt16(o + 6) / 2],
      quat: unpackQuat(v.getUint32(o + 8)),
      vel: [v.getInt16(o + 12) / 20, v.getInt16(o + 14) / 20, v.getInt16(o + 16) / 20],
      hp: v.getUint8(o + 18),
      throttle: v.getUint8(o + 19) === 255 ? 1 : v.getUint8(o + 19) / 254,
      wep: v.getUint8(o + 19) === 255,
      respawnIn: v.getUint8(o + 20) / 10,
      g: v.getUint8(o + 21) / 10,
      lockSlot: v.getUint8(o + 22),
      lockProgress: (v.getUint8(o + 23) & 127) / 127,
      lockRadar: (v.getUint8(o + 23) & 128) !== 0,
      missiles: [v.getUint8(o + 24) & 15, v.getUint8(o + 24) >> 4],
      radarSlot: v.getUint8(o + 25),
    });
    o += PLANE_BYTES;
  }
  const missiles: SnapshotMissile[] = [];
  const nm = v.getUint8(o++);
  if (data.byteLength < o + nm * MISSILE_BYTES + 1) return null;
  for (let i = 0; i < nm; i++) {
    missiles.push({
      id: v.getUint16(o),
      type: missileTypes[v.getUint8(o + 2)] ?? '',
      ownerSlot: v.getUint8(o + 3),
      targetSlot: v.getUint8(o + 4),
      pos: [v.getInt16(o + 5) / 2, v.getUint16(o + 7) / 2 - 2000, v.getInt16(o + 9) / 2],
      vel: [v.getInt16(o + 11) / 20, v.getInt16(o + 13) / 20, v.getInt16(o + 15) / 20],
    });
    o += MISSILE_BYTES;
  }
  const byte = (): number => (o < data.byteLength ? v.getUint8(o++) : 0);
  const zones: SnapshotZone[] = [];
  const nz = byte();
  for (let i = 0; i < nz; i++) {
    const p = o < data.byteLength ? v.getInt8(o++) / 127 : 0;
    const w = byte();
    zones.push({ progress: p, owner: w === 1 ? 'red' : w === 2 ? 'blue' : null });
  }
  const units: SnapshotUnit[] = [];
  const nu = byte();
  for (let i = 0; i < nu; i++) {
    const b = byte();
    units.push({ hpPct: b & 127, firing: (b & 128) !== 0 });
  }
  const ammo: number[] = [];
  const na = byte();
  for (let i = 0; i < na && o + 2 <= data.byteLength; i++, o += 2) ammo.push(v.getUint16(o));
  const ownMissiles: number[] = [];
  const nom = byte();
  for (let i = 0; i < nom; i++) ownMissiles.push(byte());
  const flares = byte();
  const chaff = byte();
  const lockMount = byte() - 1;
  const rockets = byte();
  const bombs = byte();
  const engineHeat = byte() / 255;
  const overheatFor = byte() / 10;
  const secondary = byte() - 1;
  return {
    rosterVersion: v.getUint8(1),
    tick: v.getUint32(2),
    ackSeq: v.getUint32(6),
    timeLeftS: v.getUint16(10) / 10,
    score: { red: v.getUint16(12), blue: v.getUint16(14) },
    ended: (countByte & 0x80) !== 0,
    planes,
    missiles,
    zones,
    units,
    own: { ammo, missiles: ownMissiles, flares, chaff, lockMount, rockets, bombs, engineHeat, overheatFor, secondary },
  };
}

export const DECOY_TARGET_SLOT = DECOY_SLOT;

/** Cleans a callsign: 2–16 visible characters, no markup. */
export function cleanCallsign(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.replace(/[<>&"'`\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16) : '';
  return s.length >= 2 ? s : 'Pilot';
}
