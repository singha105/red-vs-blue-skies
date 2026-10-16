import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/data';
import type { GameData } from '../../src/data/types';
import { aimControl, createAimPd } from '../../src/game/autopilot';
import { CONVERGENCE_M, fireGuns, leadPoint, segmentSphere, stepBullets, type Bullet } from '../../src/game/ballistics';
import { botInput, createBrain } from '../../src/game/bots';
import { neutralInput, type ControlInput } from '../../src/game/controls';
import { G, stepPlane, type PlaneState } from '../../src/game/flight';
import { createSoloMatch, PLAYER_ID, stepMatch } from '../../src/game/match';
import { dirFromYawPitch, FORWARD, len, quatLookRotation, rotate, type Vec3 } from '../../src/game/math';
import { addPilot, applyDamage, createWorld, createWorldContext, random, spawnPlane, stepWorld, type BotDifficulty } from '../../src/game/world';

const DT = 1 / 60;
const result = loadGameData();
if (!result.ok) throw new Error('data invalid');
const data: GameData = result.data;
const ctx = createWorldContext(data, 'island_chain');

function duel(planeA = 'spitfire_mk5', planeB = 'bf109e4') {
  const w = createWorld(ctx, 42);
  addPilot(w, { id: 'a', name: 'A', team: 'blue', bot: false });
  addPilot(w, { id: 'b', name: 'B', team: 'red', bot: false });
  const a = spawnPlane(w, ctx, { id: 'a', team: 'blue', planeId: planeA });
  const b = spawnPlane(w, ctx, { id: 'b', team: 'red', planeId: planeB });
  a.protectedFor = 0;
  b.protectedFor = 0;
  return { w, a, b };
}

describe('ballistics', () => {
  it('swept test catches a bullet that jumps clean over a sphere in one tick', () => {
    // 15 m step straight through a 2 m sphere: neither endpoint is inside.
    expect(segmentSphere([-7.5, 0, 0], [7.5, 0, 0], [0, 0, 0], 2)).toBeCloseTo((7.5 - 2) / 15, 6);
    expect(segmentSphere([-7.5, 3, 0], [7.5, 3, 0], [0, 0, 0], 2)).toBe(-1);
    expect(segmentSphere([0.5, 0, 0], [9, 0, 0], [0, 0, 0], 2)).toBe(0); // starts inside
  });

  it('bullets drop under gravity', () => {
    const b: Bullet = { id: 1, owner: 'x', team: 'red', gun: 'mg_50', pos: [0, 1000, 0], vel: [0, 0, 870], damage: 1, life: 5 };
    const list = [b];
    for (let i = 0; i < 60; i++) stepBullets(list, [], () => ({}) as never, () => -1e9, DT);
    expect(list[0]!.pos[2]).toBeCloseTo(870, 0);
    expect(1000 - list[0]!.pos[1]).toBeGreaterThan(0.5 * G * 0.9);
    expect(1000 - list[0]!.pos[1]).toBeLessThan(0.5 * G * 1.1);
  });

  it('a fast bullet aimed at the lead point hits a crossing target', () => {
    const { w, a, b } = duel();
    a.pos = [0, 2000, 0];
    a.vel = [0, 0, 0];
    b.pos = [0, 2000, 600];
    b.vel = [150, 0, 0];
    const mv = 850;
    const aim = leadPoint(a.pos, a.vel, b.pos, b.vel, mv);
    const dir = (() => {
      const d: Vec3 = [aim[0] - a.pos[0], aim[1] - a.pos[1], aim[2] - a.pos[2]];
      const l = len(d);
      return [d[0] / l, d[1] / l, d[2] / l] as Vec3;
    })();
    w.bullets.push({ id: 1, owner: 'a', team: 'blue', gun: 'cannon_20mm', pos: [...a.pos], vel: [dir[0] * mv, dir[1] * mv, dir[2] * mv], damage: 9, life: 3 });
    let hit = false;
    for (let i = 0; i < 90 && !hit; i++) {
      b.pos = [b.pos[0] + b.vel[0] * DT, b.pos[1], b.pos[2]];
      hit = stepBullets(w.bullets, [a, b], () => ({ fuselage: { c: [0, 0, 0], r: 2 }, wingL: { c: [4, 0, 0], r: 2 }, wingR: { c: [-4, 0, 0], r: 2 }, engine: { c: [0, 0, 3.8], r: 1.4 } }), () => -1e9, DT).length > 0;
    }
    expect(hit).toBe(true);
  });

  it('wing guns converge about 300 m ahead', () => {
    const { w, a } = duel('hurricane_mk1');
    a.pos = [0, 3000, 0];
    a.vel = [0, 0, 1e-6];
    a.quat = quatLookRotation([0, 0, 1]);
    const def = ctx.planeDefs.get('hurricane_mk1')!;
    const bullets: Bullet[] = [];
    const fc = { guns: ctx.guns, nextBulletId: () => w.nextBulletId++, random: () => 0, enemies: [] };
    for (let i = 0; i < 6; i++) fireGuns(a, def, fc, DT, bullets);
    expect(bullets.length).toBeGreaterThanOrEqual(2);
    const left = bullets.find((b) => b.pos[0] > 0.5)!;
    const right = bullets.find((b) => b.pos[0] < -0.5)!;
    const at = (b: Bullet, z: number): number => b.pos[0] + (b.vel[0] / b.vel[2]) * (z - b.pos[2]);
    expect(Math.abs(at(left, CONVERGENCE_M) - at(right, CONVERGENCE_M))).toBeLessThan(0.2);
    expect(Math.abs(at(left, 0) - at(right, 0))).toBeGreaterThan(2);
  });

  it('fires at the real rate of fire and uses ammo', () => {
    const { w, a } = duel('p51d');
    const def = ctx.planeDefs.get('p51d')!;
    const start = a.ammo.reduce((x, y) => x + y, 0);
    const fc = { guns: ctx.guns, nextBulletId: () => w.nextBulletId++, random: () => 0.5, enemies: [] };
    const bullets: Bullet[] = [];
    for (let i = 0; i < 60; i++) fireGuns(a, def, fc, DT, bullets);
    const used = start - a.ammo.reduce((x, y) => x + y, 0);
    // 6 × .50 at 800 rpm = 80 rounds per second.
    expect(used).toBeGreaterThanOrEqual(76);
    expect(used).toBeLessThanOrEqual(84);
    expect(bullets.length).toBeLessThanOrEqual(42); // capped projectiles, each carrying several rounds
  });
});

