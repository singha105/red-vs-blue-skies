import { expect, test, type Page } from '@playwright/test';

const SHOTS = 'tests/screenshots';

interface Hooks {
  mode(): string;
  aim(): { yaw: number; pitch: number };
  player(): { alive: boolean; pos: number[]; vel: number[]; throttle: number; stalled: boolean; planeId: string } | null;
  fps(): number;
  quality(): string;
  drawCalls(): number;
}

function hooks(page: Page): { get<K extends keyof Hooks>(k: K): Promise<ReturnType<Hooks[K]>> } {
  return {
    get: <K extends keyof Hooks>(k: K) =>
      page.evaluate((key) => (window as unknown as { __rvbs: Record<string, () => unknown> }).__rvbs[key]!(), k) as Promise<ReturnType<Hooks[K]>>,
  };
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function startSolo(page: Page, query = '?debug=1'): Promise<void> {
  await page.goto(`./${query}`);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: 'Play Solo' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(page.locator('.hud')).toBeVisible();
  expect(await hooks(page).get('mode')).toBe('match');
}

test('spawns in the air and flies with the keyboard', async ({ page, isMobile }, info) => {
  test.skip(isMobile, 'desktop keyboard');
  const errors = watchErrors(page);
  await startSolo(page);
  const h = hooks(page);
  const start = (await h.get('player'))!;
  expect(start.alive).toBe(true);
  expect(start.pos[1]).toBeGreaterThan(1000);

  await page.keyboard.down('KeyW');
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(2000);
  await page.keyboard.up('ArrowUp');
  await page.keyboard.up('KeyW');
  const after = (await h.get('player'))!;
  expect(after.pos[1]!).toBeGreaterThan(start.pos[1]! + 30); // climbed
  expect(after.throttle).toBeGreaterThan(0.95);
  await expect(page.locator('.hud__value').first()).not.toHaveText('0');
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-flight.png` });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('diving into the sea crashes and respawns', async ({ page, isMobile }, info) => {
  test.skip(isMobile, 'desktop keyboard');
  await startSolo(page);
  const h = hooks(page);
  await page.keyboard.down('ArrowDown');
  await expect.poll(async () => (await h.get('player'))?.alive, { timeout: 20_000, intervals: [200] }).toBe(false);
  await page.keyboard.up('ArrowDown');
  // Killcam / respawn screen: crashed on our own, or a bot got us on the way down.
  await expect(page.locator('.hud__death')).toContainText(/You crashed|Shot down by/);
  // The respawn picker: no spawn points yet, so only the free tier-1 reserve can be picked.
  const picker = page.getByRole('group', { name: 'Next plane' });
  await expect(picker).toBeVisible();
  await expect(picker).toContainText('0 SP');
  await expect(picker.locator('.rcard:not([disabled])')).toHaveCount(1);
  await expect(picker.locator('.rcard[aria-pressed="true"]')).toContainText('Free');
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-respawn.png` });
  await expect.poll(async () => (await h.get('player'))?.alive, { timeout: 9000 }).toBe(true);
  const back = (await h.get('player'))!;
  expect(back.pos[1]).toBeGreaterThan(1000);
  expect(back.planeId).toBe('p26');
  await expect(picker).toBeHidden();
});

test('touch: dragging on the right half moves the aim point', async ({ page, isMobile }, info) => {
  test.skip(!isMobile, 'phones only');
  const errors = watchErrors(page);
  await startSolo(page);
  const h = hooks(page);
  const pad = page.getByTestId('aim-pad');
  await expect(pad).toBeVisible();
  await expect(page.getByRole('button', { name: 'FIRE' })).toBeVisible();

  const before = await h.get('aim');
  const box = (await pad.boundingBox())!;
  const x0 = box.x + box.width * 0.5;
  const y0 = box.y + box.height * 0.5;
  const ev = { pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true };
  await pad.dispatchEvent('pointerdown', { ...ev, clientX: x0, clientY: y0 });
  for (let i = 1; i <= 10; i++) {
    await pad.dispatchEvent('pointermove', { ...ev, clientX: x0 + i * 12, clientY: y0 - i * 4 });
  }
  await pad.dispatchEvent('pointerup', { ...ev, clientX: x0 + 120, clientY: y0 - 40 });
  const after = await h.get('aim');
  expect(after.yaw).toBeGreaterThan(before.yaw + 0.3); // dragged right → aim right
  expect(after.pitch).toBeGreaterThan(before.pitch + 0.1); // dragged up → aim up

  // Throttle slider: touching near the top sets high throttle.
  const slider = page.getByRole('slider', { name: 'Throttle' });
  const sb = (await slider.boundingBox())!;
  const tv = { pointerId: 8, pointerType: 'touch', isPrimary: false, bubbles: true };
  // (The top 12% is the WEP band, so touch just below it.)
  await slider.dispatchEvent('pointerdown', { ...tv, clientX: sb.x + sb.width / 2, clientY: sb.y + sb.height * 0.18 });
  await slider.dispatchEvent('pointerup', { ...tv, clientX: sb.x + sb.width / 2, clientY: sb.y + sb.height * 0.18 });
  await expect(slider).toHaveAttribute('aria-valuenow', /^(9[0-9]|100)$/);

  // Touch targets are thumb-sized.
  for (const sel of ['.tbtn--fire', '[data-testid="missile-btn"]', '[data-testid="cm-btn"]', '[data-tap="level"]', '[data-testid="look-btn"]', '[data-zoom]']) {
    const b = await page.locator(sel).boundingBox();
    expect(b!.height, sel).toBeGreaterThanOrEqual(56);
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-flight.png` });
  expect(errors, errors.join('\n')).toEqual([]);
});
