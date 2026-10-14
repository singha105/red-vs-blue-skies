import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, getSettings, sanitizeSettings, updateSettings } from '../../src/core/settings';
import { createRng } from '../../src/game/rng';
import { circlePose } from '../../src/game/testFlight';

describe('settings', () => {
  it('falls back to defaults for missing or broken values', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ graphics: 'ultra', sensitivity: 'fast', volume: Number.NaN })).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps numbers into range', () => {
    const s = sanitizeSettings({ graphics: 'low', sensitivity: 9, aimAssist: -1, volume: 0.5 });
    expect(s).toEqual({ graphics: 'low', sensitivity: 3, aimAssist: 0, volume: 0.5 });
  });

  it('updates without localStorage (private browsing / Node)', () => {
    updateSettings({ volume: 0.25, graphics: 'high' });
    expect(getSettings()).toMatchObject({ volume: 0.25, graphics: 'high' });
  });
});

describe('game math', () => {
  it('seeded rng is reproducible', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('circle pose stays on the circle with a coordinated bank', () => {
    const path = { center: [0, 100, 0] as [number, number, number], radiusM: 300, speedMs: 60 };
    for (const t of [0, 3.3, 17]) {
      const pose = circlePose(path, t);
      expect(Math.hypot(pose.pos[0], pose.pos[2])).toBeCloseTo(300, 6);
      expect(Math.hypot(...pose.forward)).toBeCloseTo(1, 6);
      expect(Math.hypot(...pose.up)).toBeCloseTo(1, 6);
      // forward is perpendicular to up
      expect(pose.forward[0] * pose.up[0] + pose.forward[1] * pose.up[1] + pose.forward[2] * pose.up[2]).toBeCloseTo(0, 6);
    }
    // tan(bank) = v² / (r g)
    expect(Math.tan(circlePose(path, 0).bankRad)).toBeCloseTo((60 * 60) / (300 * 9.81), 6);
  });
});
