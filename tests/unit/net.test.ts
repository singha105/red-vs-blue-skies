import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/data';
import type { ControlInput } from '../../src/game/controls';
import { neutralInput } from '../../src/game/controls';
import { createRng } from '../../src/game/rng';
import { createWorldContext } from '../../src/game/world';
import { createClientSession, type ClientSession } from '../../src/net/clientSession';
import { createFakeNetwork, type FakeNetwork } from '../../src/net/fakeTransport';
import { createHostServer, type HostServer } from '../../src/net/hostServer';
import {
  decodeInput,
  decodeSnapshot,
  encodeInput,
  encodeSnapshot,
  packQuat,
  PLANE_BYTES,
  unpackQuat,
} from '../../src/net/protocol';
import { makeRoomCode, parseRoomCode, ROOM_ALPHABET } from '../../src/net/roomCode';
import type { Quat } from '../../src/game/math';

const result = loadGameData();
if (!result.ok) throw new Error('data invalid');
const data = result.data;
const ctx = createWorldContext(data, 'island_chain');
const DT = 1 / 60;
const STEP_MS = 1000 / 60;

interface Rig {
  net: FakeNetwork;
  server: HostServer;
  clients: ClientSession[];
  inputs: (ControlInput | null)[];
  step(n?: number): void;
}

async function rig(opts: { clients: number; delayMs?: number; loss?: number; jitterMs?: number; version?: string[] }): Promise<Rig> {
  const rng = createRng(5);
  const net = createFakeNetwork({ delayMs: opts.delayMs ?? 0, loss: opts.loss ?? 0, jitterMs: opts.jitterMs ?? 0, random: rng });
  const ht = await net.host('ABCD');
  const server = createHostServer(ctx, ht, { version: 'test', era: 'early_ww2', mapId: 'island_chain', difficulty: 'easy', planeFor: () => 'spitfire_mk5', now: () => net.now });
  const clients: ClientSession[] = [];
  for (let i = 0; i < opts.clients; i++) {
    const ct = await net.join('ABCD');
    clients.push(createClientSession(ct, data, { version: opts.version?.[i] ?? 'test', callsign: `P${i + 1}`, device: { touch: i === 2, connection: null }, now: () => net.now }));
  }
  const inputs: (ControlInput | null)[] = clients.map(() => neutralInput(0.9));
  const r: Rig = {
    net,
    server,
    clients,
    inputs,
    step(n = 1) {
      for (let k = 0; k < n; k++) {
        clients.forEach((c, i) => (c.phase === 'playing' ? c.step(DT, inputs[i] ?? null) : c.idle(DT)));
        net.advance(STEP_MS);
        server.tick(DT);
      }
    },
  };
  return r;
}