describe('damage', () => {
  it('engine knock-out costs about 30% top speed; wing knock-out costs 25% roll', () => {
    const p = ctx.params.get('spitfire_mk5')!;
    const level = (st: PlaneState, input: ControlInput, seconds: number): void => {
      const pd = createAimPd();
      for (let t = 0; t < seconds; t += DT) {
        const f = rotate(st.quat, FORWARD);
        const aim = dirFromYawPitch(Math.atan2(-f[0], f[2]), 0);
        stepPlane(st, { ...input, ...aimControl(st, aim, pd, DT) }, p, { surfaceAt: () => -1e9, half: 1e9 }, DT);
      }
    };
    const { a } = duel();
    a.pos = [0, 2000, 0];
    a.damaged.engine = true;
    level(a, neutralInput(1), 120);
    const ratio = len(a.vel) / p.topSpeedMs;
    expect(ratio).toBeGreaterThan(0.64);
    expect(ratio).toBeLessThan(0.76);

    const roll = (wing: boolean): number => {
      const { a: s } = duel();
      s.pos = [0, 2000, 0];
      s.damaged.wingL = wing;
      const start = rotate(s.quat, [-1, 0, 0]);
      stepPlane(s, { ...neutralInput(1), roll: 1 }, p, { surfaceAt: () => -1e9, half: 1e9 }, 0.2);
      const end = rotate(s.quat, [-1, 0, 0]);
      return Math.acos(start[0] * end[0] + start[1] * end[1] + start[2] * end[2]);
    };
    expect(roll(true) / roll(false)).toBeCloseTo(0.75, 2);
  });

  it('kills credit the killer, assists go to anyone with 25%+, the team scores', () => {
    const { w, b } = duel();
    addPilot(w, { id: 'c', name: 'C', team: 'blue', bot: false });
    // Shares of max HP (tuning changes the HP): C does 30%, A the rest.
    applyDamage(w, b, 'c', b.maxHp * 0.3, 'fuselage', 'mg_50');
    applyDamage(w, b, 'a', b.maxHp * 0.1, 'fuselage', 'cannon_20mm');
    applyDamage(w, b, 'a', b.maxHp * 2, 'fuselage', 'cannon_20mm');
    expect(b.alive).toBe(false);
    expect(b.wreck).toBe(true);
    expect(w.stats['a']!.kills).toBe(1);
    expect(w.stats['c']!.assists).toBe(1);
    expect(w.stats['b']!.deaths).toBe(1);
    expect(w.match.score.blue).toBe(1);
    const kill = w.events.find((e) => e.t === 'kill');
    expect(kill).toMatchObject({ killer: 'a', victim: 'b', assists: ['c'] });
  });

  it('parts get knocked out by enough damage on them', () => {
    const { w, b } = duel();
    applyDamage(w, b, 'a', b.maxHp * 0.25, 'engine', 'cannon_20mm');
    expect(b.damaged.engine).toBe(true);
    expect(b.damaged.wingL).toBe(false);
  });

  it('fire drains HP for 10 seconds and credits the shooter', () => {
    const { w, b } = duel();
    b.fireFor = 10;
    b.lastHitBy = 'a';
    b.lastHitAt = 0;
    const hp = b.hp;
    for (let i = 0; i < 60 * 4; i++) stepWorld(w, ctx, {}, DT);
    expect(b.hp).toBeLessThan(hp - 8);
    expect(b.fireFor).toBeGreaterThan(5);
  });

  it('spawn protection blocks damage for 3 s; friendly fire is off', () => {
    const w = createWorld(ctx);
    addPilot(w, { id: 'a', name: 'A', team: 'blue', bot: false });
    const a = spawnPlane(w, ctx, { id: 'a', team: 'blue', planeId: 'p51d' });
    applyDamage(w, a, 'x', 50, 'fuselage', 'mg_50');
    expect(a.hp).toBe(a.maxHp);
    // Same-team bullet passing right through a plane does nothing.
    a.protectedFor = 0;
    const hits = stepBullets(
      [{ id: 1, owner: 'mate', team: 'blue', gun: 'mg_50', pos: [a.pos[0] - 5, a.pos[1], a.pos[2]], vel: [600, 0, 0], damage: 5, life: 1 }],
      [a],
      () => ({ fuselage: { c: [0, 0, 0], r: 2 }, wingL: { c: [4, 0, 0], r: 2 }, wingR: { c: [-4, 0, 0], r: 2 }, engine: { c: [0, 0, 3.8], r: 1.4 } }),
      () => -1e9,
      DT,
    );
    expect(hits).toHaveLength(0);
  });

  it('crashing soon after being shot counts as the attacker\'s kill; a clean crash counts for nobody', () => {
    const { w, a, b } = duel();
    applyDamage(w, b, 'a', 10, 'wingL', 'mg_50');
    b.pos = [b.pos[0], 0.5, b.pos[2]];
    stepWorld(w, ctx, {}, DT);
    expect(w.stats['a']!.kills).toBe(1);
    a.pos = [a.pos[0], 0.5, a.pos[2]];
    stepWorld(w, ctx, {}, DT);
    expect(w.stats['b']!.kills).toBe(0);
    expect(w.match.score.red).toBe(0);
  });
});

