import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/data';
import { freshUnlocks } from '../../src/game/unlocks';
import type { ControlInput } from '../../src/game/controls';
import { neutralInput } from '../../src/game/controls';
import { createRng } from '../../src/game/rng';
import { createClientSession, type ClientSession } from '../../src/net/clientSession';
import { createFakeNetwork, type FakeNetwork } from '../../src/net/fakeTransport';
import { createHostServer, type HostServer, type MatchRecorder } from '../../src/net/hostServer';
import {
  decodeInput,
  decodeSnapshot,
  encodeInput,
  encodeSnapshot,
  NO_WEAPONS,
  packQuat,
  PLANE_BYTES,
  unpackQuat,
} from '../../src/net/protocol';
import { createRoom, PARTY_MAX, TEAMS_S, voteCounts } from '../../src/net/room';
import { makeRoomCode, parseRoomCode, ROOM_ALPHABET } from '../../src/net/roomCode';
import { brGap } from '../../src/game/teams';
import type { Quat } from '../../src/game/math';
import type { MissileState } from '../../src/game/missiles';

const result = loadGameData();
if (!result.ok) throw new Error('data invalid');
const data = result.data;
const DT = 1 / 60;
const STEP_MS = 1000 / 60;
const SETTINGS = { difficulty: 'easy' as const, bots: true, matchLengthS: 600 };

/** Lobby → vote (everyone votes Early WW2, Island Chain, TDM) → teams → plane select (Spitfire) → playing. */
function playThrough(server: HostServer, clients: ClientSession[], step: () => void, plane = 'spitfire_mk5'): void {
  expect(server.startVote()).toBe(true);
  for (let i = 0; i < 5; i++) step();
  for (const c of clients) {
    c.request({ t: 'vote', cat: 'era', id: 'early_ww2' });
    c.request({ t: 'vote', cat: 'map', id: 'island_chain' });
    c.request({ t: 'vote', cat: 'mode', id: 'tdm' });
  }
  for (let i = 0; i < 60 * 10 && server.phase !== 'select'; i++) step();
  expect(server.phase).toBe('select');
  for (const c of clients) c.request({ t: 'pick', planeId: plane, lock: true });
  for (let i = 0; i < 120 && server.phase !== 'playing'; i++) step();
  expect(server.phase).toBe('playing');
  for (let i = 0; i < 5; i++) step();
}
const start = (r: Rig): void => playThrough(r.server, r.clients, () => r.step());

interface Rig {
  net: FakeNetwork;
  server: HostServer;
  clients: ClientSession[];
  inputs: (ControlInput | null)[];
  step(n?: number): void;
}

