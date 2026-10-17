import { expect, test, type Page } from '@playwright/test';

// Day 11: War Thunder-style controls on every device, rebinding, the jet HUD and the radar.
const SHOTS = 'tests/screenshots';

type Hooks = Record<string, (...a: unknown[]) => unknown>;
const hook = <T>(page: Page, name: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([n, a]) => (window as unknown as { __rvbs: Hooks }).__rvbs[n as string]!(...(a as unknown[])) as T, [name, args] as const);

interface Cockpit {
  throttle: number;
  rudder: number;
  airbrake: boolean;
  flaps: boolean;
  flapStep: number;
  gear: boolean;
  lookBack: boolean;
  lookBackT: number;
  radarOn: boolean;
  radarDogfight: boolean;
  radarRange: number;
  radarLockWanted: boolean;
  secondary: number;
  target: string | null;
  view: 'chase' | 'cockpit' | 'hud';
  zoom: boolean;
  freeLook: boolean;
  mode: string;
  paused: boolean;
  menuOpen: boolean;
  mapOpen: boolean;
}
const cockpit = (page: Page): Promise<Cockpit> => hook<Cockpit>(page, 'cockpit');
interface Me {
  radarLock: string | null;
  flares: number;
  wep: boolean;
  engineHeat: number;
  throttle: number;
}
const me = (page: Page): Promise<Me> => hook<Me>(page, 'player');

/** A fake standard-mapping gamepad whose buttons and axes the test sets through window.__pad. */
const FAKE_PAD = `
  window.__pad = { buttons: Array.from({ length: 17 }, () => 0), axes: [0, 0, 0, 0] };
  navigator.getGamepads = () => [{
    id: 'Fake pad', index: 0, connected: true, mapping: 'standard', timestamp: performance.now(),
    axes: window.__pad.axes,
    buttons: window.__pad.buttons.map((v) => ({ pressed: v > 0.5, touched: v > 0, value: v })),
  }];
`;

async function solo(page: Page, opts: { era: string; planeId: string; map?: string }, query = ''): Promise<void> {
  await page.goto(`./?debug=1${query}`);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await hook(page, 'startSolo', { map: 'island_chain', mode: 'tdm', ...opts });
  await expect.poll(() => hook<string>(page, 'mode')).toBe('match');
  await page.waitForTimeout(600);
}

const tap = async (page: Page, code: string): Promise<void> => {
  await page.keyboard.down(code);
  await page.waitForTimeout(60);
  await page.keyboard.up(code);
  await page.waitForTimeout(60);
};

