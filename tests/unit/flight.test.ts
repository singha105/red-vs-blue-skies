import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/data';
import type { GameData } from '../../src/data/types';
import { aimControl, createAimPd } from '../../src/game/autopilot';
import { neutralInput, type ControlInput } from '../../src/game/controls';
import { stepPlane, type FlightEnv, type PlaneState } from '../../src/game/flight';
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
    ...over,
  };
}

function fly(s: PlaneState, seconds: number, input: ControlInput | ((s: PlaneState) => ControlInput), env = sky): PlaneState {
  const params = ctx.params.get(s.planeId)!;
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
  it('reaches about top speed at full throttle in level flight', () => {
    const p = ctx.params.get('spitfire_mk5')!;
    const s = fly(plane(), 120, holdLevel);
    expect(len(s.vel)).toBeGreaterThan(p.topSpeedMs * 0.93);
    expect(len(s.vel)).toBeLessThan(p.topSpeedMs * 1.05);
    expect(s.stalled).toBe(false);
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
      fly(s, 60, holdLevel);
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
