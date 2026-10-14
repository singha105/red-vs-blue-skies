import { describe, expect, it } from 'vitest';
import { loadGameData, RAW_DATA } from '../../src/data';
import { brForTier, validateGameData, type RawData } from '../../src/data/validate';

const clone = (): RawData => structuredClone(RAW_DATA);

describe('data files', () => {
  it('all five files validate', () => {
    const result = loadGameData();
    if (!result.ok) {
      throw new Error(result.errors.map((e) => `${e.file} ${e.path}: ${e.message}`).join('\n'));
    }
    expect(result.data.planes).toHaveLength(60);
    expect(result.data.eras).toHaveLength(6);
    expect(result.data.maps.length).toBeGreaterThanOrEqual(4);
    expect(result.data.modes).toHaveLength(4);
  });

  it('every era has tiers 1–10 with the BR formula', () => {
    const result = loadGameData();
    if (!result.ok) throw new Error('data invalid');
    for (const era of result.data.eras) {
      const tiers = result.data.planes.filter((p) => p.era === era.id).map((p) => p.tier).sort((a, b) => a - b);
      expect(tiers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    }
    expect(brForTier(1)).toBe(1);
    expect(brForTier(10)).toBe(3.7);
  });

  it('only early-jet tiers 9–10 carry missiles in that era', () => {
    const result = loadGameData();
    if (!result.ok) throw new Error('data invalid');
    const armed = result.data.planes.filter((p) => p.era === 'early_jets' && p.missiles.length > 0);
    expect(armed.every((p) => p.tier >= 9)).toBe(true);
    const props = result.data.planes.filter((p) => ['ww1', 'early_ww2', 'late_ww2'].includes(p.era));
    expect(props.every((p) => p.missiles.length === 0)).toBe(true);
  });
});

describe('validator catches bad data', () => {
  it('reports a wrong BR with file and path', () => {
    const raw = clone();
    (raw['planes.json'] as { br: number }[])[0]!.br = 2.5;
    const result = validateGameData(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({ file: 'planes.json' });
    expect(result.errors[0]!.path).toContain('planes[0]');
    expect(result.errors[0]!.message).toContain('should be 1');
  });

  it('rejects unknown missiles and missiles in a gun-only era', () => {
    const raw = clone();
    const planes = raw['planes.json'] as { missiles: unknown[] }[];
    planes[0]!.missiles = [{ type: 'aim9l', count: 2 }];
    planes[59]!.missiles = [{ type: 'made_up', count: 2 }];
    const result = validateGameData(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const text = result.errors.map((e) => e.message).join('\n');
    expect(text).toContain('does not allow');
    expect(text).toContain('unknown missile "made_up"');
  });

  it('rejects a file that is not the right shape', () => {
    const raw = clone();
    raw['maps.json'] = { nope: true };
    const result = validateGameData(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.file === 'maps.json' && e.message.includes('expected an array'))).toBe(true);
  });

  it('rejects an unknown gun type and a missing era', () => {
    const raw = clone();
    (raw['planes.json'] as { guns: { type: string }[] }[])[3]!.guns[0]!.type = 'laser';
    raw['eras.json'] = (raw['eras.json'] as { id: string }[]).filter((e) => e.id !== 'modern');
    const result = validateGameData(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const text = result.errors.map((e) => e.message).join('\n');
    expect(text).toContain('"laser" is not one of');
    expect(text).toContain('missing era "modern"');
  });
});
