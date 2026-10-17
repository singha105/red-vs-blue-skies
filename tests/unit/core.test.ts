import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, getSettings, sanitizeSettings, updateSettings } from '../../src/core/settings';
import { levelForCappedFps, levelForFps } from '../../src/core/quality';
import { createRng } from '../../src/game/rng';
import { circlePose } from '../../src/game/testFlight';

describe('settings', () => {
  it('Day 10 options: 30 fps cap, team colours, HUD size, invert pitch', () => {
    expect(sanitizeSettings({ cap30: true, teamColours: 'colourblind', hudScale: 9, invertPitch: true })).toMatchObject({ cap30: true, teamColours: 'colourblind', hudScale: 1.6, invertPitch: true });
    expect(sanitizeSettings({ cap30: 'yes', teamColours: 'pink', hudScale: 0.2, invertPitch: 1 })).toMatchObject({ cap30: false, teamColours: 'classic', hudScale: 1, invertPitch: false, controlMode: 'mouseAim', units: 'imperial', touchRudder: false, tiltSteer: false });
    expect(sanitizeSettings({ controlMode: 'joystick', units: 'metric', touchRudder: true, tiltSteer: 'yes' })).toMatchObject({ controlMode: 'joystick', units: 'metric', touchRudder: true, tiltSteer: false });
  });

  it('auto quality under the 30 fps cap never picks high', () => {
    expect(levelForCappedFps(30)).toBe('medium');
    expect(levelForCappedFps(24)).toBe('low');
    expect(levelForFps(60)).toBe('high');
  });

  it('falls back to defaults for missing or broken values', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ graphics: 'ultra', sensitivity: 'fast', volume: Number.NaN })).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps numbers into range', () => {
    const s = sanitizeSettings({ graphics: 'low', sensitivity: 9, aimAssist: -1, volume: 0.5, engineVolume: 4, effectsVolume: -2 });
    expect(s).toEqual({ graphics: 'low', sensitivity: 3, aimAssist: 0, volume: 0.5, engineVolume: 1, effectsVolume: 0, cockpitVolume: DEFAULT_SETTINGS.cockpitVolume, cap30: false, teamColours: 'classic', hudScale: 1, invertPitch: false, controlMode: 'mouseAim', units: 'imperial', flightModel: 'arcade', touchRudder: false, tiltSteer: false });
  });

  it('flight model is Arcade unless Realistic is asked for', () => {
    expect(sanitizeSettings({ flightModel: 'realistic' }).flightModel).toBe('realistic');
    expect(sanitizeSettings({ flightModel: 'sim' }).flightModel).toBe('arcade');
    expect(DEFAULT_SETTINGS.flightModel).toBe('arcade');
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

describe('keybindings (Day 11)', () => {
  it('every action has a keyboard default, none clash, and the gamepad defaults match the spec', async () => {
    const kb = await import('../../src/core/keybinds');
    const all = kb.allBindings();
    for (const a of kb.ACTIONS) expect(all.keyboard[a].length, a).toBeGreaterThan(0);
    expect(kb.findConflicts(all.keyboard).size).toBe(0);
    expect(kb.findConflicts(all.gamepad).size).toBe(0);
    expect(all.keyboard.throttleUp).toEqual(['KeyW']);
    expect(all.keyboard.fireGuns).toEqual(['MouseLeft']);
    expect(all.keyboard.fireSecondary).toEqual(['Space']);
    expect(all.keyboard.selectTarget).toEqual(['MouseMiddle', 'KeyT']);
    expect(all.keyboard.countermeasures).toEqual(['KeyX']);
    expect(all.keyboard.radarLock).toEqual(['KeyR']);
    expect(all.gamepad.throttleUp).toEqual(['RT']);
    expect(all.gamepad.countermeasures).toEqual(['DpadDown']);
  });

  it('rebinding saves, flags conflicts and resets', async () => {
    const kb = await import('../../src/core/keybinds');
    kb.setBinding('keyboard', 'airbrake', 1, 'KeyW');
    expect(kb.codesFor('keyboard', 'airbrake')).toEqual(['KeyH', 'KeyW']);
    expect(kb.findConflicts(kb.allBindings().keyboard).get('KeyW')).toEqual(['throttleUp', 'airbrake']);
    kb.setBinding('keyboard', 'airbrake', 1, '');
    expect(kb.codesFor('keyboard', 'airbrake')).toEqual(['KeyH']);
    kb.setBinding('gamepad', 'airbrake', 0, 'Y');
    kb.resetBindings();
    expect(kb.codesFor('gamepad', 'airbrake')).toEqual([]);
    expect(kb.codeLabel('ShiftLeft')).toBe('Left Shift');
    expect(kb.codeLabel('RT', true)).toBe('R2');
  });
});

describe('player controls (Day 11)', () => {
  it('rudder ramps in over 0.3 s and recentres; WEP needs a held throttle at 100%; R toggles the lock', async () => {
    const { createPlayerControls, RUDDER_RAMP_S, WEP_THROTTLE } = await import('../../src/core/playerControls');
    const { createWorld, createWorldContext, spawnPlane } = await import('../../src/game/world');
    const { loadGameData } = await import('../../src/data');
    const r = loadGameData();
    if (!r.ok) throw new Error('data');
    const ctx = createWorldContext(r.data, 'island_chain');
    const w = createWorld(ctx, 1);
    const p = spawnPlane(w, ctx, { id: 'p', team: 'blue', planeId: 'f15c' });
    const c = createPlayerControls();
    c.resetTo(p, true);
    c.rudderWanted = 1;
    c.sample(p, RUDDER_RAMP_S / 2);
    expect(c.rudder).toBeCloseTo(0.5, 5);
    c.sample(p, RUDDER_RAMP_S);
    expect(c.rudder).toBe(1);
    c.rudderWanted = 0;
    c.sample(p, RUDDER_RAMP_S);
    expect(c.rudder).toBe(0);
    // Throttle: up to 100%, then WEP only after holding on.
    c.setThrottle(0.9);
    c.throttleUp(1, 0.6);
    expect(c.throttle).toBe(1);
    c.throttleUp(0.1, 0.6);
    expect(c.throttle).toBe(1);
    c.throttleUp(0.4, 0.6);
    expect(c.throttle).toBe(WEP_THROTTLE);
    expect(c.sample(p, 1 / 60)).toMatchObject({ throttle: 1, wep: true });
    c.throttleDown(0.01, 0.6);
    expect(c.throttle).toBe(1);
    // Radar lock toggle and giving up when nothing locks.
    c.toggleRadarLock(p);
    expect(c.radarLockWanted).toBe(true);
    for (let i = 0; i < 120; i++) c.sample(p, 1 / 60);
    expect(c.radarLockWanted).toBe(false);
    // Mouse joystick: the mouse moves the stick, which flies the plane directly.
    c.mode = 'joystick';
    c.moveAim(0.25, 0);
    expect(c.sample(p, 1 / 60).roll).toBeGreaterThan(0.4);
  });
});
