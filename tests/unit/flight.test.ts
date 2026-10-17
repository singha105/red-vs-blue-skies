import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/data';
import type { GameData } from '../../src/data/types';
import { aimControl, createAimPd } from '../../src/game/autopilot';
import { neutralInput, type ControlInput } from '../../src/game/controls';
import { stepPlane, type FlightEnv, type FlightParams, type PlaneState } from '../../src/game/flight';
import { dirFromYawPitch, dot, FORWARD, len, quatFromAxisAngle, quatLookRotation, rotate, type Vec3 } from '../../src/game/math';
import { createWorld, createWorldContext, spawnPlane, stepWorld, type WorldContext } from '../../src/game/world';

const DT = 1 / 60;
const result = loadGameData();
if (!result.ok) throw new Error('data invalid');
const data: GameData = result.data;
const ctx: WorldContext = createWorldContext(data, 'island_chain');
const sky: FlightEnv = { surfaceAt: () => -1e9, half: 1e9 }; // nothing to hit

function plane(planeId = 'spitfire_mk5', over: Partial<PlaneState> = {}): PlaneState {
  const p = ctx.params.get(planeId)!;
  return {
    id: 't',
    team: 'blue',
    planeId,
    pos: [0, 2000, 0],
    quat: [0, 0, 0, 1],
    vel: [0, 0, p.topSpeedMs * 0.6],
    throttle: 1,
    hp: 100,
    stalled: false,
    alive: true,
    g: 1,
    edgeWarning: false,
    autoTurn: false,
    respawnIn: 0,
    maxHp: 100,
    protectedFor: 0,
    damaged: { engine: false, wingL: false, wingR: false },
    partDamage: { fuselage: 0, wingL: 0, wingR: 0, engine: 0 },
    fireFor: 0,
    damageBy: {},
    lastHitBy: null,
    lastHitAt: -1e9,
    wreck: false,
    ammo: [],
    gunHeat: [],
    assist: 0,
    firing: false,
    missiles: [],
    flares: 0,
    chaff: 0,
    lockTarget: null,
    lockMount: -1,
    lockProgress: 0,
    missileCooldown: 0,
    cmCooldown: 0,
    missileHeld: false,
    rockets: 0,
    bombs: 0,
    ordnanceCooldown: 0,
    wep: false,
    engineHeat: 0,
    overheatFor: 0,
    airbrake: false,
    flaps: false,
    radarOn: false,
    radarMode: 'search',
    radarRange: 1,
    radarLock: null,
    radarLostFor: 0,
    secondary: -1,
    ...over,
  };
}

function fly(s: PlaneState, seconds: number, input: ControlInput | ((s: PlaneState) => ControlInput), env = sky, over: Partial<FlightParams> = {}): PlaneState {
  const params = { ...ctx.params.get(s.planeId)!, ...over };
  for (let t = 0; t < seconds; t += DT) stepPlane(s, typeof input === 'function' ? input(s) : input, params, env, DT);
  return s;
}

const holdLevel = (s: PlaneState): ControlInput => {
  const pd = (holdLevel as unknown as { pd?: ReturnType<typeof createAimPd> }).pd ?? createAimPd();
  const dir = rotate(s.quat, FORWARD);
  const flat: Vec3 = [dir[0], 0, dir[2]];
  const aim = dirFromYawPitch(Math.atan2(-flat[0], flat[2]), 0);
  return { ...neutralInput(1), ...aimControl(s, aim, pd, DT) };
};