const hostPlane = (r: Rig, id: string) => r.server.match!.world.planes.find((p) => p.id === id)!;
const dist = (a: number[], b: number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe('protocol', () => {
  it('room codes skip look-alikes and parse what people type', () => {
    for (let i = 0; i < 200; i++) {
      const c = makeRoomCode();
      expect(c).toMatch(/^[A-Z]{4}$/);
      expect(c).not.toMatch(/[IO]/);
    }
    expect(ROOM_ALPHABET).not.toMatch(/[IO01]/);
    expect(parseRoomCode(' xq7k ')).toBeNull();
    expect(parseRoomCode('xqzk')).toBe('XQZK');
    expect(parseRoomCode('XQ-ZK')).toBe('XQZK');
  });

  it('quaternions survive 32-bit compression', () => {
    const rng = createRng(1);
    for (let i = 0; i < 500; i++) {
      const q = [rng() - 0.5, rng() - 0.5, rng() - 0.5, rng() - 0.5];
      const l = Math.hypot(...q);
      const n = q.map((x) => x / l) as Quat;
      const back = unpackQuat(packQuat(n));
      const dot = Math.abs(n[0] * back[0] + n[1] * back[1] + n[2] * back[2] + n[3] * back[3]);
      expect(dot).toBeGreaterThan(0.99999);
    }
  });

  it('snapshots are small and round-trip within quantisation', async () => {
    const r = await rig({ clients: 1 });
    r.step(5);
    r.server.start();
    r.step(30);
    const w = r.server.match!.world;
    const buf = encodeSnapshot({ rosterVersion: 1, tick: w.tick, ackSeq: 7, timeLeftS: 432.1, score: { red: 3, blue: 5 }, ended: false }, w.planes, [120, 1400]);
    expect(buf.byteLength).toBeLessThan(15 + 20 * PLANE_BYTES + 8);
    const s = decodeSnapshot(buf)!;
    expect(s.planes).toHaveLength(20);
    expect(s.ackSeq).toBe(7);
    expect(s.ownAmmo).toEqual([120, 1400]);
    expect(s.score).toEqual({ red: 3, blue: 5 });
    w.planes.forEach((p, i) => {
      expect(dist(s.planes[i]!.pos, p.pos)).toBeLessThan(0.5);
      expect(dist(s.planes[i]!.vel, p.vel)).toBeLessThan(0.05);
      expect(s.planes[i]!.alive).toBe(p.alive);
    });
  });

  it('inputs are clamped and malformed packets rejected', () => {
    const d = decodeInput(encodeInput(9, { pitch: 7, roll: -3, yaw: Number.NaN, throttle: 2, fire: true, missile: false, flare: true }))!;
    expect(d.seq).toBe(9);
    expect(d.input).toMatchObject({ pitch: 1, roll: -1, yaw: 0, throttle: 1, fire: true, missile: false, flare: true });
    expect(decodeInput(new ArrayBuffer(4))).toBeNull();
    expect(decodeSnapshot(new ArrayBuffer(3))).toBeNull();
  });
});

describe('host and clients over a fake network', () => {
  it('lobby: clients are welcomed and listed; a different build version is rejected', async () => {
    const r = await rig({ clients: 3, version: ['test', 'test', 'old'] });
    r.step(80);
    expect(r.clients[0]!.phase).toBe('lobby');
    expect(r.clients[1]!.phase).toBe('lobby');
    expect(r.clients[2]!.phase).toBe('rejected');
    expect(r.clients[2]!.rejectReason).toMatch(/version/i);
    expect(r.server.lobby().map((p) => p.name).sort()).toEqual(['P1', 'P2']);
    expect(r.clients[0]!.lobbyPlayers.length).toBe(2);
  });

  it('starting fills the match to 20 with bots, humans on both teams', async () => {
    const r = await rig({ clients: 2 });
    r.step(10);
    r.server.start();
    r.step(10);
    const w = r.server.match!.world;
    expect(w.planes).toHaveLength(20);
    const humans = w.planes.filter((p) => !w.pilots[p.id]!.bot);
    expect(humans.map((p) => p.team).sort()).toEqual(['blue', 'red']);
    expect(r.clients.every((c) => c.phase === 'playing')).toBe(true);
    expect(r.clients[0]!.world.planes).toHaveLength(20);
  });

  it('prediction keeps your own plane close to the host\'s with 100 ms RTT and 10% loss', async () => {
    const r = await rig({ clients: 1, delayMs: 50, loss: 0.1, jitterMs: 10 });
    r.step(10);
    r.server.start();
    r.step(30);
    const c = r.clients[0]!;
    const id = c.playerId;
    let worst = 0;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 60 * 10; i++) {
      // Gentle weaving, like a player flying around.
      r.inputs[0] = { ...neutralInput(1), pitch: 0.25 * Math.sin(i / 40), roll: 0.4 * Math.sin(i / 70) };
      r.step();
      if (i < 60) continue;
      const mine = c.world.planes.find((p) => p.id === id)!;
      const truth = hostPlane(r, id);
      if (!truth.alive || !mine.alive) continue;
      // The host is ~50 ms behind our inputs, so compare with where the host plane will be.
      const ahead = [truth.pos[0] + truth.vel[0] * 0.05, truth.pos[1] + truth.vel[1] * 0.05, truth.pos[2] + truth.vel[2] * 0.05];
      const e = dist(mine.pos, ahead);
      worst = Math.max(worst, e);
      sum += e;
      n++;
    }
    console.log(`prediction error: mean ${(sum / n).toFixed(2)} m, worst ${worst.toFixed(2)} m`);
    expect(sum / n).toBeLessThan(6);
    expect(worst).toBeLessThan(25);
  });

  it('other planes are drawn ~100 ms in the past, smoothly, even with 20% loss', async () => {
    const r = await rig({ clients: 2, delayMs: 40, loss: 0.2 });
    r.step(10);
    r.server.start();
    r.step(60);
    const a = r.clients[0]!;
    const b = r.clients[1]!;
    const history: { t: number; pos: number[] }[] = [];
    let worst = 0;
    let maxJump = 0;
    let last: number[] | null = null;
    for (let i = 0; i < 60 * 8; i++) {
      r.inputs[0] = { ...neutralInput(1), roll: 0.5 * Math.sin(i / 50), pitch: 0.3 };
      r.step();
      const truth = hostPlane(r, a.playerId);
      history.push({ t: r.net.now, pos: [...truth.pos] });
      const seen = b.world.planes.find((p) => p.id === a.playerId)!;
      if (i < 60 || !truth.alive) continue;
      // What B shows should match where A really was ~140 ms ago (100 ms delay + 40 ms one way).
      const target = history.find((h) => h.t >= r.net.now - 140)!;
      worst = Math.max(worst, dist(seen.pos, target.pos));
      if (last) maxJump = Math.max(maxJump, dist(seen.pos, last));
      last = [...seen.pos];
    }
    const speed = Math.hypot(...hostPlane(r, a.playerId).vel);
    console.log(`interpolation: worst offset ${worst.toFixed(1)} m, biggest per-tick move ${maxJump.toFixed(2)} m (speed ${speed.toFixed(0)} m/s)`);
    expect(worst).toBeLessThan(25);
    // No teleporting: never more than ~2 ticks of travel in one tick.
    expect(maxJump).toBeLessThan((speed / 60) * 2.5);
  });

  it('bandwidth per client stays far under 30 KB/s with 20 planes', async () => {
    const r = await rig({ clients: 2 });
    r.step(10);
    r.server.start();
    r.step(60 * 6);
    const s = r.clients[0]!.net!;
    console.log(`client in ${(s.bytesInPerS / 1024).toFixed(1)} KB/s, out ${(s.bytesOutPerS / 1024).toFixed(2)} KB/s, ${s.snapshotsPerS.toFixed(1)} snapshots/s`);
    expect(s.bytesInPerS).toBeLessThan(30 * 1024);
    expect(s.bytesInPerS).toBeLessThan(15 * 1024);
    expect(s.snapshotsPerS).toBeGreaterThan(18);
    expect(s.bytesOutPerS).toBeLessThan(1024);
  });

  it('the host decides hits: spamming fire cannot beat the gun\'s rate of fire', async () => {
    const r = await rig({ clients: 1 });
    r.step(10);
    r.server.start();
    r.step(10);
    const c = r.clients[0]!;
    const truth = hostPlane(r, c.playerId);
    const before = truth.ammo.reduce((x, y) => x + y, 0);
    r.inputs[0] = { ...neutralInput(1), fire: true };
    r.step(60);
    const used = before - hostPlane(r, c.playerId).ammo.reduce((x, y) => x + y, 0);
    // Spitfire Mk V: 2 × 20 mm at 700 rpm + 4 × .303 at 900 rpm = 83 rounds per second.
    expect(used).toBeLessThanOrEqual(90);
    expect(used).toBeGreaterThan(60);
  });

  it('a flood of input packets is rate-limited', async () => {
    const net = createFakeNetwork();
    const ht = await net.host('WXYZ');
    const server = createHostServer(ctx, ht, { version: 'v', era: 'early_ww2', mapId: 'island_chain', difficulty: 'easy', planeFor: () => 'spitfire_mk5', now: () => net.now });
    const ct = await net.join('WXYZ');
    const c = createClientSession(ct, data, { version: 'v', callsign: 'Flood', device: { touch: false, connection: null }, now: () => net.now });
    net.advance(10);
    server.tick(DT);
    server.start();
    for (let i = 0; i < 10; i++) {
      net.advance(STEP_MS);
      server.tick(DT);
    }
    expect(c.phase).toBe('playing');
    // Let the token bucket drain once, then flood 1,200 packets over one second.
    for (let k = 0; k < 200; k++) ct.send('unreliable', encodeInput(k + 1, neutralInput()));
    net.advance(STEP_MS);
    server.tick(DT);
    const start = server.counters.inputsAccepted;
    for (let tick = 0; tick < 60; tick++) {
      for (let k = 0; k < 20; k++) ct.send('unreliable', encodeInput(1000 + tick * 100 + k, { ...neutralInput(), pitch: (k % 2) * 2 - 1 }));
      net.advance(STEP_MS);
      server.tick(DT);
    }
    const accepted = server.counters.inputsAccepted - start;
    expect(accepted).toBeLessThanOrEqual(75);
    expect(accepted).toBeGreaterThan(50);
  });

  it('a player who leaves is replaced by a bot after 10 s; the host leaving ends the match for clients', async () => {
    const r = await rig({ clients: 2 });
    r.step(10);
    r.server.start();
    r.step(30);
    const leaver = r.clients[1]!;
    const id = leaver.playerId;
    leaver.dispose();
    r.clients.splice(1, 1);
    r.inputs.splice(1, 1);
    r.step(60 * 5);
    expect(r.server.match!.world.pilots[id]!.bot).toBe(false);
    r.step(60 * 6);
    expect(r.server.match!.world.pilots[id]!.bot).toBe(true);
    expect(r.server.match!.world.pilots[id]!.name).toContain('(bot)');

    r.server.close();
    r.step(2);
    expect(r.clients[0]!.ended).toBe('hostLeft');
  });

  it('join in progress takes a bot slot and everyone gets the new roster', async () => {
    const r = await rig({ clients: 1 });
    r.step(10);
    r.server.start();
    r.step(30);
    const ct = await r.net.join('ABCD');
    const late = createClientSession(ct, data, { version: 'test', callsign: 'Late', device: { touch: true, connection: 'cellular' }, now: () => r.net.now });
    r.clients.push(late);
    r.inputs.push(neutralInput());
    r.step(30);
    expect(late.phase).toBe('playing');
    const w = r.server.match!.world;
    expect(w.planes).toHaveLength(20);
    expect(w.pilots[late.playerId]?.bot).toBe(false);
    expect(r.clients[0]!.world.pilots[late.playerId]?.name).toBe('Late');
    expect(late.world.planes.find((p) => p.id === late.playerId)).toBeDefined();
  });
});
