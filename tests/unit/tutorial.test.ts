import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/data';
import { aimControl, createAimPd } from '../../src/game/autopilot';
import type { ControlInput } from '../../src/game/controls';
import { leadPoint } from '../../src/game/ballistics';
import { FORWARD, normalize, rotate, type Vec3 } from '../../src/game/math';
import { createWorldContext } from '../../src/game/world';
import { balloonsHit, createTutorialSession, ringPass, TUTORIAL_MAP, type Ring } from '../../src/app/tutorial';

const result = loadGameData();
if (!result.ok) throw new Error('data invalid');
const ctx = createWorldContext(result.data, TUTORIAL_MAP);
const DT = 1 / 60;

describe('tutorial', () => {
  it('counts a ring only when the plane crosses its plane inside it', () => {
    const r: Ring = { pos: [0, 1000, 100], normal: [0, 0, 1], passed: false };
    expect(ringPass(r, [0, 1000, 90], [0, 1000, 95])).toBeNull();
    expect(ringPass(r, [10, 1010, 95], [10, 1010, 105])).toBe('through');
    expect(ringPass(r, [200, 1000, 95], [200, 1000, 105])).toBe('missed');
    expect(ringPass(r, [0, 1000, 105], [0, 1000, 95])).toBeNull(); // the wrong way
  });

  it('pops a balloon on a bullet segment through it, only for the player', () => {
    const balloons = [{ pos: [0, 0, 100] as Vec3, popped: false }];
    expect(balloonsHit(balloons, [{ pos: [0, 0, 105], vel: [0, 0, 900], owner: 'b1' }], DT, 'p1')).toBe(0);
    expect(balloonsHit(balloons, [{ pos: [0, 0, 105], vel: [0, 0, 900], owner: 'p1' }], DT, 'p1')).toBe(1);
    expect(balloons[0]!.popped).toBe(true);
  });

  it('an autopilot flies the whole lesson: rings, balloons, missile, flares, done', () => {
    const s = createTutorialSession(ctx);
    const pd = createAimPd();
    const steps: Record<string, number> = {};
    let missilePressed = false;
    for (let i = 0; i < 60 * 240 && !s.ended; i++) {
      const t = s.tutorial;
      const me = s.world.planes.find((p) => p.id === s.playerId)!;
      steps[t.step] = (steps[t.step] ?? 0) + 1;
      if (!me.alive) {
        s.step(DT, null);
        continue;
      }
      let aim: Vec3 = [0, 0, 1];
      let fire = false;
      let missile = false;
      let flare = false;
      if (t.step === 'rings') {
        const r = t.rings[t.ring]!;
        aim = normalize([r.pos[0] + r.normal[0] * 80 - me.pos[0], r.pos[1] - me.pos[1], r.pos[2] + r.normal[2] * 80 - me.pos[2]]);
      } else if (t.step === 'balloons') {
        const b = t.balloons.find((x) => !x.popped)!;
        const lp = leadPoint(me.pos, me.vel, b.pos, [0, 0, 0], 860);
        const want = normalize([lp[0] - me.pos[0], lp[1] - me.pos[1], lp[2] - me.pos[2]]);
        // The autopilot holds the nose a degree or so off the aim; a player corrects by eye, this aims past it.
        const nose = rotate(me.quat, FORWARD);
        aim = normalize([want[0] * 2 - nose[0], want[1] * 2 - nose[1], want[2] * 2 - nose[2]]);
        const off = Math.acos(Math.min(1, nose[0] * want[0] + nose[1] * want[1] + nose[2] * want[2]));
        fire = off < 0.02 && Math.hypot(b.pos[0] - me.pos[0], b.pos[1] - me.pos[1], b.pos[2] - me.pos[2]) < 1000;
      } else if (t.step === 'missile') {
        const d = s.world.planes.find((p) => p.id === 'z1');
        if (d) aim = normalize([d.pos[0] - me.pos[0], d.pos[1] - me.pos[1], d.pos[2] - me.pos[2]]);
        missile = me.lockProgress >= 1 && !missilePressed;
      } else if (t.step === 'flares') {
        aim = normalize([1, 0, 1]);
        flare = s.world.missiles.some((m) => m.target === s.playerId);
      }
      missilePressed = missile;
      const steer = aimControl(me, aim, pd, DT);
      const input: ControlInput = { ...steer, throttle: t.step === 'flares' ? 0.4 : 0.6, fire, missile, flare, target: null };
      s.step(DT, input);
    }
    console.log('tutorial seconds per step', Object.fromEntries(Object.entries(steps).map(([k, v]) => [k, Math.round(v / 60)])));
    expect(s.ended).toBe('finished');
    expect(s.tutorial.ringsHit).toBeGreaterThanOrEqual(3);
    // About a minute, give or take: no step drags on.
    const total = Object.values(steps).reduce((a, b) => a + b, 0) / 60;
    expect(total).toBeLessThan(120);
  });

  it('Next walks through every step to the end', () => {
    const s = createTutorialSession(ctx);
    const seen: string[] = [];
    for (let i = 0; i < 6 && !s.ended; i++) {
      seen.push(s.tutorial.step);
      s.advance();
      s.step(DT, null);
    }
    expect(seen).toEqual(['rings', 'balloons', 'missile', 'flares', 'done']);
    expect(s.ended).toBe('finished');
    expect(JSON.parse(JSON.stringify(s.world))).toBeTruthy();
  });
});