describe('flight model', () => {
  it('reaches about top speed with WEP, about 92% of it at 100% without', () => {
    const p = ctx.params.get('spitfire_mk5')!;
    // An engine that never overheats, to measure the speed WEP holds.
    const s = fly(plane(), 120, (st) => ({ ...holdLevel(st), wep: true }), sky, { wepTimeS: 1e6 });
    expect(len(s.vel)).toBeGreaterThan(p.topSpeedMs * 0.93);
    expect(len(s.vel)).toBeLessThan(p.topSpeedMs * 1.05);
    expect(s.stalled).toBe(false);
    const mil = fly(plane(), 120, holdLevel);
    expect(len(mil.vel)).toBeGreaterThan(p.topSpeedMs * 0.88);
    expect(len(mil.vel)).toBeLessThan(p.topSpeedMs * 0.95);
  });

  it('WEP heats the engine; overheating cuts power for 10 s, then it cools', () => {
    const p = ctx.params.get('f16c_b50')!;
    const s = plane('f16c_b50');
    fly(s, p.wepTimeS * 0.5, (st) => ({ ...holdLevel(st), wep: true }));
    expect(s.wep).toBe(true);
    expect(s.engineHeat).toBeGreaterThan(0.45);
    fly(s, p.wepTimeS * 0.5 + 0.3, (st) => ({ ...holdLevel(st), wep: true }));
    expect(s.engineHeat).toBeGreaterThan(0.98);
    expect(s.overheatFor).toBeGreaterThan(9.5);
    expect(s.wep).toBe(false);
    const hot = len(s.vel);
    fly(s, 8, (st) => ({ ...holdLevel(st), wep: true }));
    expect(len(s.vel)).toBeLessThan(hot);
    fly(s, 3, (st) => ({ ...holdLevel(st), wep: true }));
    expect(s.overheatFor).toBe(0);
    // WEP needs full throttle.
    const half = plane('f16c_b50');
    fly(half, 2, (st) => ({ ...holdLevel(st), throttle: 0.9, wep: true }));
    expect(half.wep).toBe(false);
  });

  it('the airbrake slows the plane and flaps lower the stall speed', () => {
    const a = plane('f16c_b50');
    const b = plane('f16c_b50');
    fly(a, 10, holdLevel);
    fly(b, 10, (st) => ({ ...holdLevel(st), airbrake: true }));
    expect(len(b.vel)).toBeLessThan(len(a.vel) * 0.9);
    const p = ctx.params.get('spitfire_mk5')!;
    const slow = (flaps: boolean): PlaneState => {
      const s = plane('spitfire_mk5', { vel: [0, 0, p.stallSpeedMs * 0.95], throttle: 0.6 });
      fly(s, 0.2, { ...neutralInput(0.6), flaps });
      return s;
    };
    expect(slow(false).stalled).toBe(true);
    expect(slow(true).stalled).toBe(false);
  });

  it('Day 12: flap steps lower the stall speed in order, and lowered gear adds drag', () => {
    const p = ctx.params.get('spitfire_mk5')!;
    const stalls = (flapStep: number): boolean => {
      const s = plane('spitfire_mk5', { vel: [0, 0, p.stallSpeedMs * 0.9], throttle: 0.6 });
      fly(s, 0.2, { ...neutralInput(0.6), flaps: flapStep > 0, flapStep });
      return s.stalled;
    };
    expect(stalls(0)).toBe(true);
    expect(stalls(1)).toBe(true); // Combat flaps: a little lift, not enough at 0.9× stall speed
    expect(stalls(3)).toBe(false);
    const up = plane('f16c_b50');
    const down = plane('f16c_b50');
    fly(up, 10, holdLevel);
    fly(down, 10, (st) => ({ ...holdLevel(st), gear: true }));
    expect(down.gear).toBe(true);
    expect(len(down.vel)).toBeLessThan(len(up.vel) * 0.97);
  });

  it('stalls when slow, the nose drops, and it recovers with speed', () => {
    const p = ctx.params.get('spitfire_mk5')!;
    // Nose high, idle, slow.
    const s = plane('spitfire_mk5', { vel: [0, 0, p.stallSpeedMs * 0.9], throttle: 0, quat: quatFromAxisAngle([1, 0, 0], -0.5) });
    const idlePull = { ...neutralInput(0), pitch: 1 };
    fly(s, 1, idlePull);
    expect(s.stalled).toBe(true);
    const noseBefore = rotate(s.quat, FORWARD)[1];
    fly(s, 3, idlePull);
    expect(rotate(s.quat, FORWARD)[1]).toBeLessThan(noseBefore); // nose fell
    expect(s.vel[1]).toBeLessThan(0); // sinking
    // Let go, full power: recovers.
    fly(s, 15, holdLevel);
    expect(s.stalled).toBe(false);
    expect(len(s.vel)).toBeGreaterThan(p.stallSpeedMs * 1.2);
  });

  it('dives gain speed and climbs lose it', () => {
    const p = ctx.params.get('spitfire_mk5')!;
    const start = p.topSpeedMs * 0.7;
    const dive = fly(plane('spitfire_mk5', { quat: quatFromAxisAngle([1, 0, 0], 0.6), vel: rotate(quatFromAxisAngle([1, 0, 0], 0.6), [0, 0, start]), throttle: 0.5 }), 5, neutralInput(0.5));
    const climb = fly(plane('spitfire_mk5', { quat: quatFromAxisAngle([1, 0, 0], -0.6), vel: rotate(quatFromAxisAngle([1, 0, 0], -0.6), [0, 0, start]), throttle: 0.5 }), 5, neutralInput(0.5));
    expect(len(dive.vel)).toBeGreaterThan(start + 10);
    expect(len(climb.vel)).toBeLessThan(start - 10);
  });

  it('a sustained hard turn bleeds speed, more G bleeds more', () => {
    const turn = (pull: number): number => {
      const s = plane();
      fly(s, 0.6, { ...neutralInput(1), roll: 1 }); // roll into ~70° bank
      fly(s, 6, { ...neutralInput(1), pitch: pull });
      return len(s.vel);
    };
    const level = len(fly(plane(), 6.6, holdLevel).vel);
    const gentle = turn(0.3);
    const hard = turn(1);
    expect(hard).toBeLessThan(gentle);
    expect(gentle).toBeLessThan(level);
  });

  it('runs out of thrust at the service ceiling', () => {
    const s = plane('fokker_e3', { pos: [0, 6400, 0] });
    fly(s, 30, holdLevel);
    expect(s.pos[1]).toBeLessThan(6500);
    expect(len(s.vel)).toBeLessThan(ctx.params.get('fokker_e3')!.topSpeedMs * 0.8);
  });

  it('crashes into terrain and water', () => {
    const floor: FlightEnv = { surfaceAt: () => 1990, half: 1e9 };
    const s = plane('spitfire_mk5', { quat: quatFromAxisAngle([1, 0, 0], 0.8) });
    fly(s, 3, neutralInput(1), floor);
    expect(s.alive).toBe(false);
  });

  it('warns near the edge and turns back past it', () => {
    const w = createWorld(ctx);
    const s = spawnPlane(w, ctx, { id: 'e', team: 'blue', planeId: 'spitfire_mk5' });
    s.pos = [ctx.terrain.half - 300, 2500, 0];
    s.quat = quatLookRotation([1, 0, 0]);
    s.vel = [140, 0, 0];
    for (let i = 0; i < 60; i++) stepWorld(w, ctx, { e: neutralInput(1) }, DT);
    expect(s.edgeWarning).toBe(true);
    for (let i = 0; i < 60 * 40; i++) stepWorld(w, ctx, { e: neutralInput(1) }, DT);
    expect(Math.abs(s.pos[0])).toBeLessThan(ctx.terrain.half);
    expect(s.alive).toBe(true);
  });

  it('every plane in the roster flies level at its top speed without stalling or diverging', () => {
    for (const def of data.planes) {
      const s = plane(def.id);
      fly(s, 60, (st) => ({ ...holdLevel(st), wep: true }), sky, { wepTimeS: 1e6 });
      const p = ctx.params.get(def.id)!;
      expect(Number.isFinite(s.pos[0]), def.id).toBe(true);
      expect(s.stalled, def.id).toBe(false);
      expect(len(s.vel), def.id).toBeGreaterThan(p.topSpeedMs * 0.85);
    }
  });
});

