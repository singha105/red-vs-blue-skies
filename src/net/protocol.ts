// Wire protocol. Binary for the hot path (inputs 30/s up, snapshots 20/s down), JSON for rare events.
//
// Input (10 bytes):  u8 type=1 | u32 seq | i8 pitch | i8 roll | i8 yaw | u8 throttle | u8 buttons
// Ping/pong (11 B):  u8 type=3|4 | u16 id | f64 sender time (echoed back unchanged)
// Snapshot:          header 15 B + 22 B per plane + own ammo trailer
//   header: u8 type=2 | u8 roster version | u32 tick | u32 ack seq | u16 time left ×10 | u8 red | u8 blue | u8 state | u8 count
//   plane:  u8 flags | u8 damage flags | i16 x×2 | u16 (y+2000)×2 | i16 z×2 | u32 quat (smallest three)
//           | i16 vx×20 | i16 vy×20 | i16 vz×20 | u8 hp | u8 throttle×255 | u8 respawn×10 | u8 g×10
//   trailer: u8 n | u16 ammo × n (the receiving player's own guns)
// 20 planes ≈ 460 bytes per snapshot ≈ 9 KB/s per client at 20 Hz.
import type { ControlInput } from '../game/controls';
import type { PlaneState, Team } from '../game/flight';
import type { Quat, Vec3 } from '../game/math';
import type { GameEvent, Pilot, PilotStats } from '../game/world';

export const MSG_INPUT = 1;
export const MSG_SNAPSHOT = 2;
export const MSG_PING = 3;
export const MSG_PONG = 4;

export const SNAPSHOT_HZ = 20;
export const INPUT_HZ = 30;
export const PLANE_BYTES = 22;
const HEADER_BYTES = 15;

// ---------------------------------------------------------------- reliable (JSON) messages

export interface DeviceInfo {
  touch: boolean;
  /** navigator.connection.type where the browser tells us (Android Chrome): wifi, cellular, ethernet… */
  connection: string | null;
}

export type ClientMsg =
  | { t: 'hello'; callsign: string; version: string; device: DeviceInfo }
  | { t: 'chat'; text: string };

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
  | { t: 'lobby'; players: LobbyPlayer[]; era: string; mapId: string }
  | { t: 'start'; era: string; mapId: string; you: string; rosterVersion: number; roster: RosterEntry[]; pilots: Pilot[]; killLimit: number; tick: number }
  | { t: 'roster'; rosterVersion: number; roster: RosterEntry[]; pilots: Pilot[] }
  | { t: 'events'; events: GameEvent[] }
  | { t: 'stats'; stats: Record<string, PilotStats> }
  | { t: 'match'; state: 'playing' | 'ended'; winner: Team | 'draw' | null; score: Record<Team, number> }
  | { t: 'chat'; from: string; text: string };

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

export function encodeInput(seq: number, i: ControlInput): ArrayBuffer {
  const b = new ArrayBuffer(10);
  const v = new DataView(b);
  v.setUint8(0, MSG_INPUT);
  v.setUint32(1, seq >>> 0);
  v.setInt8(5, Math.round(clampNum(i.pitch, -1, 1) * 127));
  v.setInt8(6, Math.round(clampNum(i.roll, -1, 1) * 127));
  v.setInt8(7, Math.round(clampNum(i.yaw, -1, 1) * 127));
  v.setUint8(8, Math.round(clampNum(i.throttle, 0, 1) * 255));
  v.setUint8(9, (i.fire ? 1 : 0) | (i.missile ? 2 : 0) | (i.flare ? 4 : 0));
  return b;
}

/** Decodes and clamps a client's input. Anything malformed comes back as null. */
export function decodeInput(data: ArrayBuffer): { seq: number; input: ControlInput } | null {
  if (data.byteLength !== 10) return null;
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
    },
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
}

export interface Snapshot {
  rosterVersion: number;
  tick: number;
  ackSeq: number;
  timeLeftS: number;
  score: Record<Team, number>;
  ended: boolean;
  planes: SnapshotPlane[];
  ownAmmo: number[];
}

const i16 = (v: number): number => Math.max(-32768, Math.min(32767, Math.round(v)));
const u16 = (v: number): number => Math.max(0, Math.min(65535, Math.round(v)));
const u8 = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));

export function encodeSnapshot(
  s: { rosterVersion: number; tick: number; ackSeq: number; timeLeftS: number; score: Record<Team, number>; ended: boolean },
  planes: readonly PlaneState[],
  ownAmmo: readonly number[],
): ArrayBuffer {
  const n = Math.min(255, planes.length);
  const buf = new ArrayBuffer(HEADER_BYTES + n * PLANE_BYTES + 1 + ownAmmo.length * 2);
  const v = new DataView(buf);
  v.setUint8(0, MSG_SNAPSHOT);
  v.setUint8(1, s.rosterVersion & 0xff);
  v.setUint32(2, s.tick >>> 0);
  v.setUint32(6, s.ackSeq >>> 0);
  v.setUint16(10, u16(Math.min(s.timeLeftS, 6553) * 10));
  v.setUint8(12, u8(s.score.red));
  v.setUint8(13, u8(s.score.blue));
  v.setUint8(14, ((s.ended ? 1 : 0) << 7) | n);
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
    v.setUint8(o + 19, u8(p.throttle * 255));
    v.setUint8(o + 20, u8(p.respawnIn * 10));
    v.setUint8(o + 21, u8(p.g * 10));
    o += PLANE_BYTES;
  }
  v.setUint8(o, ownAmmo.length);
  o++;
  for (const a of ownAmmo) {
    v.setUint16(o, u16(a));
    o += 2;
  }
  return buf;
}

export function decodeSnapshot(data: ArrayBuffer): Snapshot | null {
  if (data.byteLength < HEADER_BYTES + 1) return null;
  const v = new DataView(data);
  if (v.getUint8(0) !== MSG_SNAPSHOT) return null;
  const countByte = v.getUint8(14);
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
      throttle: v.getUint8(o + 19) / 255,
      respawnIn: v.getUint8(o + 20) / 10,
      g: v.getUint8(o + 21) / 10,
    });
    o += PLANE_BYTES;
  }
  const ownAmmo: number[] = [];
  const na = o < data.byteLength ? v.getUint8(o) : 0;
  o++;
  for (let i = 0; i < na && o + 2 <= data.byteLength; i++, o += 2) ownAmmo.push(v.getUint16(o));
  return {
    rosterVersion: v.getUint8(1),
    tick: v.getUint32(2),
    ackSeq: v.getUint32(6),
    timeLeftS: v.getUint16(10) / 10,
    score: { red: v.getUint8(12), blue: v.getUint8(13) },
    ended: (countByte & 0x80) !== 0,
    planes,
    ownAmmo,
  };
}

/** Cleans a callsign: 2–16 visible characters, no markup. */
export function cleanCallsign(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.replace(/[<>&"'`\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16) : '';
  return s.length >= 2 ? s : 'Pilot';
}
