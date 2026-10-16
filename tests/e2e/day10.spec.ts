import { expect, test, type Page } from '@playwright/test';

// Day 10: the error overlay, the first-launch tutorial, and the accessibility and battery settings.
const SHOTS = 'tests/screenshots';
const LIVE = Boolean(process.env['BASE_URL']);

type Hooks = Record<string, (...a: unknown[]) => unknown>;
const hook = <T>(page: Page, name: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([n, a]) => (window as unknown as { __rvbs: Hooks }).__rvbs[n as string]!(...(a as unknown[])) as T, [name, args] as const);

async function ready(page: Page, query = ''): Promise<void> {
  await page.goto(`./?debug=1${query}`);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
}

test('an uncaught error shows the friendly card with Copy error', async ({ page, context, browserName }) => {
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await ready(page);
  await page.evaluate(() => window.setTimeout(() => {
    throw new Error('Test explosion');
  }));
  const card = page.getByRole('alertdialog', { name: 'Something went wrong' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Test explosion');
  // A second error only bumps the count.
  await page.evaluate(() => void Promise.reject(new Error('Second one')));
  await expect(card.locator('[data-k="count"]')).toHaveText('2 errors so far.');
  await expect(page.locator('.crash')).toHaveCount(1);
  await card.getByRole('button', { name: 'Copy error' }).click();
  await expect(card.getByRole('button', { name: /^Cop(ied|y failed)/ })).toBeVisible();
  if (browserName === 'chromium') {
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toContain('Red vs Blue Skies v');
    expect(text).toContain('Test explosion');
    expect(text).toContain('Screen: title');
  }
  await card.getByRole('button', { name: 'Keep playing' }).click();
  await expect(card).toBeHidden();
  await expect(page.getByRole('button', { name: 'Play Solo' })).toBeVisible();
});

test('tutorial: offered on first launch, four steps, skippable, replayable from Settings', async ({ page }, info) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ready(page, '&tutorial=1');
  const offer = page.getByRole('dialog', { name: 'Tutorial' });
  await expect(offer).toBeVisible();
  await offer.getByTestId('tutorial-start').click();
  const panel = page.locator('.tut');
  await expect(panel).toContainText('Fly through the rings');
  await expect(panel.getByTestId('tutorial-step')).toContainText('Step 1 of 4');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-tutorial-rings.png` });
  // The rings are in front of the plane.
  const t = await hook<{ rings: number[][] }>(page, 'tutorial');
  expect(t.rings).toHaveLength(4);

  await hook(page, 'tutorialNext');
  await expect(panel).toContainText('Shoot the balloons');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-tutorial-balloons.png` });
  await hook(page, 'tutorialNext');
  await expect(panel).toContainText('Fire a missile at the drone');
  // Locking the drone builds up on its own with it ahead of the nose.
  await expect.poll(async () => (await hook<{ me: { lockProgress: number } | null }>(page, 'missiles')).me?.lockProgress ?? 0, { timeout: 10_000 }).toBeGreaterThan(0.5);
  await hook(page, 'tutorialNext');
  await expect(panel).toContainText('Beat a missile with flares');
  // The enemy launches about 3 s in, and the warning shows.
  await expect(page.locator('.mhud__launch')).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-tutorial-flares.png` });

  // Skip: back to the title, and it isn't offered again.
  await panel.getByTestId('tutorial-skip').click();
  await expect(page.getByRole('button', { name: 'Play Solo' })).toBeVisible();
  await expect(page.locator('.title__note')).toContainText('Tutorial skipped');
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('dialog', { name: 'Tutorial' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Play the tutorial again' }).click();
  await expect(panel).toContainText('Fly through the rings');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('settings: colour-blind team colours, HUD size, 30 fps cap', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.locator('select[data-k="teamColours"]').selectOption('colourblind');
  await expect(page.locator('html')).toHaveAttribute('data-teams', 'colourblind');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--red').trim())).toBe('#e8890c');
  await dialog.locator('input[data-k="hudScale"]').fill('1.4');
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--hud-scale'))).toBe('1.4');
  await dialog.locator('select[data-k="cap30"]').selectOption('1');
  await dialog.getByRole('button', { name: 'Done' }).click();
  // Settings survive a reload.
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-teams', 'colourblind');
  await page.getByRole('button', { name: 'Play Solo' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(page.locator('.hud')).toBeVisible();
  // The HUD panels are scaled, and the game draws at most ~30 frames a second.
  expect(await page.locator('.hud__readout').evaluate((el) => getComputedStyle(el).scale)).toBe('1.4');
  await page.waitForTimeout(4000);
  expect(await hook<number>(page, 'fps')).toBeLessThan(36);
});

test('settings: invert pitch flips a touch drag', async ({ page, isMobile }) => {
  test.skip(!isMobile || LIVE, 'touch drag; the plane needs every unlock');
  await ready(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('select[data-k="invertPitch"]').selectOption('1');
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Play Solo' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  const pad = page.getByTestId('aim-pad');
  await expect(pad).toBeVisible();
  const before = await hook<{ pitch: number }>(page, 'aim');
  const box = (await pad.boundingBox())!;
  const x0 = box.x + box.width * 0.5;
  const y0 = box.y + box.height * 0.5;
  const ev = { pointerId: 9, pointerType: 'touch', isPrimary: true, bubbles: true };
  await pad.dispatchEvent('pointerdown', { ...ev, clientX: x0, clientY: y0 });
  for (let i = 1; i <= 10; i++) await pad.dispatchEvent('pointermove', { ...ev, clientX: x0, clientY: y0 - i * 6 });
  await pad.dispatchEvent('pointerup', { ...ev, clientX: x0, clientY: y0 - 60 });
  const after = await hook<{ pitch: number }>(page, 'aim');
  expect(after.pitch).toBeLessThan(before.pitch - 0.1); // dragged up → nose down when inverted
});