describe('mouse-aim autopilot', () => {
  it('puts the nose on an aim point 90° to the right and holds it', () => {
    const s = plane();
    const pd = createAimPd();
    const aim = dirFromYawPitch(Math.PI / 2, 0.1);
    fly(s, 12, (st) => ({ ...neutralInput(1), ...aimControl(st, aim, pd, DT) }));
    expect(dot(rotate(s.quat, FORWARD), aim)).toBeGreaterThan(0.995);
    // Wings roughly level once on target.
    expect(Math.abs(rotate(s.quat, [-1, 0, 0])[1])).toBeLessThan(0.2);
  });

  it('keyboard override replaces the autopilot on that axis', () => {
    const s = plane();
    const out = aimControl(s, [0, 0, 1], createAimPd(), DT, { roll: -1 });
    expect(out.roll).toBe(-1);
  });
});

describe('world', () => {
  it('state survives a JSON round trip unchanged (network-ready)', () => {
    const w = createWorld(ctx);
    spawnPlane(w, ctx, { id: 'a', team: 'red', planeId: 'f22a' });
    spawnPlane(w, ctx, { id: 'b', team: 'blue', planeId: 'fokker_dr1' });
    for (let i = 0; i < 120; i++) stepWorld(w, ctx, {}, DT);
    expect(JSON.parse(JSON.stringify(w))).toEqual(w);
  });

  it('a crashed plane respawns in the air after the timer', () => {
    const w = createWorld(ctx);
    const s = spawnPlane(w, ctx, { id: 'a', team: 'red', planeId: 'p51d' });
    s.alive = false;
    for (let i = 0; i < 60 * 5.2; i++) stepWorld(w, ctx, {}, DT);
    const again = w.planes.find((p) => p.id === 'a')!;
    expect(again.alive).toBe(true);
    expect(again.pos[1]).toBeGreaterThan(1000);
  });

  it('terrain is deterministic and has islands above water', () => {
    const t2 = createWorldContext(data, 'island_chain').terrain;
    let land = 0;
    for (let x = -8000; x <= 8000; x += 250) {
      for (let z = -8000; z <= 8000; z += 250) {
        const h = ctx.terrain.heightAt(x, z);
        expect(h).toBe(t2.heightAt(x, z));
        if (h > 0) land++;
      }
    }
    expect(land).toBeGreaterThan(200);
    // Spawn points are over open water.
    for (const sp of [ctx.map.spawns.red, ctx.map.spawns.blue]) expect(ctx.terrain.heightAt(sp[0], sp[2])).toBeLessThan(0);
  });

  it('src/game never imports three.js or touches the DOM', () => {
    const dir = new URL('../../src/game/', import.meta.url);
    for (const file of readdirSync(dir)) {
      const text = readFileSync(new URL(file, dir), 'utf8');
      expect(text, file).not.toMatch(/from ['"]three/);
      expect(text, file).not.toMatch(/\b(document|window)\./);
    }
  });
});
