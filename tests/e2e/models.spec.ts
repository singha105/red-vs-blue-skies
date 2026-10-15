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
  await page.getByRole('radio', { name: /Late WW2/ }).click();
  await page.getByRole('radio', { name: /F4U-4 Corsair/ }).click();
  await page.getByRole('button', { name: 'Hangar' }).click();
  await expect(page.getByRole('heading', { name: 'Vought F4U-4 Corsair' })).toBeVisible();
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