test.describe('keyboard and mouse', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop controls');

  test('every default key does its job, and the jet HUD and radar panel show', async ({ page }, info) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await solo(page, { era: 'modern', planeId: 'f15c', map: 'mountain_valley' });
    await expect(page.getByTestId('flight-hud')).toBeVisible();
    await expect(page.getByTestId('radar-panel')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-day11-jet-hud.png` });
    // Well above the peaks for the switch checks: a respawn after flying into a mountain resets the cockpit
    // switches (radar back on), and a slow run under the full suite can get that far.
    await hook(page, 'placePlayer', 0, -5000, 2400, 90);

    // W to 100%, keep holding: WEP / afterburner.
    await page.keyboard.down('KeyW');
    await expect.poll(async () => (await cockpit(page)).throttle, { timeout: 5000 }).toBeGreaterThan(1);
    await page.keyboard.up('KeyW');
    await expect.poll(async () => (await me(page)).wep, { timeout: 3000 }).toBe(true);
    await tap(page, 'KeyS');
    await expect.poll(async () => (await cockpit(page)).throttle).toBeLessThanOrEqual(1);

    // Q / E: rudder ramps in while held and recentres on release.
    await page.keyboard.down('KeyE');
    await page.waitForTimeout(450);
    await expect.poll(async () => (await cockpit(page)).rudder).toBeGreaterThan(0.9);
    await page.keyboard.up('KeyE');
    await page.waitForTimeout(450);
    await expect.poll(async () => Math.abs((await cockpit(page)).rudder)).toBeLessThan(0.05);
    await page.keyboard.down('KeyQ');
    await page.waitForTimeout(100);
    // (The 0.3 s ramp itself is unit-tested; headless frames are too uneven to time it here.)
    await expect.poll(async () => (await cockpit(page)).rudder).toBeLessThan(-0.05);
    await page.keyboard.up('KeyQ');

    // H airbrake, F flaps (Day 12: one step down; Shift+F one up), B views (chase → cockpit → HUD on jets),
    // C free look (held), N secondary, 1/2/3 radar.
    await tap(page, 'KeyH');
    await tap(page, 'KeyF');
    await tap(page, 'KeyB');
    await expect.poll(async () => (await cockpit(page)).airbrake).toBe(true);
    await expect.poll(async () => (await cockpit(page)).flaps).toBe(true);
    await expect.poll(async () => (await cockpit(page)).view).toBe('cockpit');
    await tap(page, 'KeyB');
    await expect.poll(async () => (await cockpit(page)).view).toBe('hud');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-day11-hud-view.png` });
    await tap(page, 'KeyB');
    await expect.poll(async () => (await cockpit(page)).view).toBe('chase');
    await tap(page, 'KeyH');
    await page.keyboard.down('ShiftLeft');
    await tap(page, 'KeyF');
    await page.keyboard.up('ShiftLeft');
    await expect.poll(async () => (await cockpit(page)).flapStep).toBe(0);
    await page.keyboard.down('KeyC');
    await page.waitForTimeout(100);
    await expect.poll(async () => (await cockpit(page)).freeLook).toBe(true);
    await page.keyboard.up('KeyC');
    await tap(page, 'KeyN');
    await expect.poll(async () => (await cockpit(page)).secondary).toBe(0);
    await tap(page, 'Digit3');
    await expect.poll(async () => (await cockpit(page)).radarRange).toBe(2);
    await tap(page, 'Digit2');
    await expect.poll(async () => (await cockpit(page)).radarDogfight).toBe(true);
    await tap(page, 'Digit2');
    // One press at a time: under the full suite's load a software-rendered frame can take a quarter second.
    await expect.poll(async () => (await cockpit(page)).radarDogfight).toBe(false);
    await tap(page, 'Digit1');
    await expect.poll(async () => (await cockpit(page)).radarOn, { timeout: 10_000 }).toBe(false);
    await tap(page, 'Digit1');

    // An enemy dead ahead: T selects it, R locks it with the radar, and the scope shows the lock. (First put us
    // well above the peaks: a slow software-rendered run can fly into Mountain Valley's mountains by now.)
    await hook(page, 'placePlayer', 0, -5000, 2400, 90);
    const enemy = await hook<string>(page, 'placeEnemyAhead', 3500);
    await tap(page, 'KeyT');
    await expect.poll(async () => (await cockpit(page)).target).toBe(enemy);
    await tap(page, 'KeyR');
    await expect.poll(async () => (await me(page)).radarLock, { timeout: 3000 }).toBe(enemy);
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-day11-radar-lock.png` });
    await tap(page, 'KeyR');
    await expect.poll(async () => (await me(page)).radarLock, { timeout: 3000 }).toBeNull();

    // X: flares and chaff.
    const flares = (await me(page)).flares;
    await tap(page, 'KeyX');
    await expect.poll(async () => (await me(page)).flares).toBeLessThan(flares);

    // M map, Tab scoreboard (held), P pause (solo), Esc menu.
    await tap(page, 'KeyM');
    await expect.poll(async () => (await cockpit(page)).mapOpen).toBe(true);
    await tap(page, 'KeyM');
    await page.keyboard.down('Tab');
    await expect(page.locator('.hud__board')).toBeVisible();
    await page.keyboard.up('Tab');
    await expect(page.locator('.hud__board')).toBeHidden();
    await tap(page, 'KeyP');
    await expect.poll(async () => (await cockpit(page)).paused).toBe(true);
    await tap(page, 'KeyP');
    await tap(page, 'Escape');
    await expect(page.getByTestId('match-menu')).toBeVisible();
    await expect.poll(async () => (await cockpit(page)).paused).toBe(true);
    await page.getByTestId('match-menu').getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByTestId('match-menu')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('rebinding: a new key works, conflicts are flagged, reset restores the defaults', async ({ page }, info) => {
    await solo(page, { era: 'late_ww2', planeId: 'p51d' });
    await tap(page, 'Escape');
    const menu = page.getByTestId('match-menu');
    await menu.getByRole('button', { name: 'Controls' }).click();
    const list = page.getByTestId('binding-list');
    await expect(list).toBeVisible();
    // Throttle up, slot 2: press I.
    await list.getByRole('button', { name: /^Throttle up.*slot 2/ }).click();
    await page.waitForTimeout(50);
    await page.keyboard.press('KeyI');
    await expect(list.getByRole('button', { name: /^Throttle up.*slot 2: I$/ })).toBeVisible();
    // Bind A (roll left) to airbrake too: a conflict.
    await list.getByRole('button', { name: /^Airbrake, slot 2/ }).click();
    await page.waitForTimeout(50);
    await page.keyboard.press('KeyA');
    await expect(page.getByTestId('binding-conflicts')).toContainText('A is bound to');
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-day11-controls.png` });
    // Saved per player: still there after a reload.
    const saved = await page.evaluate(() => localStorage.getItem('rvbs.keybinds.v1'));
    expect(saved).toContain('KeyI');
    await page.getByRole('button', { name: 'Done' }).click();
    await menu.getByRole('button', { name: 'Resume' }).click();
    const before = (await cockpit(page)).throttle;
    await page.keyboard.down('KeyI');
    await page.waitForTimeout(400);
    await page.keyboard.up('KeyI');
    expect((await cockpit(page)).throttle).toBeGreaterThan(Math.min(1, before + 0.1));
    // Reset.
    await tap(page, 'Escape');
    await menu.getByRole('button', { name: 'Controls' }).click();
    await page.getByTestId('reset-bindings').click();
    await expect(page.getByTestId('binding-conflicts')).toBeHidden();
    await expect(list.getByRole('button', { name: /^Throttle up.*slot 2: —$/ })).toBeVisible();
  });

  test('mouse joystick mode moves the stick instead of the aim circle', async ({ page }) => {
    await solo(page, { era: 'late_ww2', planeId: 'p51d' });
    await page.evaluate(() => localStorage.setItem('rvbs.settings.v1', JSON.stringify({ controlMode: 'joystick' })));
    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    await hook(page, 'startSolo', { era: 'late_ww2', planeId: 'p51d', map: 'island_chain', mode: 'tdm' });
    await expect.poll(async () => (await cockpit(page)).mode).toBe('joystick');
  });
});

