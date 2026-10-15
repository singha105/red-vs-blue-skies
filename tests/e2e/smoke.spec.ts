import { expect, test, type Page } from '@playwright/test';

const SHOTS = 'tests/screenshots';

/** Collects console errors and uncaught exceptions for the whole test. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

/** True once the WebGL canvas has drawn something that isn't a single flat colour. */
async function canvasHasPixels(page: Page): Promise<boolean> {
  // Read inside a rAF callback queued after the game's own, before the drawing buffer is presented and cleared.
  return page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const canvas = document.querySelector<HTMLCanvasElement>('#game');
    if (!canvas || canvas.width === 0 || canvas.height === 0) return false;
    const probe = document.createElement('canvas');
    probe.width = 32;
    probe.height = 32;
    const ctx = probe.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(canvas, 0, 0, 32, 32);
    const px = ctx.getImageData(0, 0, 32, 32).data;
    const colours = new Set<string>();
    for (let i = 0; i < px.length; i += 4) colours.add(`${px[i]! >> 3},${px[i + 1]! >> 3},${px[i + 2]! >> 3}`);
    return colours.size > 8;
  });
}

test('title screen and test scene load without errors', async ({ page }, info) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');

  await expect(page.getByRole('heading', { name: /red\s+vs\s+blue\s+skies/i })).toBeVisible();
  const solo = page.getByRole('button', { name: 'Play Solo' });
  const host = page.getByRole('button', { name: 'Host / Join' });
  await expect(solo).toBeVisible();
  await expect(host).toBeVisible();

  // Thumb-sized buttons.
  for (const button of [solo, host]) {
    const box = await button.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(56);
  }

  // Rotate prompt stays hidden in landscape / on desktop.
  await expect(page.locator('#rotate')).toBeHidden();

  // Canvas fills the window and is drawing the scene.
  const size = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('#game')!;
    const r = c.getBoundingClientRect();
    return { w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight, dpr: c.width / r.width };
  });
  expect(size.w).toBe(size.vw);
  expect(size.h).toBe(size.vh);
  expect(size.dpr).toBeLessThanOrEqual(2);
  await expect.poll(() => canvasHasPixels(page), { timeout: 10_000 }).toBe(true);

  // No FPS counter without ?debug=1.
  await expect(page.locator('[data-testid="fps"]')).toHaveCount(0);

  // Host / Join opens the multiplayer menu (thumb-sized buttons there too), and Back returns.
  await host.click();
  await expect(page.getByRole('heading', { name: 'Play with friends' })).toBeVisible();
  for (const name of ['Host', 'Join']) {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(56);
  }
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-netmenu.png` });
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(solo).toBeVisible();

  await page.waitForTimeout(1500); // let the plane move into a nice spot
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-title.png` });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('debug flag shows the FPS counter', async ({ page }, info) => {
  const errors = watchErrors(page);
  await page.goto('./?debug=1');
  await expect(page.locator('[data-testid="fps"]')).toContainText(/\d+ fps/, { timeout: 5000 });
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-debug.png` });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('PWA manifest, icons and service worker are served', async ({ page, request }) => {
  await page.goto('./');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifest = await (await request.get(new URL(href!, page.url()).toString())).json();
  expect(manifest.display).toBe('fullscreen');
  expect(manifest.orientation).toBe('landscape');
  for (const icon of manifest.icons as { src: string }[]) {
    const res = await request.get(new URL(icon.src, page.url()).toString());
    expect(res.status(), icon.src).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
  }
  const sw = await request.get(new URL('sw.js', page.url()).toString());
  expect(sw.status()).toBe(200);
  await expect
    .poll(() => page.evaluate(async () => Boolean(await navigator.serviceWorker?.getRegistration())), { timeout: 10_000 })
    .toBe(true);
});

test.describe('portrait phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'phones only');
  test.use({ viewport: { width: 390, height: 664 } });

  test('asks the player to rotate', async ({ page }, info) => {
    const errors = watchErrors(page);
    await page.goto('./');
    await expect(page.locator('#rotate')).toBeVisible();
    await expect(page.getByText('Turn your phone sideways to fly.')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-portrait.png` });
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
