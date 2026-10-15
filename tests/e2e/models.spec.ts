import { expect, test, type Page } from '@playwright/test';

const SHOTS = 'tests/screenshots';

const hangar = (page: Page) =>
  page.evaluate(() => (window as unknown as { __rvbs: { hangar(): { planeId: string; placeholder: boolean; yaw: number } | null } }).__rvbs.hangar());

test('hangar shows the real model and turns it by dragging', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./?debug=1');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: 'Play Solo' }).click();
  // Live site: tier 1 only (a fresh player), so the MiG-21; locally ?debug=1 opens the Corsair.
  const live = Boolean(process.env['BASE_URL']);
  await page.getByRole('radio', { name: live ? /Cold War/ : /Late WW2/ }).click();
  await page.getByRole('radio', { name: live ? /MiG-21F-13/ : /F4U-4 Corsair/ }).click();
  await page.getByRole('button', { name: 'Hangar' }).click();
  await expect(page.getByRole('heading', { name: live ? 'Mikoyan-Gurevich MiG-21F-13' : 'Vought F4U-4 Corsair' })).toBeVisible();
  await expect.poll(async () => (await hangar(page))?.placeholder, { timeout: 10_000 }).toBe(false);

  const drag = page.getByTestId('hangar-drag');
  const box = (await drag.boundingBox())!;
  const before = (await hangar(page))!.yaw;
  const ev = { pointerId: 3, pointerType: info.project.name.includes('iphone') ? 'touch' : 'mouse', isPrimary: true, bubbles: true };
  const x = box.x + box.width * 0.7;
  const y = box.y + box.height * 0.5;
  await drag.dispatchEvent('pointerdown', { ...ev, clientX: x, clientY: y });
  for (let i = 1; i <= 8; i++) await drag.dispatchEvent('pointermove', { ...ev, clientX: x - i * 20, clientY: y });
  await drag.dispatchEvent('pointerup', { ...ev, clientX: x - 160, clientY: y });
  const after = (await hangar(page))!.yaw;
  expect(Math.abs(after - before)).toBeGreaterThan(1);

  await page.getByRole('radio', { name: 'Red' }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-hangar.png` });
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('button', { name: 'Start match' })).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a WW1 match flies the Camel and Dr.I models with props and muzzles', async ({ page }, info) => {
  await page.goto('./?debug=1');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(() => (window as unknown as { __rvbs: { startSolo(c: object): void } }).__rvbs.startSolo({ era: 'ww1', planeId: 'fokker_dr1' }));
  type V = { placeholder: boolean; muzzles: number; prop: boolean };
  await expect
    .poll(async () => (await page.evaluate(() => (window as unknown as { __rvbs: { models(): V[] } }).__rvbs.models())).filter((m) => !m.placeholder).length, { timeout: 10_000 })
    .toBeGreaterThan(0);
  const models = await page.evaluate(() => (window as unknown as { __rvbs: { models(): V[] } }).__rvbs.models());
  for (const m of models.filter((x) => !x.placeholder)) {
    expect(m.prop).toBe(true);
    expect(m.muzzles).toBeGreaterThanOrEqual(2);
  }
  await page.keyboard.down('Space');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-ww1-models.png` });
  await page.keyboard.up('Space');
});

test('every one of the 60 planes opens its real model in the hangar', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome' || Boolean(process.env['BASE_URL']), 'all planes need ?debug=1 on localhost; one viewport is enough');
  test.setTimeout(180_000);
  await page.goto('./?debug=1');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: 'Play Solo' }).click();
  const eras = ['WW1', 'Early WW2', 'Late WW2', 'Early Jets', 'Cold War', 'Modern'];
  let seen = 0;
  for (const era of eras) {
    await page.getByRole('radio', { name: new RegExp(`^${era}`) }).click();
    const planes = page.locator('[role="radiogroup"][aria-label="Plane"] [role="radio"]');
    const n = await planes.count();
    expect(n, era).toBe(10);
    for (let i = 0; i < n; i++) {
      await page.locator('[role="radiogroup"][aria-label="Plane"] [role="radio"]').nth(i).click();
      await page.getByRole('button', { name: 'Hangar' }).click();
      await expect.poll(async () => (await hangar(page))?.placeholder, { timeout: 10_000 }).toBe(false);
      seen++;
      await page.getByRole('button', { name: 'Back' }).click();
    }
  }
  expect(seen).toBe(60);
});
