import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/data';
import { fireGuns, hitSpheres, type Bullet } from '../../src/game/ballistics';
import { quatLookRotation } from '../../src/game/math';
import { PLANE_MODELS, planeSize, pylonSlots } from '../../src/game/planeModels';
import { createWorld, createWorldContext, spawnPlane } from '../../src/game/world';

const result = loadGameData();
if (!result.ok) throw new Error('data invalid');
const data = result.data;
const ctx = createWorldContext(data, 'island_chain');
const ALL = data.planes.map((p) => p.id);
const BOMBERS = ['bomber_ww1', 'bomber_ww2', 'bomber_jet'];

describe('plane models', () => {
  it('all 60 planes have built models that exist in public/', () => {
    expect(ALL).toHaveLength(60);
    for (const id of ALL) {
      const m = PLANE_MODELS[id];
      expect(m, id).toBeDefined();
      expect(existsSync(new URL(`../../public/${m!.file}`, import.meta.url)), id).toBe(true);
      const plane = data.planes.find((p) => p.id === id)!;
      expect(m!.file).toBe(plane.model);
      const budget = ['ww1', 'early_ww2', 'late_ww2'].includes(plane.era) ? 1200 : 1500;
      expect(m!.tris, id).toBeLessThanOrEqual(budget);
      // Every gun mount in planes.json has at least one muzzle on the model.
      plane.guns.forEach((_g, i) => expect(m!.muzzles.some((x) => x.mount === i), `${id} mount ${i}`).toBe(true));
    }
  });

  it('manifest lists every model with its size', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../public/models/manifest.json', import.meta.url), 'utf8'));
    for (const id of [...ALL, ...BOMBERS]) expect(manifest.planes[id].bytes, id).toBeGreaterThan(1000);
    expect(Object.keys(manifest.weapons).sort()).toEqual(
      ['bomb_250', 'drop_tank', 'missile_ir_large', 'missile_ir_small', 'missile_radar_long', 'missile_radar_medium', 'rocket'],
    );
    expect(manifest.totalBytes).toBeLessThan(10 * 1024 * 1024);
  });

  it('the AI bombers have gunner muzzles and stay inside their budget', () => {
    for (const id of BOMBERS) {
      const m = PLANE_MODELS[id]!;
      expect(m.file).toBe(`models/bombers/${id}.glb`);
      expect(m.tris).toBeLessThanOrEqual(2000);
      expect(m.muzzles.length, id).toBeGreaterThanOrEqual(2);
    }
  });

  it('bullets leave from the model\'s muzzles', () => {
    const w = createWorld(ctx);
    const s = spawnPlane(w, ctx, { id: 'a', team: 'blue', planeId: 'spitfire_mk5' });
    s.pos = [0, 2000, 0];
    s.vel = [0, 0, 1e-6];
    s.quat = quatLookRotation([0, 0, 1]);
    const def = ctx.planeDefs.get('spitfire_mk5')!;
    const bullets: Bullet[] = [];
    fireGuns(s, def, { guns: ctx.guns, nextBulletId: () => w.nextBulletId++, random: () => 0.5, enemies: [] }, 0.2, bullets);
    const muzzleXs = PLANE_MODELS['spitfire_mk5']!.muzzles.map((m) => Math.abs(m.pos[0]));
    for (const b of bullets) {
      expect(muzzleXs.some((x) => Math.abs(Math.abs(b.pos[0]) - x) < 1e-6), `bullet at x=${b.pos[0]}`).toBe(true);
    }
  });

  it('hit spheres scale with plane size', () => {
    const camel = hitSpheres(data.planes.find((p) => p.id === 'sopwith_camel')!);
    const phantom = hitSpheres(data.planes.find((p) => p.id === 'f4e')!);
    expect(phantom.fuselage.r).toBeGreaterThan(camel.fuselage.r);
    expect(phantom.bound).toBeGreaterThan(camel.bound);
    expect(Math.abs(phantom.engine.c[2])).toBeGreaterThan(Math.abs(camel.engine.c[2]));
    expect(phantom.engine.c[2]).toBeLessThan(0); // jet engine at the tail
    expect(camel.engine.c[2]).toBeGreaterThan(0); // rotary at the nose
    expect(planeSize(data.planes.find((p) => p.id === 'f4e')!).lengthM).toBe(19.2);
  });
});

describe('missiles on pylons', () => {
  const classOf = (t: string) => data.missiles.missiles.find((m) => m.id === t)?.class;
  const slotsOf = (id: string) => pylonSlots(id, data.planes.find((p) => p.id === id)!.missiles, classOf);

  it('every jet with missiles shows all of them, radar inboard and IR outboard, in left/right pairs', () => {
    for (const plane of data.planes.filter((p) => p.missiles.length > 0)) {
      const slots = slotsOf(plane.id);
      const total = plane.missiles.reduce((a, m) => a + m.count, 0);
      expect(slots.length, plane.id).toBe(total);
      plane.missiles.forEach((m, i) => {
        const mine = slots.filter((s) => s.mount === i);
        // Pairs: the first two slots of a mount are mirror images.
        if (mine.length >= 2) expect(mine[0]!.pos[0], plane.id).toBeCloseTo(-mine[1]!.pos[0], 3);
      });
    }
  });

  it('F-15C: four AMRAAMs on the fuselage, two Sidewinders on the wings', () => {
    const s = slotsOf('f15c');
    expect(s.filter((x) => x.model === 'missile_radar_long')).toHaveLength(4);
    expect(s.filter((x) => x.model === 'missile_ir_small')).toHaveLength(2);
    const maxRadarX = Math.max(...s.filter((x) => x.mount === 0).map((x) => Math.abs(x.pos[0])));
    const minIrX = Math.min(...s.filter((x) => x.mount === 1).map((x) => Math.abs(x.pos[0])));
    expect(minIrX).toBeGreaterThan(maxRadarX);
  });
});
