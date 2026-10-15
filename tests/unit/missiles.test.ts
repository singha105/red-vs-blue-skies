import { appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { neutralInput } from '../../src/game/controls';
import { normalize, quatLookRotation, scale, type Vec3 } from '../../src/game/math';
import { heatOf, irBlocked, launch, notching, stepWeapons } from '../../src/game/missiles';
import { createSoloMatch, stepMatch } from '../../src/game/match';
import { createWorld, spawnPlane } from '../../src/game/world';
import { ALT, ctx, DT, engage, flareDefense, mcOf, notchDefense, place } from './missileHarness';

describe('missiles: guidance', () => {
  it.each([
    ['aim9l', 0, 2500],
    ['aim9l', 135, 2000],
    ['aim9x', 60, 2500],
    ['r73', 160, 2000],
    ['aim120b', 180, 6000],
    ['aim120b', 20, 4000],
    ['aim7f', 150, 5000],
    ['aim9b', 0, 1800, 'f8', 'mig19s'],
    ['k13', 15, 1800, 'mig21f13', 'f104g'],
  ])('%s hits a non-manoeuvring target (aspect %i°, %i m)', (missile, aspectDeg, rangeM, shooterPlane?: string, targetPlane?: string) => {
    const r = engage({ missile, aspectDeg, rangeM, shooterPlane, targetPlane });
    expect(r.hit).toBe(true);
  });

  it('proportional navigation leads a crossing target instead of chasing it', () => {
    // A 45° crossing shot: pure pursuit would swing round into a tail chase (≈45° of turning); PN turns
    // once onto the collision course (the lead angle, ≈20° here) and then flies straight.
    const headings: Vec3[] = [];
    const r = engage({
      missile: 'aim9l',
      aspectDeg: 45,
      rangeM: 2500,
      defend: (w, t) => {
        const ms = w.missiles[0];
        if (ms) headings.push(normalize(ms.vel));
        return neutralInput(t.throttle);
      },
    });
    expect(r.hit).toBe(true);
    const turn = (a: Vec3, b: Vec3): number => (Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) * 180) / Math.PI;
    expect(turn(headings[0]!, headings[headings.length - 1]!)).toBeLessThan(30);
    // Second half of the flight is nearly straight.
    expect(turn(headings[Math.floor(headings.length / 2)]!, headings[headings.length - 1]!)).toBeLessThan(10);
  });

  it('after burnout the missile slows and can be outrun', () => {
    // AIM-9B fired at its max range at a jet running away at full throttle never catches it.
    const r = engage({ missile: 'aim9b', aspectDeg: 0, rangeM: 2500, shooterPlane: 'f8', targetPlane: 'f8', targetThrottle: 1, targetSpeed: 1, defend: () => neutralInput(1) });
    expect(r.hit).toBe(false);
  });
});

describe('missiles: seekers', () => {
  it('rear-aspect IR needs the tail within 45°; all-aspect sees head-on', () => {
    const w = createWorld(ctx, 1);
    const s = spawnPlane(w, ctx, { id: 's', team: 'blue', planeId: 'f4e' });
    const t = spawnPlane(w, ctx, { id: 't', team: 'red', planeId: 'mig21f13' });
    place(s, [0, ALT, 0], [0, 0, 1], 0.7);
    const rear = ctx.missileDefs.get('aim9b')!;
    const all = ctx.missileDefs.get('aim9l')!;
    const rearCls = ctx.missileClasses.get(rear.class)!;
    const allCls = ctx.missileClasses.get(all.class)!;
    const tDef = ctx.planeDefs.get('mig21f13');
    // Tail-on at 1.5 km: both see it.
    place(t, [0, ALT, 1500], [0, 0, 1], 0.7);
    expect(irBlocked(s.pos, [0, 0, 1], t, tDef, rear, rearCls, rear.coneDeg)).toBeNull();
    // Head-on: rear-aspect can't, all-aspect can.
    place(t, [0, ALT, 1500], [0, 0, -1], 0.7);
    expect(irBlocked(s.pos, [0, 0, 1], t, tDef, rear, rearCls, rear.coneDeg)).toBe('aspect');
    expect(irBlocked(s.pos, [0, 0, 1], t, tDef, all, allCls, all.coneDeg)).toBeNull();
  });

  it('afterburner makes a plane hotter and lockable from further away', () => {
    const w = createWorld(ctx, 1);
    const t = spawnPlane(w, ctx, { id: 't', team: 'red', planeId: 'f16c_b50' });
    const def = ctx.planeDefs.get('f16c_b50');
    t.throttle = 0.6;
    const mil = heatOf(t, def);
    t.throttle = 1;
    expect(heatOf(t, def)).toBeCloseTo(1.4, 5);
    expect(heatOf(t, def)).toBeGreaterThan(mil * 1.4);
  });

  it('the sun within 10° of the line of sight blinds an IR seeker', () => {
    const w = createWorld(ctx, 1);
    const t = spawnPlane(w, ctx, { id: 't', team: 'red', planeId: 'f16c_b50' });
    t.throttle = 1;
    const m = ctx.missileDefs.get('aim9l')!;
    const cls = ctx.missileClasses.get(m.class)!;
    const from: Vec3 = [0, 1000, 0];
    const sun: Vec3 = normalize([-0.45, 0.75, 0.48]);
    t.pos = [sun[0] * 2000, 1000 + sun[1] * 2000, sun[2] * 2000];
    t.vel = scale(sun, 300); // flying away: tail toward the seeker
    t.quat = quatLookRotation(sun);
    expect(irBlocked(from, sun, t, ctx.planeDefs.get('f16c_b50'), m, cls, m.coneDeg)).toBe('sun');
  });

  it('a target flying 90° to the radar is notching; one flying at it is not', () => {
    const w = createWorld(ctx, 1);
    const t = spawnPlane(w, ctx, { id: 't', team: 'red', planeId: 'su27s' });
    place(t, [0, ALT, 5000], [1, 0, 0], 0.75);
    expect(notching([0, ALT, 0], t)).toBe(true);
    place(t, [0, ALT, 5000], [0, 0, -1], 0.75);
    expect(notching([0, ALT, 0], t)).toBe(false);
  });
});