test.describe('gamepad', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop browser with a pad');

  test('triggers, bumpers, face buttons and the d-pad, and a pad button can be rebound', async ({ page }) => {
    test.setTimeout(60_000);
    await page.addInitScript(FAKE_PAD);
    await solo(page, { era: 'modern', planeId: 'f16c_b50' });
    const pad = async (i: number, v: number): Promise<void> => {
      await page.evaluate(([b, val]) => {
        (window as unknown as { __pad: { buttons: number[] } }).__pad.buttons[b as number] = val as number;
      }, [i, v]);
    };
    const press = async (i: number): Promise<void> => {
      await pad(i, 1);
      await page.waitForTimeout(120);
      await pad(i, 0);
      await page.waitForTimeout(120);
    };
    // RT [R2] up to WEP.
    await pad(7, 1);
    await expect.poll(async () => (await cockpit(page)).throttle, { timeout: 5000 }).toBeGreaterThan(1);
    await pad(7, 0);
    // LB [L1] rudder left.
    await pad(4, 1);
    await page.waitForTimeout(400);
    await expect.poll(async () => (await cockpit(page)).rudder).toBeLessThan(-0.9);
    await pad(4, 0);
    // X [Square] switches the secondary; d-pad right range, d-pad left mode.
    await press(2);
    await expect.poll(async () => (await cockpit(page)).secondary).toBe(0);
    await press(15);
    await expect.poll(async () => (await cockpit(page)).radarRange).toBe(2);
    await press(14);
    await expect.poll(async () => (await cockpit(page)).radarDogfight).toBe(true);
    await press(14);
    // Y [Triangle] selects the enemy ahead, d-pad up locks it.
    const enemy = await hook<string>(page, 'placeEnemyAhead', 3000);
    await press(3);
    await expect.poll(async () => (await cockpit(page)).target).toBe(enemy);
    await press(12);
    await expect.poll(async () => (await me(page)).radarLock, { timeout: 3000 }).toBe(enemy);
    // D-pad down: flares and chaff.
    const flares = (await me(page)).flares;
    await press(13);
    await expect.poll(async () => (await me(page)).flares).toBeLessThan(flares);
    // Day 12: holding RS [R3] looks back; holding View [Touchpad] changes view, a tap shows / hides the scoreboard.
    await pad(11, 1);
    await expect.poll(async () => (await cockpit(page)).lookBackT).toBeGreaterThan(0.99);
    await pad(11, 0);
    await expect.poll(async () => (await cockpit(page)).lookBackT).toBe(0);
    await pad(8, 1);
    await page.waitForTimeout(800);
    await pad(8, 0);
    await expect.poll(async () => (await cockpit(page)).view).toBe('cockpit');
    await expect(page.locator('.hud__board')).toBeHidden();
    // A tap released by a timer inside the page: under software rendering the test's own release can arrive
    // late enough to count as a hold.
    const tapView = async (): Promise<void> => {
      await page.evaluate(() => {
        const b = (window as unknown as { __pad: { buttons: number[] } }).__pad.buttons;
        b[8] = 1;
        setTimeout(() => (b[8] = 0), 200);
      });
      await page.waitForTimeout(600);
    };
    await tapView();
    await expect(page.locator('.hud__board')).toBeVisible();
    await tapView();
    await expect(page.locator('.hud__board')).toBeHidden();

    // Rebind airbrake to the Y button through the Controls screen's gamepad tab.
    await press(9); // Menu [Options]
    const menu = page.getByTestId('match-menu');
    await expect(menu).toBeVisible();
    await menu.getByRole('button', { name: 'Controls' }).click();
    await page.getByRole('tab', { name: 'Gamepad' }).click();
    await page.getByTestId('binding-list').getByRole('button', { name: /^Airbrake, slot 1/ }).click();
    await page.waitForTimeout(100);
    await press(3);
    await expect(page.getByTestId('binding-list').getByRole('button', { name: /^Airbrake, slot 1: Y/ })).toBeVisible();
    await expect(page.getByTestId('binding-conflicts')).toContainText('Y is bound to');
  });
});

