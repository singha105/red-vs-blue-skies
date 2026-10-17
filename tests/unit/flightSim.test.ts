import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/data';
import type { GameData } from '../../src/data/types';
import { aimControl, createAimPd } from '../../src/game/autopilot';
import { neutralInput, type ControlInput } from '../../src/game/controls';
import { G, type FlightEnv, type FlightParams, type PlaneState } from '../../src/game/flight';
import { ALPHA_CRIT, simParams, stepPlaneSim, type SimParams } from '../../src/game/flightSim';
import { dirFromYawPitch, dot, FORWARD, rotate } from '../../src/game/math';
import { createSoloMatch, stepMatch } from '../../src/game/match';
import { createWorld, createWorldContext, spawnPlane, type WorldContext } from '../../src/game/world';

// The Realistic flight model (flightSim.ts): calibrated to planes.json, and behaving like an aeroplane.
const DT = 1 / 60;
const result = loadGameData();
if (!result.ok) throw new Error('data invalid');
const data: GameData = result.data;
const ctx: WorldContext = createWorldContext(data, 'island_chain');
const sky: FlightEnv = { surfaceAt: () => -1e9, half: 1e9 };
const deg = 180 / Math.PI;

function setup(planeId: string, speed: number, alt = 1000): { s: PlaneState; p: FlightParams; sp: SimParams } {
  const world = createWorld(ctx, 1);
  const s = spawnPlane(world, ctx, { id: 'a', team: 'blue', planeId });
  s.pos = [0, alt, 0];
  s.quat = [0, 0, 0, 1];
  s.vel = [0, 0, speed];
  s.throttle = 1;
  const p = ctx.params.get(planeId)!;
  return { s, p, sp: simParams(p) };
}

const fly = (x: { s: PlaneState; p: FlightParams; sp: SimParams }, input: Partial<ControlInput>, seconds: number, each?: () => void): void => {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    stepPlaneSim(x.s, { ...neutralInput(1), ...input }, x.p, x.sp, sky, DT);
    each?.();
  }
};

/** Level flight at `alt` with a damped altitude hold on the stick. */
const holdAltitude = (x: { s: PlaneState; p: FlightParams; sp: SimParams }, alt: number, seconds: number, input: Partial<ControlInput> = {}, each?: () => void): void => {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    const pitch = Math.max(-1, Math.min(1, (alt - x.s.pos[1]) * 0.004 - x.s.vel[1] * 0.03 - (x.s.rates?.[1] ?? 0) * 0.3));
    stepPlaneSim(x.s, { ...neutralInput(1), ...input, pitch }, x.p, x.sp, sky, DT);
    each?.();
  }
};

const speedOf = (s: PlaneState): number => Math.hypot(...s.vel);
const SAMPLE = ['sopwith_camel', 'bf109e4', 'f4u4', 'mig15bis', 'f15c'];

describe('Realistic flight model: calibration to planes.json', () => {
  it('every plane: full thrust balances drag at its top speed, and the best sustained turn is its listed turn rate', () => {
    let turnMatched = 0;
    for (const plane of data.planes) {
      const p = ctx.params.get(plane.id)!;
      const sp = simParams(p);
      const v = p.topSpeedMs;
      const drag = sp.cd0 * v * v + (sp.ki * G * G) / (v * v);
      expect(Math.abs(drag - p.thrustAccel) / p.thrustAccel, plane.id).toBeLessThan(0.01);
      expect(sp.cd0, plane.id).toBeGreaterThan(0);
      // Never better than listed; where the wing can't sustain the listed rate the plane turns a little worse.
      expect(sp.sustainedTurn, plane.id).toBeLessThan(p.turnRateRad * 1.03);
      if (Math.abs(sp.sustainedTurn - p.turnRateRad) / p.turnRateRad < 0.03) turnMatched++;
      // Wing-limited (the stall speed and G limit can't give the listed rate): today 8 planes at 70–96%.
      else expect(sp.sustainedTurn / p.turnRateRad, plane.id).toBeGreaterThan(0.65);
    }
    expect(turnMatched / data.planes.length).toBeGreaterThan(0.8);
  });

  it('level flight at military power reaches √0.85 of top speed, as in Arcade', () => {
    for (const id of SAMPLE) {
      const x = setup(id, ctx.params.get(id)!.topSpeedMs * 0.85, 300);
      holdAltitude(x, 300, 150);
      // √0.85 = 0.922 at sea level; slightly faster in the thinner air at 300 m.
      const ratio = speedOf(x.s) / x.p.topSpeedMs;
      expect(ratio, id).toBeGreaterThan(0.91);
      expect(ratio, id).toBeLessThan(0.96);
      expect(Math.abs(x.s.pos[1] - 300), id).toBeLessThan(25);
    }
  });

  it('every plane: full aileron settles at its listed roll rate at the reference speed', () => {
    for (const plane of data.planes) {
      const x = setup(plane.id, ctx.params.get(plane.id)!.cornerSpeedMs, 0);
      fly(x, { roll: 1 }, 1);
      expect(x.s.rates![0] / x.p.rollRateRad, plane.id).toBeGreaterThan(0.9);
      expect(x.s.rates![0] / x.p.rollRateRad, plane.id).toBeLessThan(1.1);
    }
  });
});