describe('missiles: countermeasures', () => {
  it('notching breaks a semi-active lock and the missile misses', () => {
    const straight = engage({ missile: 'aim7f', aspectDeg: 170, rangeM: 5500 });
    expect(straight.hit).toBe(true);
    let lost = 0;
    const notched = engage({
      missile: 'aim7f',
      aspectDeg: 170,
      rangeM: 5500,
      defend: (w, t, s, time) => {
        if (w.missiles[0]?.target === null) lost++;
        return notchDefense(false)(w, t, s, time);
      },
    });
    expect(notched.hit).toBe(false);
    expect(lost).toBeGreaterThan(0); // the missile went ballistic: it lost the track, not just the race
  });

  it.each([
    ['aim9l', 'flare'],
    ['r73', 'flare'],
    ['aim9b', 'flare'],
    ['aim120b', 'chaff'],
    ['r27r', 'chaff'],
  ] as const)('one %s decoy pull rate ≈ 1 − resistance over 1,000 trials (%s)', (missile, kind) => {
    const m = ctx.missileDefs.get(missile)!;
    const w = createWorld(ctx, 99);
    const t = spawnPlane(w, ctx, { id: 't', team: 'red', planeId: 'su27s' });
    const s = spawnPlane(w, ctx, { id: 's', team: 'blue', planeId: 'f15c' });
    place(s, [0, ALT, 0], [0, 0, 1], 0.75);
    place(t, [0, ALT, 2000], [0, 0, 1], 0.75);
    const mc = mcOf(w);
    let decoyed = 0;
    const trials = 1000;
    for (let i = 0; i < trials; i++) {
      w.missiles = [];
      w.decoys = [];
      t.flares = kind === 'flare' ? 1 : 0;
      t.chaff = kind === 'chaff' ? 1 : 0;
      t.cmCooldown = 0;
      launch(w, s, 0, m, t, []);
      stepWeapons(w, mc, t, { ...neutralInput(), flare: true }, DT, []);
      if (w.missiles[0]!.target !== 't') decoyed++;
    }
    expect(decoyed / trials).toBeCloseTo(1 - m[kind === 'flare' ? 'flareResistance' : 'chaffResistance'], 1);
    expect(Math.abs(decoyed / trials - (1 - (kind === 'flare' ? m.flareResistance : m.chaffResistance)))).toBeLessThan(0.05);
  });

  it('flares do nothing to radar missiles and chaff does nothing to IR missiles', () => {
    const w = createWorld(ctx, 5);
    const t = spawnPlane(w, ctx, { id: 't', team: 'red', planeId: 'su27s' });
    const s = spawnPlane(w, ctx, { id: 's', team: 'blue', planeId: 'f15c' });
    place(s, [0, ALT, 0], [0, 0, 1], 0.75);
    place(t, [0, ALT, 2000], [0, 0, 1], 0.75);
    const mc = mcOf(w);
    for (let i = 0; i < 200; i++) {
      w.missiles = [];
      t.flares = 1;
      t.chaff = 0;
      t.cmCooldown = 0;
      launch(w, s, 0, ctx.missileDefs.get('aim120b')!, t, []);
      stepWeapons(w, mc, t, { ...neutralInput(), flare: true }, DT, []);
      expect(w.missiles[0]!.target).toBe('t');
      w.missiles = [];
      t.flares = 0;
      t.chaff = 1;
      t.cmCooldown = 0;
      launch(w, s, 0, ctx.missileDefs.get('aim9x')!, t, []);
      stepWeapons(w, mc, t, { ...neutralInput(), flare: true }, DT, []);
      expect(w.missiles[0]!.target).toBe('t');
    }
  });
});

