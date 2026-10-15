import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/data';
import type { EraId, GameData } from '../../src/data/types';
import { neutralInput } from '../../src/game/controls';
import { groundLayout } from '../../src/game/groundLayout';
import { createMatch, stepMatch } from '../../src/game/match';
import { isBomber, moveOrdnance, type ModeId } from '../../src/game/objectives';
import { addPilot, applyDamage, createWorld, createWorldContext, spawnPlane, stepWorld, type GameEvent, type WorldContext } from '../../src/game/world';

const DT = 1 / 60;
const result = loadGameData();
if (!result.ok) throw new Error('data invalid');
const data: GameData = result.data;
const MAPS = ['island_chain', 'mountain_valley', 'desert_mesas', 'carrier_strike'];
const contexts = new Map<string, WorldContext>(MAPS.map((m) => [m, createWorldContext(data, m)]));
const ctxOf = (m: string): WorldContext => contexts.get(m)!;

/** Bots only, `seconds` of play; returns the match and a count of every event type. */
function play(mode: ModeId, map: string, era: EraId, seconds: number) {
  const ctx = ctxOf(map);
  const m = createMatch(ctx, { era, difficulty: 'normal', humans: [], mode, seed: 7 });
  const counts: Record<string, number> = {};
  for (let i = 0; i < seconds * 60 && m.world.match.state !== 'ended'; i++) {
    stepMatch(m, ctx, {}, DT);
    for (const e of m.world.events as GameEvent[]) counts[e.t] = (counts[e.t] ?? 0) + 1;
  }
  return { m, counts, ctx };
}

describe('every mode plays with bots on every map', () => {
  it.each(MAPS)('Air Domination on %s: zones change hands and drain tickets', (map) => {
    const { m, counts } = play('air_domination', map, 'early_ww2', 240);
    expect(m.world.objectives.zones).toHaveLength(3);
    expect(counts['capture'] ?? 0).toBeGreaterThan(0);
    expect(Math.min(m.world.match.score.red, m.world.match.score.blue)).toBeLessThan(300);
    expect(JSON.parse(JSON.stringify(m.world))).toEqual(m.world);
  });

  it.each(MAPS)('Ground Strike on %s: both sides have targets and bots destroy some', (map) => {
    const { m, counts } = play('ground_strike', map, 'late_ww2', 240);
    const units = m.world.objectives.units;
    for (const team of ['red', 'blue'] as const) expect(units.filter((u) => u.team === team && u.target).length, team).toBeGreaterThanOrEqual(4);
    expect(counts['unit'] ?? 0).toBeGreaterThan(0);
    expect(counts['drop'] ?? 0).toBeGreaterThan(0);
    expect(Math.min(m.world.match.score.red, m.world.match.score.blue)).toBeLessThan(300);
    if (map === 'carrier_strike') for (const team of ['red', 'blue'] as const) expect(units.some((u) => u.team === team && u.kind === 'carrier')).toBe(true);
    expect(JSON.parse(JSON.stringify(m.world))).toEqual(m.world);
  });

  it.each(MAPS)('Bomber Escort on %s: a wave flies and is bombed through or shot down', (map) => {
    const { m, counts } = play('bomber_escort', map, map === 'mountain_valley' ? 'ww1' : map === 'desert_mesas' ? 'cold_war' : 'late_ww2', 240);
    const es = m.world.objectives.escort!;
    expect(es.wave).toBeGreaterThanOrEqual(1);
    expect(es.delivered + es.downed).toBeGreaterThan(0);
    expect(counts['wave']).toBeGreaterThanOrEqual(1);
    expect(m.world.match.score.red + m.world.match.score.blue).toBeGreaterThan(0);
    // Bombers aren't players: no seat, no respawn on their own.
    const bombers = m.world.planes.filter((p) => isBomber(m.world, p.id));
    expect(bombers).toHaveLength(4);
    expect(m.world.planes.filter((p) => !isBomber(m.world, p.id))).toHaveLength(20);
    expect(JSON.parse(JSON.stringify(m.world))).toEqual(m.world);
  });
});

