import { describe, expect, it } from 'vitest';
import { isPhoneOrTablet } from '../../src/core/device';
import { codeLabel, findConflicts, allBindings } from '../../src/core/keybinds';
import { createPlayerControls, LOOK_BACK_S, nextView } from '../../src/core/playerControls';
import { isQualityLevel, levelForFps, QUALITY } from '../../src/core/quality';
import { flapStepOf, neutralInput } from '../../src/game/controls';
import { decodeInput, encodeInput } from '../../src/net/protocol';

const media = (coarse: boolean, fine: boolean) => (q: string): boolean => (q.includes('any-pointer: fine') ? fine : q.includes('pointer: coarse') ? coarse : false);

describe('Day 12: desktop only', () => {
  it('phones and tablets are spotted; laptops (even with touch screens) are not', () => {
    const mac = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 0 };
    expect(isPhoneOrTablet(mac, media(false, true))).toBe(false);
    expect(isPhoneOrTablet({ ...mac, maxTouchPoints: 5 }, media(true, false))).toBe(true); // iPad asking for the desktop site
    expect(isPhoneOrTablet({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5 }, media(true, false))).toBe(true);
    expect(isPhoneOrTablet({ userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile', platform: 'Linux armv8l', maxTouchPoints: 5 }, media(true, false))).toBe(true);
    const winTouch = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0', platform: 'Win32', maxTouchPoints: 10 };
    expect(isPhoneOrTablet(winTouch, media(true, true))).toBe(false);
    // A tablet in desktop mode: coarse pointer, no fine one.
    expect(isPhoneOrTablet({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/141.0', platform: 'Linux x86_64', maxTouchPoints: 5 }, media(true, false))).toBe(true);
  });

  it('quality has four desktop tiers; Ultra draws LOD0 further and sharper shadows; auto never picks it', () => {
    expect(Object.keys(QUALITY)).toEqual(['low', 'medium', 'high', 'ultra']);
    expect(QUALITY.ultra.planeLodScale).toBeGreaterThan(QUALITY.high.planeLodScale);
    expect(QUALITY.ultra.shadowMapSize).toBeGreaterThan(QUALITY.high.shadowMapSize);
    expect(QUALITY.ultra.hangar4k).toBe(true);
    expect(levelForFps(240)).toBe('high');
    expect(isQualityLevel('ultra')).toBe(true);
    expect(isQualityLevel('extreme')).toBe(false);
  });
});

describe('Day 12: views and look back', () => {
  it('B cycles chase → cockpit → HUD on jets, chase → cockpit on props', () => {
    expect(nextView('chase', true)).toBe('cockpit');
    expect(nextView('cockpit', true)).toBe('hud');
    expect(nextView('hud', true)).toBe('chase');
    expect(nextView('cockpit', false)).toBe('chase');
  });

  it('look back swings round in about 0.15 s, eased, and back on release', () => {
    const c = createPlayerControls();
    c.lookBack = true;
    c.stepLookBack(LOOK_BACK_S / 2);
    expect(c.lookBackT).toBeCloseTo(0.5, 5);
    c.stepLookBack(LOOK_BACK_S / 2 + 0.01);
    expect(c.lookBackT).toBe(1);
    expect(c.lookingBack).toBe(true);
    c.lookBack = false;
    c.stepLookBack(LOOK_BACK_S / 4);
    expect(c.lookBackT).toBeLessThan(1);
    expect(c.lookingBack).toBe(true); // still swinging back: the aim keeps holding
    c.stepLookBack(LOOK_BACK_S);
    expect(c.lookBackT).toBe(0);
    expect(c.lookingBack).toBe(false);
  });
});

describe('Day 12: gear and flap steps', () => {
  it('flap steps and gear survive the wire, and old inputs still mean Landing flaps', () => {
    const i = { ...neutralInput(1), flaps: true, flapStep: 2, gear: true };
    const back = decodeInput(encodeInput(4, i))!;
    expect(back.input.flapStep).toBe(2);
    expect(back.input.gear).toBe(true);
    expect(back.input.flaps).toBe(true);
    expect(flapStepOf({ ...neutralInput(1), flaps: true })).toBe(3);
    expect(flapStepOf(neutralInput(1))).toBe(0);
    const c = createPlayerControls();
    c.flapStep = 1;
    c.gear = true;
    expect(c.sample({ ...samplePlane() }, 1 / 60)).toMatchObject({ flaps: true, flapStep: 1, gear: true });
  });

  it('default bindings: G gear, F / Shift+F flaps, V look back, B view, no conflicts', () => {
    const b = allBindings();
    expect(b.keyboard.gear).toEqual(['KeyG']);
    expect(b.keyboard.flapsDown).toEqual(['KeyF']);
    expect(b.keyboard.flapsUp).toEqual(['Shift+KeyF']);
    expect(b.keyboard.lookBack).toEqual(['KeyV']);
    expect(b.keyboard.switchView).toEqual(['KeyB']);
    expect(b.gamepad.gear).toEqual([]);
    expect(b.gamepad.flapsDown).toEqual([]);
    expect(b.gamepad.lookBack).toEqual(['RS']);
    expect(b.gamepad.switchView).toEqual(['View:hold']);
    expect(findConflicts(b.keyboard).size).toBe(0);
    expect(findConflicts(b.gamepad).size).toBe(0);
    expect(codeLabel('Shift+KeyF')).toBe('Shift+F');
    expect(codeLabel('View:hold')).toBe('View (hold)');
    expect(codeLabel('View:hold', true)).toBe('Touchpad (hold)');
  });
});

function samplePlane() {
  return {
    id: 't', team: 'blue' as const, planeId: 'p51d', pos: [0, 1000, 0] as [number, number, number], quat: [0, 0, 0, 1] as [number, number, number, number],
    vel: [0, 0, 150] as [number, number, number], throttle: 1, hp: 100, stalled: false, alive: true, g: 1, edgeWarning: false, autoTurn: false,
    respawnIn: 0, maxHp: 100, protectedFor: 0, damaged: { engine: false, wingL: false, wingR: false }, partDamage: { fuselage: 0, wingL: 0, wingR: 0, engine: 0 },
    fireFor: 0, damageBy: {}, lastHitBy: null, lastHitAt: -1e9, wreck: false, ammo: [], gunHeat: [], assist: 0, firing: false, missiles: [], flares: 0,
    chaff: 0, lockTarget: null, lockMount: -1, lockProgress: 0, missileCooldown: 0, cmCooldown: 0, missileHeld: false, rockets: 0, bombs: 0,
    ordnanceCooldown: 0, wep: false, engineHeat: 0, overheatFor: 0, airbrake: false, flaps: false, radarOn: false, radarMode: 'search' as const,
    radarRange: 1, radarLock: null, radarLostFor: 0, secondary: -1,
  };
}