describe('missiles: every missile has a counter', () => {
  // A skilled defender (flares + a break for IR, a notch + chaff for radar) must survive a good share of
  // shots inside each missile's no-escape-looking envelope. If one of these fails, nerf the missile in data.
  const shots = 40;
  const cases: [string, number, number, string][] = [
    ['aim9b', 0, 1500, 'f8'],
    ['k13', 0, 1500, 'mig21f13'],
    ['r550_magic', 0, 1500, 'mirage3e'],
    ['aim9l', 120, 2500, 'f15c'],
    ['r60', 120, 2200, 'mig29a'],
    ['magic2', 120, 2500, 'mirage2000_5'],
    ['r73', 150, 3000, 'su27s'],
    ['aim9x', 150, 3000, 'f22a'],
    ['mica_ir', 150, 3000, 'rafale_c'],
    ['aim7f', 170, 5000, 'f15a'],
    ['r27r', 170, 5000, 'su27s'],
    ['super530f', 170, 4500, 'mirage_f1c'],
    ['aim120b', 170, 6500, 'f15c'],
    ['r77', 170, 6500, 'mig29a'],
    ['mica_em', 170, 6500, 'rafale_c'],
  ];
  it.each(cases)('%s (aspect %i°, %i m) can be defeated', (missile, aspectDeg, rangeM, shooterPlane) => {
    const radar = ctx.missileClasses.get(ctx.missileDefs.get(missile)!.class)!.seeker === 'radar';
    let hits = 0;
    for (let i = 0; i < shots; i++) {
      const r = engage({ missile, aspectDeg, rangeM, shooterPlane, seed: 1000 + i, defend: radar ? notchDefense(true) : flareDefense() });
      if (r.hit) hits++;
    }
    if (process.env.MISSILE_REPORT) appendFileSync(process.env.MISSILE_REPORT, `${missile}: defended Pk ${(hits / shots).toFixed(2)}\n`);
    expect(hits / shots).toBeLessThanOrEqual(0.6);
  });
});

describe('missiles: bots', () => {
  it('in a headless Modern match bots launch missiles, defend with flares and chaff, and score missile kills', () => {
    const m = createSoloMatch(ctx, { era: 'modern', planeId: 'f16c_b50', difficulty: 'normal', seed: 11 });
    let launches = 0;
    let flares = 0;
    let chaff = 0;
    let missileKills = 0;
    let defends = 0;
    const missileIds = new Set(ctx.missileDefs.keys());
    for (let i = 0; i < 60 * 240; i++) {
      stepMatch(m, ctx, {}, DT);
      for (const e of m.world.events) {
        if (e.t === 'launch') launches++;
        if (e.t === 'decoy') e.kind === 'flare' ? flares++ : chaff++;
        if (e.t === 'kill' && missileIds.has(e.weapon)) missileKills++;
      }
      if (i % 30 === 0) defends += m.brains.filter((b) => b.mode === 'defend').length;
      if (m.world.match.state === 'ended') break;
    }
    if (process.env.MISSILE_REPORT) appendFileSync(process.env.MISSILE_REPORT, `bots 4 min: launches ${launches}, flares ${flares}, chaff ${chaff}, missile kills ${missileKills}, defend samples ${defends}\n`);
    expect(launches).toBeGreaterThan(10);
    expect(flares).toBeGreaterThan(5);
    expect(chaff).toBeGreaterThan(5);
    expect(defends).toBeGreaterThan(0);
    expect(missileKills).toBeGreaterThan(0);
    // Not every missile kills: countermeasures and notches work for bots too.
    expect(missileKills).toBeLessThan(launches * 0.8);
    expect(JSON.parse(JSON.stringify(m.world))).toEqual(m.world);
  });
});