async function rig(opts: {
  clients: number;
  delayMs?: number;
  loss?: number;
  jitterMs?: number;
  version?: string[];
  matchTimeS?: number;
  record?: MatchRecorder;
  uids?: (string | null)[];
  allUnlocked?: boolean;
}): Promise<Rig> {
  const rng = createRng(5);
  const net = createFakeNetwork({ delayMs: opts.delayMs ?? 0, loss: opts.loss ?? 0, jitterMs: opts.jitterMs ?? 0, random: rng });
  const ht = await net.host('ABCD');
  const server = createHostServer(data, ht, {
    version: 'test',
    settings: SETTINGS,
    allUnlocked: opts.allUnlocked ?? true,
    ...(opts.record ? { record: opts.record } : {}),
    now: () => net.now,
    random: rng,
    ...(opts.matchTimeS ? { matchTimeS: opts.matchTimeS } : {}),
  });
  const clients: ClientSession[] = [];
  for (let i = 0; i < opts.clients; i++) {
    const ct = await net.join('ABCD');
    clients.push(
      createClientSession(ct, data, {
        version: opts.version?.[i] ?? 'test',
        callsign: `P${i + 1}`,
        device: { touch: i === 2, connection: null },
        uid: opts.uids?.[i] ?? null,
        now: () => net.now,
      }),
    );
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
    start(r);
    r.step(30);
    const w = r.server.match!.world;
    const buf = encodeSnapshot({ rosterVersion: 1, tick: w.tick, ackSeq: 7, timeLeftS: 432.1, score: { red: 3, blue: 5 }, ended: false }, w.planes, { ammo: [120, 1400], missiles: [2, 4], flares: 24, chaff: 23, lockMount: 1 });
    expect(buf.byteLength).toBeLessThan(15 + 20 * PLANE_BYTES + 16);
    const s = decodeSnapshot(buf)!;
    expect(s.planes).toHaveLength(20);
    expect(s.ackSeq).toBe(7);
    expect(s.own).toEqual({ ammo: [120, 1400], missiles: [2, 4], flares: 24, chaff: 23, lockMount: 1 });
    expect(s.missiles).toEqual([]);
    expect(s.score).toEqual({ red: 3, blue: 5 });
    w.planes.forEach((p, i) => {
      expect(dist(s.planes[i]!.pos, p.pos)).toBeLessThan(0.5);
      expect(dist(s.planes[i]!.vel, p.vel)).toBeLessThan(0.05);
      expect(s.planes[i]!.alive).toBe(p.alive);
    });
  });

  it('missiles, locks and the input target byte round-trip', async () => {
    const r = await rig({ clients: 1 });
    r.step(5);
    start(r);
    r.step(30);
    const w = r.server.match!.world;
    const [a, b] = [w.planes[0]!, w.planes[5]!];
    a.lockTarget = b.id;
    a.lockMount = 0;
    a.lockProgress = 0.5;
    a.missiles = [3, 1];
    const types = ['aim9l', 'aim120b'];
    const missiles: MissileState[] = [
      { id: 300, type: 'aim120b', owner: a.id, team: a.team, target: b.id, pos: [1234.5, 2500, -4321], vel: [800, -20.5, 300], age: 1, blind: 0, rolled: [], boost: 900 },
      { id: 301, type: 'aim9l', owner: b.id, team: b.team, target: 'd17', pos: [0, 100, 0], vel: [0, 0, -1200], age: 1, blind: 0, rolled: [], boost: 900 },
      { id: 302, type: 'aim9l', owner: b.id, team: b.team, target: null, pos: [0, 100, 0], vel: [0, 0, 0], age: 1, blind: 0, rolled: [], boost: 900 },
    ];
    const buf = encodeSnapshot({ rosterVersion: 1, tick: 1, ackSeq: 1, timeLeftS: 1, score: { red: 0, blue: 0 }, ended: false }, w.planes, NO_WEAPONS, missiles, {
      missileTypes: types,
      lockIsRadar: (p) => p === a,
    });
    const s = decodeSnapshot(buf, types)!;
    expect(s.planes[0]).toMatchObject({ lockSlot: 6, lockRadar: true });
    expect(s.planes[0]!.lockProgress).toBeCloseTo(0.5, 1);
    expect(s.planes[5]!.lockSlot).toBe(0);
    expect(s.planes[0]!.missiles).toEqual([3, 1]);
    expect(s.missiles.map((m) => [m.id, m.type, m.ownerSlot, m.targetSlot])).toEqual([
      [300, 'aim120b', 1, 6],
      [301, 'aim9l', 6, 255],
      [302, 'aim9l', 6, 0],
    ]);
    expect(dist(s.missiles[0]!.pos, missiles[0]!.pos)).toBeLessThan(0.5);
    expect(dist(s.missiles[0]!.vel, missiles[0]!.vel)).toBeLessThan(0.05);
    expect(dist(s.missiles[1]!.vel, missiles[1]!.vel)).toBeLessThan(0.05);
    expect(decodeInput(encodeInput(3, { ...neutralInput(), missile: true }, 7))!.targetSlot).toBe(7);
  });

  it("a client's picked target reaches the host as a plane id", async () => {
    const r = await rig({ clients: 1 });
    r.step(5);
    start(r);
    r.step(30);
    const w = r.server.match!.world;
    const me = r.clients[0]!;
    const enemy = w.planes.find((p) => p.team !== w.planes.find((q) => q.id === me.playerId)!.team)!;
    r.inputs[0] = { ...neutralInput(), target: enemy.id };
    r.step(10);
    expect(r.server.inputOf(me.playerId)?.target).toBe(enemy.id);
  });

  it('inputs are clamped and malformed packets rejected', () => {
    const d = decodeInput(encodeInput(9, { pitch: 7, roll: -3, yaw: Number.NaN, throttle: 2, fire: true, missile: false, flare: true, target: null }))!;
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
    expect(r.server.room().players.map((p) => p.name).sort()).toEqual(['P1', 'P2']);
    expect(r.clients[0]!.room!.players.length).toBe(2);
  });

  it('starting fills the match to 20 with bots, humans on both teams', async () => {
    const r = await rig({ clients: 2 });
    r.step(10);
    start(r);
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
    start(r);
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
    start(r);
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
    start(r);
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
    start(r);
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
    const server = createHostServer(data, ht, { version: 'v', settings: SETTINGS, allUnlocked: true, now: () => net.now });
    const ct = await net.join('WXYZ');
    const c = createClientSession(ct, data, { version: 'v', callsign: 'Flood', device: { touch: false, connection: null }, now: () => net.now });
    net.advance(10);
    server.tick(DT);
    playThrough(server, [c], () => {
      c.idle(DT);
      net.advance(STEP_MS);
      server.tick(DT);
    });
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
    start(r);
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
    start(r);
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

describe('room (host-owned lobby state)', () => {
  const device = { touch: false, connection: null };
  const make = (random = () => 0.5) => {
    const room = createRoom(data, { allUnlocked: false, settings: SETTINGS, random });
    for (const [id, host] of [['h1', true], ['h2', false], ['h3', false], ['h4', false], ['h5', false]] as const) room.add({ id, name: id, host, device, rp: 0 });
    return room;
  };

  it('vote: live counts, a tie is broken randomly, the host override wins, unplayable modes are refused', () => {
    const room = make(() => 0.99);
    expect(room.vote('h1', 'era', 'ww1')).toBe(false); // not voting yet
    room.startVote(0);
    room.vote('h1', 'era', 'ww1');
    room.vote('h2', 'era', 'ww1');
    room.vote('h3', 'era', 'modern');
    room.vote('h4', 'era', 'modern');
    expect(room.vote('h5', 'mode', 'air_domination')).toBe(false); // Day 9
    expect(room.vote('h5', 'era', 'not_an_era')).toBe(false);
    expect(voteCounts(room.state(0), 'era')).toEqual({ ww1: 2, modern: 2 });
    room.tick(20_001);
    expect(room.phase).toBe('teams');
    // Tied 2–2: random pick among the tied options (0.99 → the last, alphabetically "ww1").
    expect(room.choice?.era).toBe('ww1');
    expect(room.choice?.mode).toBe('tdm');

    const r2 = make(() => 0);
    r2.startVote(0);
    for (const id of ['h1', 'h2', 'h3']) r2.vote(id, 'era', 'ww1');
    r2.override('era', 'cold_war');
    r2.tick(20_001);
    expect(r2.choice?.era).toBe('cold_war');
  });

  it('the vote ends early once everyone has voted on all three', () => {
    const room = make();
    room.startVote(0);
    for (const p of room.players()) for (const [cat, id] of [['era', 'late_ww2'], ['map', 'desert_mesas'], ['mode', 'tdm']] as const) room.vote(p.id, cat, id);
    room.tick(1000);
    expect(room.phase).toBe('teams');
    expect(room.choice).toEqual({ era: 'late_ww2', mapId: 'desert_mesas', mode: 'tdm' });
  });

  it('parties hold at most 3 and stay on one team; plane picks are checked against each player\'s unlocks', () => {
    const room = make();
    room.setProgress('h2', 1000, { ...freshUnlocks(), early_ww2: 3 });
    expect(room.party('h2', 'h1')).toBe(true);
    expect(room.party('h3', 'h1')).toBe(true);
    expect(room.party('h4', 'h1')).toBe(false); // PARTY_MAX
    expect(PARTY_MAX).toBe(3);
    room.startVote(0);
    for (const p of room.players()) room.vote(p.id, 'era', 'early_ww2');
    room.tick(20_001);
    const team = (id: string) => room.get(id)!.team;
    expect(team('h2')).toBe(team('h1'));
    expect(team('h3')).toBe(team('h1'));
    room.tick(20_001 + TEAMS_S * 1000);
    expect(room.phase).toBe('select');
    expect(room.pick('h2', 'bf109f4', true)).toBe(false); // tier 10: locked without debug
    expect(room.pick('h2', 'sopwith_camel', true)).toBe(false); // wrong era
    expect(room.pick('h2', 'cr42', true)).toBe(true);
    // h3 has only tier 1 researched: the tier-3 CR.42 is locked, and their default is the era's tier 1.
    expect(room.pick('h3', 'cr42', true)).toBe(false);
    const tier1 = data.planes.find((p) => p.era === 'early_ww2' && p.tier === 1)!.id;
    expect(room.get('h3')!.planeId).toBe(tier1);
    expect(room.defaultPlane('h2', 'early_ww2')).toBe('cr42');
    for (const p of room.players()) room.pick(p.id, room.get(p.id)!.planeId!, true);
    expect(room.tick(30_000)).toBe('start');
    expect(room.phase).toBe('playing');
    expect(room.get('h2')!.planeId).toBe('cr42');
    expect(room.state(0).players.find((p) => p.id === 'h2')!.unlocked.early_ww2).toBe(3);
  });

  it('two full rounds on the same connections: vote → play → results → lobby, BR within 10% each time', async () => {
    const r = await rig({ clients: 3, delayMs: 20, matchTimeS: 3 });
    r.step(20);
    for (let round = 1; round <= 2; round++) {
      // Humans fly very different tiers; bots even it out.
      playThrough(r.server, r.clients, () => r.step(), round === 1 ? 'spitfire_mk5' : 'p26');
      expect(r.clients.every((c) => c.phase === 'playing')).toBe(true);
      const br = r.server.room().br!;
      expect(brGap(br)).toBeLessThanOrEqual(0.1);
      r.step(60 * 4);
      expect(r.server.phase).toBe('results');
      expect(r.clients.every((c) => c.ended === 'finished')).toBe(true);
      const res = r.clients[0]!.results!;
      expect(res.rows).toHaveLength(20);
      expect(res.rows.filter((x) => !x.bot).every((x) => x.rp >= 50)).toBe(true);
      expect(res.br).toEqual(br);
      r.clients[1]!.request({ t: 'again' });
      r.step(5);
      expect(r.server.room().players.find((p) => p.id === r.clients[1]!.playerId)!.ready).toBe(true);
      r.server.playAgain();
      r.step(10);
      expect(r.server.phase).toBe('lobby');
      expect(r.clients.every((c) => c.phase === 'lobby' && c.room?.phase === 'lobby')).toBe(true);
      expect(r.server.room().round).toBe(round + 1);
    }
  });

  it('a respawn in a different plane updates the roster everywhere', async () => {
    const r = await rig({ clients: 1 });
    r.step(10);
    start(r);
    const c = r.clients[0]!;
    c.request({ t: 'respawn', planeId: 'p26' });
    r.step(5);
    expect(r.server.match!.world.respawnPlane[c.playerId]).toBe('p26');
    c.request({ t: 'respawn', planeId: 'sopwith_camel' }); // wrong era: ignored
    r.step(5);
    expect(r.server.match!.world.respawnPlane[c.playerId]).toBe('p26');
    // Crash into the sea: the first respawn after that costs SP, so with none it's the free tier-1 (also p26).
    const me = r.server.match!.world.planes.find((p) => p.id === c.playerId)!;
    me.pos[1] = 1;
    me.vel = [0, -80, 0];
    r.step(60 * 7);
    const after = r.server.match!.world.planes.find((p) => p.id === c.playerId)!;
    expect(after.alive).toBe(true);
    expect(after.planeId).toBe('p26');
    expect(c.world.planes.find((p) => p.id === c.playerId)!.planeId).toBe('p26');
  });
});

describe('progress (Day 8)', () => {
  it('the host records each match with every human uid; players get the match id; late joiners are added', async () => {
    const calls: string[] = [];
    const record: MatchRecorder = {
      start: (uids) => {
        calls.push(`start ${uids.join(',')}`);
        return 'm-test';
      },
      join: (id, uid) => calls.push(`join ${id} ${uid}`),
    };
    const r = await rig({ clients: 3, record, uids: ['uA', null, 'not a uid!'] });
    r.step(5);
    start(r);
    // The client without an account and the one sending junk aren't listed (their results can't be saved).
    expect(calls).toEqual(['start uA']);
    expect(r.clients.map((c) => c.matchId)).toEqual(['m-test', 'm-test', 'm-test']);
    expect(r.clients[0]!.participants).toEqual(['uA']);
    const ct = await r.net.join('ABCD');
    const late = createClientSession(ct, data, { version: 'test', callsign: 'Late', device: { touch: false, connection: null }, uid: 'uLate', now: () => r.net.now });
    for (let i = 0; i < 30 && late.phase !== 'playing'; i++) {
      late.idle(DT);
      r.step();
    }
    expect(late.phase).toBe('playing');
    expect(calls).toEqual(['start uA', 'join m-test uLate']);
    expect(late.matchId).toBe('m-test');
    expect(late.participants).toEqual(['uA', 'uLate']);
  });

  it('plane select follows what each player has researched, and a profile update between rounds counts', async () => {
    const r = await rig({ clients: 2, allUnlocked: false });
    r.step(5);
    r.clients[0]!.request({ t: 'profile', rp: 5000, unlocked: { ...freshUnlocks(), early_ww2: 9 } });
    r.step(5);
    const p1 = r.server.room().players.find((p) => p.id === r.clients[0]!.playerId)!;
    expect(p1.unlocked.early_ww2).toBe(9);
    expect(p1.rp).toBe(5000);
    // Both ask for the tier-9 Spitfire: only the one who researched it gets it (the other one's pick is
    // refused, so plane select runs to its timer and they fly their best open plane).
    expect(r.server.startVote()).toBe(true);
    for (const c of r.clients) for (const [cat, id] of [['era', 'early_ww2'], ['map', 'island_chain'], ['mode', 'tdm']] as const) c.request({ t: 'vote', cat, id });
    for (let i = 0; i < 60 * 10 && r.server.phase !== 'select'; i++) r.step();
    for (const c of r.clients) c.request({ t: 'pick', planeId: 'spitfire_mk5', lock: true });
    for (let i = 0; i < 60 * 30 && r.server.phase !== 'playing'; i++) r.step();
    expect(r.server.phase).toBe('playing');
    const planeOf = (c: ClientSession) => r.server.match!.world.planes.find((p) => p.id === c.playerId)!.planeId;
    expect(planeOf(r.clients[0]!)).toBe('spitfire_mk5');
    expect(data.planes.find((p) => p.id === planeOf(r.clients[1]!))!.tier).toBe(1);
  });
});