describe('mode rules', () => {
  const solo = (mode: ModeId, map = 'island_chain', era: EraId = 'late_ww2') => {
    const ctx = ctxOf(map);
    const m = createMatch(ctx, { era, difficulty: 'normal', humans: [{ id: 'p1', name: 'You', planeId: era === 'late_ww2' ? 'p47d' : 'sopwith_camel', team: 'blue' }], bots: false, mode, seed: 3 });
    return { m, ctx, me: m.world.planes[0]! };
  };

  it('a plane below 300 m inside a zone captures it in captureS; one above it does not', () => {
    const { m, ctx, me } = solo('air_domination');
    const z = m.world.objectives.zones[1]!;
    const ground = ctx.terrain.surfaceAt(z.x, z.z);
    const hold = (alt: number, s: number) => {
      for (let i = 0; i < s * 60; i++) {
        me.pos = [z.x, ground + alt, z.z];
        me.vel = [0, 0, 1e-3];
        me.alive = true;
        stepMatch(m, ctx, { p1: neutralInput(0.5) }, DT);
      }
    };
    hold(600, 15);
    expect(z.owner).toBeNull();
    hold(150, 10.2);
    expect(z.owner).toBe('blue');
    expect(m.world.stats['p1']!.captures).toBe(1);
    // A held zone drains the other team's tickets.
    const before = m.world.match.score.red;
    hold(600, 10);
    expect(m.world.match.score.red).toBeLessThan(before - 4);
  });

  it('bullets destroy a ground target, credit the shooter and cost its team tickets', () => {
    const { m, ctx } = solo('ground_strike');
    const w = m.world;
    const u = w.objectives.units.find((x) => x.team === 'red' && x.kind === 'aa')!;
    const before = w.match.score.red;
    for (let i = 0; i < 200 && u.alive; i++) {
      w.bullets.push({ id: 9000 + i, owner: 'p1', team: 'blue', gun: 'mg_50', pos: [u.pos[0], u.pos[1] + 60, u.pos[2] + 1], vel: [0, -800, 0], damage: 20, life: 1 });
      stepWorld(w, ctx, {}, DT);
    }
    expect(u.alive).toBe(false);
    expect(w.stats['p1']!.groundKills).toBe(1);
    expect(w.match.score.red).toBe(before - data.objectives.units.find((x) => x.id === 'aa')!.tickets);
  });

  it('a rocket explodes on a bunker with splash damage', () => {
    const { m, ctx } = solo('ground_strike');
    const w = m.world;
    const b = w.objectives.units.find((x) => x.team === 'red' && x.kind === 'bunker')!;
    const hp = b.hp;
    w.objectives.ordnance.push({ id: 1, kind: 'rocket', owner: 'p1', team: 'blue', pos: [b.pos[0], b.pos[1] + 80, b.pos[2]], vel: [0, -300, 0], age: 0 });
    const events: GameEvent[] = [];
    for (let i = 0; i < 60 && w.objectives.ordnance.length; i++) moveOrdnance(w, ctx, DT, events);
    expect(b.hp).toBeLessThan(hp);
    expect(events.some((e) => e.t === 'explode')).toBe(true);
  });

  it('attackers release rockets in pairs, then bombs, with the missile button', () => {
    const { m, ctx, me } = solo('ground_strike');
    me.pos = [0, 3000, 0];
    me.protectedFor = 0;
    const press = { ...neutralInput(1), missile: true };
    const drops: string[] = [];
    for (let i = 0; i < 60 * 6; i++) {
      stepMatch(m, ctx, { p1: press }, DT);
      for (const e of m.world.events) if (e.t === 'drop') drops.push(e.kind);
    }
    expect(drops.filter((k) => k === 'rocket')).toHaveLength(8);
    expect(drops.filter((k) => k === 'bomb')).toHaveLength(2);
    expect(drops.indexOf('bomb')).toBeGreaterThan(drops.lastIndexOf('rocket'));
    expect(me.rockets + me.bombs).toBe(0);
  });

  it('a team out of tickets loses', () => {
    const { m, ctx } = solo('air_domination');
    m.world.match.score.red = 1;
    m.world.objectives.zones.forEach((z) => {
      z.owner = 'blue';
      z.progress = 1;
    });
    for (let i = 0; i < 60 * 2; i++) stepMatch(m, ctx, {}, DT);
    expect(m.world.match.state).toBe('ended');
    expect(m.world.match.winner).toBe('blue');
  });

  it('a missile takes a bounded bite out of a bomber, and a downed bomber scores for the interceptors', () => {
    const ctx = ctxOf('island_chain');
    const m = createMatch(ctx, { era: 'modern', difficulty: 'normal', humans: [], bots: false, mode: 'bomber_escort', seed: 5 });
    const w = m.world;
    const es = w.objectives.escort!;
    es.nextIn = 0;
    stepMatch(m, ctx, {}, DT);
    const b = w.planes.find((p) => isBomber(w, p.id) && p.alive)!;
    expect(b).toBeDefined();
    const defending = es.escort === 'red' ? 'blue' : 'red';
    addPilot(w, { id: 'x', name: 'X', team: defending, bot: false });
    spawnPlane(w, ctx, { id: 'x', team: defending, planeId: 'f15c' });
    const hp = b.hp;
    // Same arithmetic as stepWorld's missile hit: damage% × missileHp, not × the bomber's HP.
    const missileHp = data.objectives.bombers.find((x) => x.id === b.planeId)!.missileHp;
    applyDamage(w, b, 'x', 0.9 * Math.min(b.maxHp, missileHp), null, 'aim120b');
    expect(hp - b.hp).toBeCloseTo(0.9 * missileHp, 3);
    const before = w.match.score[defending];
    applyDamage(w, b, 'x', 1e6, null, 'gun');
    expect(b.alive).toBe(false);
    expect(w.match.score[defending]).toBe(before + 10);
    expect(b.respawnIn).toBeGreaterThan(1e6);
  });

  it('the ground layout is the same every time for a map, and keeps units on their own half', () => {
    for (const map of MAPS) {
      const ctx = ctxOf(map);
      const a = JSON.stringify(groundLayout(ctx.map, ctx.terrain));
      const fresh = createWorldContext(data, map);
      expect(JSON.stringify(groundLayout(fresh.map, fresh.terrain))).toBe(a);
      for (const s of groundLayout(ctx.map, ctx.terrain).slots) expect(Math.sign(s.x), `${map} ${s.kind}`).toBe(s.team === 'red' ? -1 : 1);
    }
  });

  it('a plane in a zone at spawn altitude over Mountain Valley flies through the canyon below the rims', () => {
    const ctx = ctxOf('mountain_valley');
    // The canyon floor at each zone is far below the ridges either side.
    for (const [x, z] of ctx.map.zones) {
      const floor = ctx.terrain.heightAt(x, z);
      const rim = Math.max(ctx.terrain.heightAt(x, z + 1200), ctx.terrain.heightAt(x, z - 1200));
      expect(floor).toBeLessThan(120);
      expect(rim - floor).toBeGreaterThan(250);
    }
  });

  it('Desert Mesas has flat-topped plateaus well above the desert floor', () => {
    const ctx = ctxOf('desert_mesas');
    let tops = 0;
    for (let x = -7000; x <= 7000; x += 250) {
      for (let z = -7000; z <= 7000; z += 250) {
        const h = ctx.terrain.heightAt(x, z);
        const flat = [[30, 0], [-30, 0], [0, 30], [0, -30]].every(([dx, dz]) => Math.abs(ctx.terrain.heightAt(x + dx!, z + dz!) - h) < 8);
        if (h > 250 && flat) tops++;
      }
    }
    expect(tops).toBeGreaterThan(50);
  });
});