test.describe('touch', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone controls');

  test('RDR, MSL switch arrow, CM, LEVEL, look, ZOOM, WEP band and tapping the scores', async ({ page }, info) => {
    test.setTimeout(60_000);
    await solo(page, { era: 'modern', planeId: 'f15c', map: 'mountain_valley' });
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-day11-touch-jet.png` });
    const radar = page.getByTestId('radar-btn');
    await expect(radar).toBeVisible();
    // Long-press: Dogfight; tap: lock wanted.
    await radar.dispatchEvent('pointerdown', { pointerId: 5, pointerType: 'touch', isPrimary: true });
    await page.waitForTimeout(650);
    await radar.dispatchEvent('pointerup', { pointerId: 5, pointerType: 'touch', isPrimary: true });
    await expect.poll(async () => (await cockpit(page)).radarDogfight).toBe(true);
    await radar.dispatchEvent('pointerdown', { pointerId: 6, pointerType: 'touch', isPrimary: true });
    await radar.dispatchEvent('pointerup', { pointerId: 6, pointerType: 'touch', isPrimary: true });
    await page.waitForTimeout(150);
    // In Dogfight a lock is wanted already, so the tap releases it.
    await expect.poll(async () => (await cockpit(page)).radarLockWanted).toBe(false);
    // Switch arrow cycles the secondary.
    await page.getByTestId('switch-btn').click();
    await expect.poll(async () => (await cockpit(page)).secondary).toBe(0);
    await expect(page.getByTestId('missile-btn')).toContainText('AIM-120');
    // CM drops flares.
    const flares = (await me(page)).flares;
    const cm = page.getByTestId('cm-btn');
    await cm.dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch' });
    await page.waitForTimeout(200);
    await cm.dispatchEvent('pointerup', { pointerId: 7, pointerType: 'touch' });
    await expect.poll(async () => (await me(page)).flares).toBeLessThan(flares);
    // ZOOM held; the eye dragged looks around.
    const zoom = page.getByRole('button', { name: 'ZOOM' });
    await zoom.dispatchEvent('pointerdown', { pointerId: 8, pointerType: 'touch' });
    await expect.poll(async () => (await cockpit(page)).zoom).toBe(true);
    await zoom.dispatchEvent('pointerup', { pointerId: 8, pointerType: 'touch' });
    const eye = page.getByTestId('look-btn');
    const box = (await eye.boundingBox())!;
    await eye.dispatchEvent('pointerdown', { pointerId: 9, pointerType: 'touch', clientX: box.x + 20, clientY: box.y + 20 });
    await eye.dispatchEvent('pointermove', { pointerId: 9, pointerType: 'touch', clientX: box.x - 60, clientY: box.y + 20 });
    await expect.poll(async () => (await cockpit(page)).freeLook).toBe(true);
    await eye.dispatchEvent('pointerup', { pointerId: 9, pointerType: 'touch' });
    await expect.poll(async () => (await cockpit(page)).freeLook).toBe(false);
    // Throttle slider's top band: WEP.
    const slider = page.getByRole('slider', { name: 'Throttle' });
    const sb = (await slider.boundingBox())!;
    await slider.dispatchEvent('pointerdown', { pointerId: 10, pointerType: 'touch', clientX: sb.x + sb.width / 2, clientY: sb.y + 3 });
    await slider.dispatchEvent('pointerup', { pointerId: 10, pointerType: 'touch' });
    await expect.poll(async () => (await cockpit(page)).throttle).toBeGreaterThan(1);
    await expect(slider).toContainText('WEP');
    // Tapping the team scores opens the scoreboard.
    await page.locator('.hud__top').click();
    await expect(page.locator('.hud__board')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-day11-touch-board.png` });
  });

  test('rudder buttons appear with the setting', async ({ page }) => {
    await page.goto('./?debug=1');
    await page.evaluate(() => localStorage.setItem('rvbs.settings.v1', JSON.stringify({ touchRudder: true })));
    await solo(page, { era: 'late_ww2', planeId: 'p51d' });
    const right = page.getByRole('button', { name: 'Rudder right' });
    await expect(right).toBeVisible();
    await right.dispatchEvent('pointerdown', { pointerId: 3, pointerType: 'touch' });
    await page.waitForTimeout(400);
    await expect.poll(async () => (await cockpit(page)).rudder).toBeGreaterThan(0.9);
    await right.dispatchEvent('pointerup', { pointerId: 3, pointerType: 'touch' });
  });
});
