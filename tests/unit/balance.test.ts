import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/data';
import { createWorldContext } from '../../src/game/world';
import { DUEL_MAP, eraTournament, runDuel } from '../balance/tournament';

const result = loadGameData();
if (!result.ok) throw new Error('data invalid');
const data = result.data;

describe('bot tournament', () => {
  it('a duel is deterministic for its seed and always decides or draws', () => {
    const ctx = createWorldContext(data, DUEL_MAP);
    const a = runDuel(ctx, 'sopwith_camel', 'se5a', { seed: 5 });
    expect(runDuel(ctx, 'sopwith_camel', 'se5a', { seed: 5 })).toBe(a);
    expect(['a', 'b', 'draw']).toContain(a);
  });

  it('runs every adjacent pair of an era', () => {
    const pairs = eraTournament(data, 'ww1', 4, 3);
    expect(pairs).toHaveLength(9);
    for (const p of pairs) {
      expect(p.higherWins + p.lowerWins + p.draws).toBe(4);
      expect(p.higherRate).toBeGreaterThanOrEqual(0);
      expect(p.higherRate).toBeLessThanOrEqual(1);
    }
  });
});

describe('terrain ceiling', () => {
  it('nothing on any map is higher than its maxSurfaceM', () => {
    for (const map of data.maps) {
      const t = createWorldContext(data, map.id).terrain;
      let top = -1e9;
      for (let x = -t.half; x <= t.half; x += 97) for (let z = -t.half; z <= t.half; z += 97) top = Math.max(top, t.surfaceAt(x, z));
      expect(top, map.id).toBeLessThanOrEqual(t.maxSurfaceM);
    }
  });
});
