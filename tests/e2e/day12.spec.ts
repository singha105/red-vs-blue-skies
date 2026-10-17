import { expect, test, type Page } from '@playwright/test';

// Day 12 Part A: look back (V), views (B: chase → cockpit → HUD on jets), landing gear (G) and flap steps (F, Shift+F).
const SHOTS = 'tests/screenshots';

type Hooks = Record<string, (...a: unknown[]) => unknown>;
const hook = <T>(page: Page, name: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([n, a]) => (window as unknown as { __rvbs: Hooks }).__rvbs[n as string]!(...(a as unknown[])) as T, [name, args] as const);
interface Cockpit {
  view: string;
  flapStep: number;
  gear: boolean;
  lookBack: boolean;
  lookBackT: number;
  freeLook: boolean;
}
const cockpit = (page: Page): Promise<Cockpit> => hook<Cockpit>(page, 'cockpit');
interface ViewInfo {
  camera: number[];
  look: number[];
  plane: number[] | null;
  nose: number[] | null;
  view: string;
}
const viewInfo = (page: Page): Promise<ViewInfo> => hook<ViewInfo>(page, 'viewInfo');
const dot = (a: number[], b: number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

async function solo(page: Page, era: string, planeId: string, query = ''): Promise<void> {
  await page.goto(`./?debug=1${query}`);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await hook(page, 'startSolo', { era, planeId, map: 'island_chain', mode: 'tdm' });
  await expect.poll(() => hook<string>(page, 'mode')).toBe('match');
  await page.waitForTimeout(600);
  await hook(page, 'placePlayer', 0, -4000, 1500, 90);
}

const tap = async (page: Page, code: string): Promise<void> => {
  await page.keyboard.down(code);
  await page.waitForTimeout(60);
  await page.keyboard.up(code);
  await page.waitForTimeout(60);
};

test('holding V looks back over the tail and releasing looks ahead again', async ({ page }) => {
  test.setTimeout(60_000);
  await solo(page, 'late_ww2', 'p51d');
  const ahead = await viewInfo(page);
  expect(dot(ahead.look, ahead.nose!)).toBeGreaterThan(0.6);
  const aimBefore = await hook<{ yaw: number; pitch: number }>(page, 'aim');
  await page.keyboard.down('KeyV');
  await expect.poll(async () => (await cockpit(page)).lookBackT).toBeGreaterThan(0.99);
  await page.waitForTimeout(300);
  const back = await viewInfo(page);
  // Looking back: the camera points against the nose, from in front of the plane.
  expect(dot(back.look, back.nose!)).toBeLessThan(-0.6);
  const toCam = [back.camera[0]! - back.plane![0]!, back.camera[1]! - back.plane![1]!, back.camera[2]! - back.plane![2]!];
  expect(dot(toCam, back.nose!)).toBeGreaterThan(0);
  // The mouse moves the camera, not the aim, while looking back.
  await page.mouse.move(400, 300);
  const aimDuring = await hook<{ yaw: number; pitch: number }>(page, 'aim');
  expect(Math.abs(aimDuring.yaw - aimBefore.yaw)).toBeLessThan(0.2);
  await page.screenshot({ path: `${SHOTS}/day12-look-back.png` });
  await page.keyboard.up('KeyV');
  await expect.poll(async () => (await cockpit(page)).lookBackT).toBe(0);
  await page.waitForTimeout(400);
  const again = await viewInfo(page);
  expect(dot(again.look, again.nose!)).toBeGreaterThan(0.6);
});

test('look back in the cockpit is over the shoulder; Settings can make V a toggle', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('./?debug=1');
  await page.evaluate(() => localStorage.setItem('rvbs.settings.v1', JSON.stringify({ lookBack: 'toggle' })));
  await solo(page, 'late_ww2', 'p51d');
  await tap(page, 'KeyB');
  await expect.poll(async () => (await cockpit(page)).view).toBe('cockpit');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/day12-cockpit-view.png` });
  // Toggle: one press looks back and stays there.
  await tap(page, 'KeyV');
  await page.waitForTimeout(500);
  expect((await cockpit(page)).lookBackT).toBeGreaterThan(0.99);
  const back = await viewInfo(page);
  expect(dot(back.look, back.nose!)).toBeLessThan(-0.5);
  await page.screenshot({ path: `${SHOTS}/day12-cockpit-look-back.png` });
  await tap(page, 'KeyV');
  await expect.poll(async () => (await cockpit(page)).lookBackT).toBe(0);
  // A prop plane has no HUD view: B goes back to chase.
  await tap(page, 'KeyB');
  await expect.poll(async () => (await cockpit(page)).view).toBe('chase');
});

test('B cycles chase, cockpit and HUD on a jet; G gear and F / Shift+F flap steps show on the HUD', async ({ page }) => {
  test.setTimeout(60_000);
  await solo(page, 'modern', 'f16c_b50');
  for (const v of ['cockpit', 'hud', 'chase']) {
    await tap(page, 'KeyB');
    await expect.poll(async () => (await cockpit(page)).view).toBe(v);
  }
  await tap(page, 'KeyG');
  await expect.poll(async () => (await cockpit(page)).gear).toBe(true);
  await expect.poll(async () => (await hook<{ gear?: boolean }>(page, 'player')).gear).toBe(true);
  for (const step of [1, 2, 3, 3]) {
    await tap(page, 'KeyF');
    await expect.poll(async () => (await cockpit(page)).flapStep).toBe(step);
  }
  await page.keyboard.down('ShiftLeft');
  await tap(page, 'KeyF');
  await page.keyboard.up('ShiftLeft');
  await expect.poll(async () => (await cockpit(page)).flapStep).toBe(2);
  await expect.poll(async () => (await hook<{ flapStep?: number }>(page, 'player')).flapStep).toBe(2);
  await tap(page, 'KeyG');
  await expect.poll(async () => (await cockpit(page)).gear).toBe(false);
});
