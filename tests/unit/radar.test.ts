// Day 11 radar: Search lock, Dogfight auto-lock, notching drops the lock, semi-active missiles need it held,
// and the new input fields survive the wire.
import { describe, expect, it } from 'vitest';
import { neutralInput, type ControlInput } from '../../src/game/controls';
import { launch, type MissileEvent } from '../../src/game/missiles';
import { RADAR_MEMORY_S, stepRadar } from '../../src/game/radar';
import { addPilot, createWorld, spawnPlane, stepWorld } from '../../src/game/world';
import { decodeInput, encodeInput } from '../../src/net/protocol';
import { ALT, ctx, data, DT, place } from './missileHarness';

function duel(shooterPlane = 'f15c', targetPlane = 'su27s') {
  const w = createWorld(ctx, 3);
  addPilot(w, { id: 's', name: 'S', team: 'blue', bot: false });
  addPilot(w, { id: 't', name: 'T', team: 'red', bot: false });
  const s = spawnPlane(w, ctx, { id: 's', team: 'blue', planeId: shooterPlane });
  const t = spawnPlane(w, ctx, { id: 't', team: 'red', planeId: targetPlane });
  place(s, [0, ALT, 0], [0, 0, 1], 0.75);
  place(t, [0, ALT, 6000], [0, 0, -1], 0.75); // head-on: plenty of closing speed, no notch
  return { w, s, t };
}

const lockInput = (over: Partial<ControlInput> = {}): ControlInput => ({ ...neutralInput(0.8), radarOn: true, radarLock: true, ...over });

describe('radar', () => {
  it('every jet with radar-guided missiles has a radar, and only jets have one', () => {
    for (const p of data.planes) {
      const radarMissile = p.missiles.some((m) => ctx.missileClasses.get(ctx.missileDefs.get(m.type)!.class)!.seeker === 'radar');
      if (radarMissile) expect(p.radar, p.id).toBeDefined();
      if (p.radar) expect(['early_jets', 'cold_war', 'modern']).toContain(p.era);
    }
  });

  it('Search: a lock request locks the picked target, and releasing it drops the lock', () => {
    const { w, s, t } = duel();
    const def = ctx.planeDefs.get(s.planeId);
    stepRadar(s, def, lockInput({ target: 't' }), w.planes, ctx.planeDefs, DT);
    expect(s.radarLock).toBe(t.id);
    stepRadar(s, def, lockInput({ radarLock: false }), w.planes, ctx.planeDefs, DT);
    expect(s.radarLock).toBeNull();
    // Radar off: no lock even when asked.
    stepRadar(s, def, lockInput({ radarOn: false, target: 't' }), w.planes, ctx.planeDefs, DT);
    expect(s.radarLock).toBeNull();
  });

  it('Dogfight auto-locks only an enemy in the narrow cone ahead', () => {
    const { w, s, t } = duel();
    const def = ctx.planeDefs.get(s.planeId);
    t.pos = [3000, ALT, 5000]; // ~31° off the nose: inside the search cone, outside dogfight's
    stepRadar(s, def, lockInput({ radarDogfight: true }), w.planes, ctx.planeDefs, DT);
    expect(s.radarLock).toBeNull();
    t.pos = [300, ALT, 5000];
    stepRadar(s, def, lockInput({ radarDogfight: true }), w.planes, ctx.planeDefs, DT);
    expect(s.radarLock).toBe(t.id);
    expect(s.radarMode).toBe('dogfight');
  });

  it('a notching target breaks the lock after the radar memory runs out', () => {
    const { w, s, t } = duel();
    const def = ctx.planeDefs.get(s.planeId);
    stepRadar(s, def, lockInput({ target: 't' }), w.planes, ctx.planeDefs, DT);
    expect(s.radarLock).toBe('t');
    // Fly across the line of sight: radial speed ~0.
    place(t, [0, ALT, 6000], [1, 0, 0], 0.75);
    let held = 0;
    for (let i = 0; i < 120 && s.radarLock; i++, held += DT) stepRadar(s, def, lockInput(), w.planes, ctx.planeDefs, DT);
    expect(s.radarLock).toBeNull();
    expect(held).toBeGreaterThan(RADAR_MEMORY_S - DT);
  });

  it('radar missiles only lock with the radar locked; a semi-active missile goes ballistic when the lock is dropped', () => {
    const { w, s, t } = duel('f15a', 'su27s');
    s.hp = t.hp = t.maxHp = 1e6;
    const sparrow = ctx.planeDefs.get('f15a')!.missiles.findIndex((m) => m.type.startsWith('aim7'));
    expect(sparrow).toBeGreaterThanOrEqual(0);
    // Missile lock without radar lock: the Sparrow mount never locks.
    for (let i = 0; i < 120; i++) stepWorld(w, ctx, { s: { ...neutralInput(0.8), target: 't', radarOn: true, radarLock: false, secondary: sparrow }, t: neutralInput(0.8) }, DT);
    expect(s.lockMount === sparrow && s.lockProgress > 0).toBe(false);
    // With the radar lock it does.
    for (let i = 0; i < 120; i++) stepWorld(w, ctx, { s: { ...lockInput({ target: 't' }), secondary: sparrow }, t: neutralInput(0.8) }, DT);
    expect(s.radarLock).toBe('t');
    expect(s.lockMount).toBe(sparrow);
    expect(s.lockProgress).toBeGreaterThan(0.99);
    // Fire, then let go of the lock: the missile loses its guidance.
    const events: MissileEvent[] = [];
    launch(w, s, sparrow, ctx.missileDefs.get(ctx.planeDefs.get('f15a')!.missiles[sparrow]!.type)!, t, events);
    let lost = false;
    for (let i = 0; i < 60 * 6 && w.missiles.length; i++) {
      stepWorld(w, ctx, { s: lockInput({ radarLock: false }), t: neutralInput(0.8) }, DT);
      if (w.missiles.some((m) => m.target === null)) lost = true;
    }
    expect(lost).toBe(true);
  });

  it('WEP, airbrake, flaps, radar and the secondary pick survive the wire', () => {
    const i: ControlInput = { ...neutralInput(1), wep: true, airbrake: true, flaps: false, radarOn: true, radarDogfight: true, radarRange: 2, radarLock: true, secondary: 1, fire: true };
    const back = decodeInput(encodeInput(9, i, 3))!;
    expect(back.input).toMatchObject({ wep: true, airbrake: true, flaps: false, radarOn: true, radarDogfight: true, radarRange: 2, radarLock: true, secondary: 1, fire: true });
    expect(back.targetSlot).toBe(3);
    expect(decodeInput(encodeInput(1, neutralInput(0.5)))!.input.secondary).toBe(-1);
  });
});
