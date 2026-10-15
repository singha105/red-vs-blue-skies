// Modern-era missiles in the browser: pick a target (R on desktop, a tap on a phone), lock, fire, and defeat an
// inbound missile with flares. Runs on Desktop Chrome and the iPhone 13 (touch) project.
import { expect, test, type Page } from '@playwright/test';

const SHOTS = 'tests/screenshots';

interface MissileInfo {
  inAir: { id: number; type: string; owner: string; target: string | null }[];
  picked: string | null;
  me: { flares: number; chaff: number; missiles: number[]; lockTarget: string | null; lockProgress: number; hp: number } | null;
}

type Hooks = {
  missiles(): MissileInfo | null;
  pylonMissiles(): { total: number; mine: number };
  placeEnemyAhead(distM: number): string | null;
  launchAtPlayer(type: string, distM?: number): number | null;
};
const info = (page: Page): Promise<MissileInfo> => page.evaluate(() => (window as unknown as { __rvbs: Hooks }).__rvbs.missiles()!);

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test('Modern jets: pick a target, lock, fire, and beat an inbound missile with flares', async ({ page, isMobile }, testInfo) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await page.goto('./?debug=1');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: 'Play Solo' }).click();
  await page.getByRole('radio', { name: /Modern/ }).click();
  await page.getByRole('radio', { name: /F-15C/ }).click();
  await page.getByRole('radio', { name: 'Easy' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(page.locator('.hud')).toBeVisible();
  await expect(page.getByTestId('loadout')).toContainText('AIM-120B ×4');
  await expect(page.getByTestId('loadout')).toContainText('Flares 24');
  // The F-15C's six missiles hang on its pylons (and other jets' on theirs).
  const pylons = () => page.evaluate(() => (window as unknown as { __rvbs: Hooks }).__rvbs.pylonMissiles());
  await expect.poll(async () => (await pylons()).mine, { timeout: 10_000 }).toBe(6);
  expect((await pylons()).total).toBeGreaterThan(20);
  // Let spawn protection run out.
  await page.waitForTimeout(3500);

  // Put an enemy 2.5 km dead ahead and pick it.
  const enemy = await page.evaluate(() => (window as unknown as { __rvbs: Hooks }).__rvbs.placeEnemyAhead(2500));
  expect(enemy).not.toBeNull();
  if (isMobile) {
    // Tap the enemy's marker on the aim side of the screen.
    await page.waitForTimeout(200);
    const boxes = await page.locator('.mk--enemy').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y })));
    expect(boxes.length).toBeGreaterThan(0);
    // The marker nearest the screen centre is the one we put ahead.
    const vp = page.viewportSize()!;
    const near = boxes.sort((a, b) => Math.hypot(a.x - vp.width / 2, a.y - vp.height / 2) - Math.hypot(b.x - vp.width / 2, b.y - vp.height / 2))[0]!;
    await page.touchscreen.tap(near.x, near.y + 6);
  } else {
    await page.keyboard.press('KeyR');
  }
  await expect.poll(async () => (await info(page)).picked, { timeout: 3000 }).not.toBeNull();

  // The lock builds (the box and, on touch, the ring on the Missile button), then goes solid.
  await page.evaluate(() => (window as unknown as { __rvbs: Hooks }).__rvbs.placeEnemyAhead(2500));
  await expect(page.getByTestId('lock-box')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.mhud__lock.is-locked')).toBeVisible({ timeout: 5000 });
  if (isMobile) await expect(page.locator('.tbtn--missile.is-locked')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/${testInfo.project.name}-missile-lock.png` });

  const before = (await info(page)).me!.missiles.reduce((a, b) => a + b, 0);
  if (isMobile) await page.getByTestId('missile-btn').tap();
  else await page.keyboard.press('KeyQ');
  await expect.poll(async () => (await info(page)).me!.missiles.reduce((a, b) => a + b, 0), { timeout: 3000 }).toBe(before - 1);
  // One missile left its pylon.
  await expect.poll(async () => (await pylons()).mine, { timeout: 2000 }).toBe(5);
  await expect.poll(async () => (await info(page)).inAir.filter((m) => m.owner === 'p1').length, { timeout: 2000 }).toBeGreaterThan(0);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/${testInfo.project.name}-missile-away.png` });

  // Inbound: the launch warning shows, flares go out and pull the missile off (an AIM-9B is easy to decoy;
  // up to three tries keeps this from being flaky).
  let decoyed = false;
  for (let attempt = 0; attempt < 3 && !decoyed; attempt++) {
    const id = await page.evaluate(() => (window as unknown as { __rvbs: Hooks }).__rvbs.launchAtPlayer('aim9b', 1600));
    expect(id).not.toBeNull();
    await expect(page.getByTestId('launch-warning')).toBeVisible({ timeout: 2000 });
    await expect(page.getByTestId('launch-warning')).toContainText('flares');
    if (attempt === 0) await page.screenshot({ path: `${SHOTS}/${testInfo.project.name}-missile-warning.png` });
    const flaresBefore = (await info(page)).me!.flares;
    const flareBtn = page.getByRole('button', { name: /Flare/ });
    if (isMobile) await flareBtn.dispatchEvent('pointerdown');
    else await page.keyboard.down('KeyF');
    // Watch the missile while the flares go out: decoyed means it turned onto a flare ("d…").
    for (let t = 0; t < 12 && !decoyed; t++) {
      await page.waitForTimeout(150);
      const target = (await info(page)).inAir.find((m) => m.id === id)?.target ?? null;
      decoyed = target !== null && target.startsWith('d');
    }
    if (isMobile) await flareBtn.dispatchEvent('pointerup');
    else await page.keyboard.up('KeyF');
    const after = await info(page);
    expect(after.me!.flares).toBeLessThan(flaresBefore);
    expect(after.me!.chaff).toBeLessThan(24);
    await page.waitForTimeout(2500);
  }
  expect(decoyed).toBe(true);
  expect(errors, errors.join('\n')).toEqual([]);
});