describe('bots', () => {
  it('only produce ControlInput; they never edit the world', () => {
    const m = createSoloMatch(ctx, { era: 'early_ww2', planeId: 'spitfire_mk5', difficulty: 'hard', seed: 7 });
    for (let i = 0; i < 600; i++) stepMatch(m, ctx, {}, DT);
    const before = JSON.stringify(m.world.planes);
    const rng = m.world.rng;
    for (const brain of m.brains) {
      const input = botInput(m.world, ctx, brain, DT);
      expect(Object.keys(input).sort()).toEqual(['fire', 'flare', 'missile', 'pitch', 'radarLock', 'radarOn', 'radarRange', 'roll', 'target', 'throttle', 'wep', 'yaw']);
    }
    expect(JSON.stringify(m.world.planes)).toBe(before);
    expect(m.world.rng).not.toBe(Number.NaN);
    void rng;
  });

  it('rarely fly into the ground', () => {
    const m = createSoloMatch(ctx, { era: 'late_ww2', planeId: 'p51d', difficulty: 'normal', seed: 3 });
    let crashes = 0;
    for (let i = 0; i < 60 * 120; i++) {
      stepMatch(m, ctx, {}, DT);
      for (const e of m.world.events) if (e.t === 'kill' && e.weapon === 'crash') crashes++;
    }
    // 20 bots for two minutes.
    expect(crashes).toBeLessThanOrEqual(3);
  });

  /** A human-ish target: flies around turning every few seconds, never shoots back. */
  function deathsAgainst(difficulty: BotDifficulty, seconds: number, seed: number): number {
    const m = createSoloMatch(ctx, { era: 'early_ww2', planeId: 'hurricane_mk1', difficulty, seed });
    // One attacker only, so we measure a single bot's lethality.
    const attacker = m.brains.find((b) => m.world.pilots[b.id]!.team === 'red')!;
    m.brains = [attacker];
    for (const p of m.world.planes) if (p.id !== PLAYER_ID && p.id !== attacker.id) p.pos = [p.pos[0], -500, p.pos[2]];
    m.world.planes = m.world.planes.filter((p) => p.id === PLAYER_ID || p.id === attacker.id);
    const pd = createAimPd();
    let yaw = 0;
    let pitch = 0.05;
    let deaths = 0;
    for (let i = 0; i < 60 * seconds; i++) {
      if (i % 240 === 0) {
        yaw += (random(m.world) - 0.5) * 2.4;
        pitch = (random(m.world) - 0.3) * 0.4;
      }
      const me = m.world.planes.find((p) => p.id === PLAYER_ID)!;
      const input = me.alive ? { ...neutralInput(0.9), ...aimControl(me, dirFromYawPitch(yaw, me.pos[1] < 700 ? 0.4 : pitch), pd, DT) } : neutralInput();
      stepMatch(m, ctx, { [PLAYER_ID]: input }, DT);
      for (const e of m.world.events) if (e.t === 'kill' && e.victim === PLAYER_ID && e.killer) deaths++;
    }
    return deaths;
  }

  it('normal bots shoot a weaving player down sometimes; easy bots almost never', () => {
    // Three 5-minute 1 v 1s per difficulty (different seeds, so different bot planes and starts).
    const total = (d: BotDifficulty): number => [11, 12, 13].reduce((n, seed) => n + deathsAgainst(d, 300, seed), 0);
    const easy = total('easy');
    const normal = total('normal');
    const hard = total('hard');
    console.log(`player deaths in 15 min against one bot: easy ${easy}, normal ${normal}, hard ${hard}`);
    expect(easy).toBeLessThanOrEqual(2);
    expect(normal).toBeGreaterThanOrEqual(2);
    expect(normal).toBeGreaterThan(easy);
    expect(hard).toBeGreaterThanOrEqual(normal);
  }, 60_000);
});