describe('Realistic flight model: behaviour', () => {
  it('controls are soft when slow and quick when fast: roll rate and its response grow with airspeed', () => {
    const slow = setup('bf109e4', ctx.params.get('bf109e4')!.cornerSpeedMs * 0.6, 0);
    const fast = setup('bf109e4', ctx.params.get('bf109e4')!.cornerSpeedMs * 1.2, 0);
    fly(slow, { roll: 1 }, 0.15);
    fly(fast, { roll: 1 }, 0.15);
    expect(fast.s.rates![0]).toBeGreaterThan(slow.s.rates![0] * 1.5);
  });

  it('full back stick when slow stalls the wing; letting go and diving recovers it', () => {
    const x = setup('f4u4', ctx.params.get('f4u4')!.stallSpeedMs * 1.3, 2000);
    let maxAoa = 0;
    let stalled = false;
    fly(x, { pitch: 1 }, 3, () => {
      maxAoa = Math.max(maxAoa, x.s.aoa!);
      stalled ||= x.s.stalled;
    });
    expect(stalled).toBe(true);
    expect(maxAoa).toBeGreaterThan(ALPHA_CRIT);
    fly(x, { pitch: -0.3 }, 6);
    expect(x.s.stalled).toBe(false);
    expect(Math.abs(x.s.aoa!)).toBeLessThan(ALPHA_CRIT);
    expect(x.s.alive).toBe(true);
  });

  it('above corner speed the pilot G limit holds a full pull near the plane maximum, not past it', () => {
    const x = setup('f15c', ctx.params.get('f15c')!.cornerSpeedMs * 1.5, 3000);
    let maxG = 0;
    fly(x, { pitch: 1 }, 2, () => (maxG = Math.max(maxG, x.s.g)));
    expect(maxG).toBeGreaterThan(x.p.maxG * 0.85);
    expect(maxG).toBeLessThan(x.p.maxG * 1.05);
  });

  it('hard turns bleed energy: pulling G costs far more energy (speed and height) than flying straight', () => {
    const v0 = ctx.params.get('spitfire_mk5')!.cornerSpeedMs * 1.4;
    const energy = (s: PlaneState): number => 0.5 * speedOf(s) ** 2 + G * s.pos[1];
    const level = setup('spitfire_mk5', v0, 2000);
    const turn = setup('spitfire_mk5', v0, 2000);
    const e0 = energy(level.s);
    fly(level, {}, 5);
    fly(turn, { roll: 1 }, 0.6);
    let maxG = 0;
    fly(turn, { pitch: 0.7 }, 4.4, () => (maxG = Math.max(maxG, turn.s.g)));
    expect(maxG).toBeGreaterThan(3);
    expect(e0 - energy(turn.s)).toBeGreaterThan((e0 - energy(level.s)) * 3 + 1000);
  });

  it('right rudder yaws the nose right of the flight path, and the slip rolls the plane right (dihedral)', () => {
    const x = setup('spitfire_mk5', ctx.params.get('spitfire_mk5')!.cornerSpeedMs * 1.2, 2000);
    fly(x, { yaw: 1 }, 1.5);
    expect(x.s.slip! * deg).toBeLessThan(-4);
    expect(x.s.slip! * deg).toBeGreaterThan(-12);
    expect(x.s.rates![0]).toBeGreaterThan(0.05);
    const nose = rotate(x.s.quat, FORWARD);
    expect(nose[0]).toBeLessThan(-0.05); // +X is the left wing: the nose has swung to the right
  });

  it('ailerons yaw the nose the wrong way at first (adverse yaw)', () => {
    const x = setup('sopwith_camel', ctx.params.get('sopwith_camel')!.cornerSpeedMs, 2000);
    fly(x, { roll: 1 }, 0.3);
    expect(x.s.rates![2]).toBeLessThan(0);
  });

  it('flaps lower the stall speed by about 15%', () => {
    const stallSpeed = (flaps: boolean): number => {
      const x = setup('f6f5', ctx.params.get('f6f5')!.stallSpeedMs * 1.3, 300);
      let v = 0;
      holdAltitude(x, 300, 70, { throttle: 0, flaps }, () => {
        if (!v && (x.s.aoa ?? 0) >= ALPHA_CRIT * (flaps ? 0.93 : 1)) v = speedOf(x.s);
      });
      return v;
    };
    const clean = stallSpeed(false);
    const flapped = stallSpeed(true);
    expect(clean).toBeGreaterThan(0);
    expect(flapped / clean).toBeGreaterThan(0.78);
    expect(flapped / clean).toBeLessThan(0.92);
  });

  it('thin air: level flight at 6,000 m needs a higher angle of attack than at 300 m at the same speed', () => {
    const v = ctx.params.get('p51d')!.cornerSpeedMs * 1.2;
    const low = setup('p51d', v, 300);
    const high = setup('p51d', v, 6000);
    holdAltitude(low, 300, 6, { throttle: 0.6 });
    holdAltitude(high, 6000, 6, { throttle: 0.6 });
    expect(high.s.aoa!).toBeGreaterThan(low.s.aoa! * 1.3);
  });

  it('a shot-up left wing rolls the plane to the left with the stick centred', () => {
    const x = setup('bf109e4', ctx.params.get('bf109e4')!.cornerSpeedMs, 2000);
    x.s.damaged.wingL = true;
    fly(x, {}, 0.5);
    expect(x.s.rates![0]).toBeLessThan(-0.05);
  });

  it('mouse aim flies it: the nose settles on an aim 90° away within a degree or two', () => {
    for (const id of ['sopwith_camel', 'spitfire_mk5', 'mig15bis', 'f15c']) {
      const x = setup(id, ctx.params.get(id)!.cornerSpeedMs * 1.3, 2000);
      const pd = createAimPd();
      const aim = dirFromYawPitch(Math.PI / 2, 0);
      let settled = Infinity;
      for (let i = 0; i < 60 * 12; i++) {
        stepPlaneSim(x.s, { ...neutralInput(1), ...aimControl(x.s, aim, pd, DT) }, x.p, x.sp, sky, DT);
        settled = Math.acos(Math.min(1, dot(rotate(x.s.quat, FORWARD), aim))) * deg;
      }
      expect(settled, id).toBeLessThan(2);
    }
  });

  it('deterministic and JSON-safe: same seed, same match; state survives a JSON round trip; nothing NaN', () => {
    const run = (): string => {
      const m = createSoloMatch(ctx, { era: 'late_ww2', planeId: 'p51d', difficulty: 'normal', seed: 5, flightModel: 'realistic' });
      for (let i = 0; i < 60 * 20; i++) stepMatch(m, ctx, {}, DT);
      expect(m.world.planes.every((p) => p.pos.every(Number.isFinite) && p.vel.every(Number.isFinite))).toBe(true);
      expect(m.world.planes.some((p) => p.rates !== undefined)).toBe(true);
      return JSON.stringify(m.world);
    };
    const a = run();
    expect(run()).toBe(a);
    expect(JSON.stringify(JSON.parse(a))).toBe(a);
  });

  it('bots fly it: 20 bots for two minutes rarely hit the ground and still shoot each other down', () => {
    const m = createSoloMatch(ctx, { era: 'late_ww2', planeId: 'p51d', difficulty: 'normal', seed: 3, flightModel: 'realistic' });
    expect(m.world.flightModel).toBe('realistic');
    let crashes = 0;
    let kills = 0;
    for (let i = 0; i < 60 * 120; i++) {
      stepMatch(m, ctx, {}, DT);
      for (const e of m.world.events) if (e.t === 'kill') e.weapon === 'crash' ? crashes++ : kills++;
    }
    expect(crashes).toBeLessThanOrEqual(3);
    expect(kills).toBeGreaterThan(0);
  });

  it('Arcade is untouched: no Realistic state on Arcade planes', () => {
    const m = createSoloMatch(ctx, { era: 'late_ww2', planeId: 'p51d', difficulty: 'normal', seed: 3 });
    for (let i = 0; i < 120; i++) stepMatch(m, ctx, {}, DT);
    expect(m.world.flightModel).toBeUndefined();
    expect(m.world.planes.every((p) => p.rates === undefined && p.surfaces === undefined)).toBe(true);
  });
});