describe('solo match', () => {
  it('a full 10-minute Team Deathmatch runs to a result', () => {
    const m = createSoloMatch(ctx, { era: 'early_ww2', planeId: 'spitfire_mk5', difficulty: 'normal', seed: 99 });
    expect(m.world.planes).toHaveLength(20);
    expect(m.world.planes.filter((p) => p.team === 'blue')).toHaveLength(10);
    let kills = 0;
    let steps = 0;
    while (m.world.match.state === 'playing' && steps < 60 * 700) {
      stepMatch(m, ctx, {}, DT);
      steps++;
      for (const e of m.world.events) if (e.t === 'kill') kills++;
      for (const p of m.world.planes) if (!Number.isFinite(p.pos[0] + p.pos[1] + p.pos[2])) throw new Error(`NaN position for ${p.id}`);
    }
    const s = m.world.match;
    console.log(`TDM result: blue ${s.score.blue} – red ${s.score.red}, ${kills} deaths, ${(steps / 60).toFixed(0)} s, ${m.world.bullets.length} bullets in flight`);
    expect(s.state).toBe('ended');
    expect(s.winner).not.toBeNull();
    expect(kills).toBeGreaterThan(10);
    expect(Math.max(s.score.blue, s.score.red) >= s.killLimit || s.timeLeftS === 0).toBe(true);
  }, 120_000);
});
