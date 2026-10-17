import { expect, test } from '@playwright/test';

// Frame-rate budget (Day 12, desktop only): 30 fps at low on an "older laptop" (4× CPU throttle, 1366 × 768), 60 at
// high on this Mac.
// Chromium only (CPU throttling needs the DevTools protocol).

async function measure(
  page: import('@playwright/test').Page,
  query: string,
  seconds: number,
  solo?: object,
  before?: () => Promise<void>,
): Promise<{ fps: number; calls: number; quality: string }> {
  await page.goto(`./${query}`);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: 'Play Solo' }).click();
  if (solo) await page.evaluate((c) => (window as unknown as { __rvbs: { startSolo(c: object): void } }).__rvbs.startSolo(c), solo);
  else await page.getByRole('button', { name: 'Start match' }).click();
  // Let the two teams meet so the measurement includes tracers and effects.
  await page.waitForTimeout(25_000);
  await before?.();
  return page.evaluate(async (s) => {
    const frames: number[] = [];
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      const tick = (now: number): void => {
        frames.push(now);
        if (now - t0 < s * 1000) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    const hooks = (window as unknown as { __rvbs: { drawCalls(): number; quality(): string } }).__rvbs;
    return { fps: (frames.length - 1) / ((frames[frames.length - 1]! - frames[0]!) / 1000), calls: hooks.drawCalls(), quality: hooks.quality() };
  }, seconds);
}

test.describe('fps budget', () => {
  test.describe.configure({ timeout: 90_000 });

  test('laptop at high holds about 60 fps', async ({ page }) => {
    const r = await measure(page, '?debug=1&gfx=high', 5);
    console.log(`high: ${r.fps.toFixed(1)} fps, ${r.calls} draw calls`);
    expect(r.quality).toBe('high');
    expect(r.fps).toBeGreaterThanOrEqual(55);
    expect(r.calls).toBeLessThan(150);
  });

  test('older laptop profile (4x CPU) at low holds 30 fps', async ({ page, context }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const r = await measure(page, '?debug=1&gfx=low', 6);
    console.log(`low, 4x CPU throttle: ${r.fps.toFixed(1)} fps, ${r.calls} draw calls`);
    expect(r.quality).toBe('low');
    expect(r.fps).toBeGreaterThanOrEqual(30);
  });

  // Day 9's heaviest scene: canyon terrain, 28 ground targets with AA, rockets and bombs, burning wrecks.
  test('older laptop profile (4x CPU) at low holds 30 fps in Ground Strike over Mountain Valley', async ({ page, context }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const r = await measure(page, '?debug=1&gfx=low', 6, { era: 'late_ww2', planeId: 'p47d', map: 'mountain_valley', mode: 'ground_strike' });
    console.log(`low, 4x CPU throttle, Ground Strike: ${r.fps.toFixed(1)} fps, ${r.calls} draw calls`);
    expect(r.quality).toBe('low');
    expect(r.fps).toBeGreaterThanOrEqual(30);
  });

  // Day 11's heaviest view: low over Mountain Valley's forest on High (3D trees, impostors, textured terrain).
  test('laptop at high holds about 60 fps low over the Mountain Valley forest', async ({ page }) => {
    const r = await measure(page, '?debug=1&gfx=high', 4, { era: 'modern', planeId: 'f15c', map: 'mountain_valley', mode: 'tdm' }, async () => {
      await page.evaluate(() => (window as unknown as { __rvbs: { placePlayer(x: number, z: number, a: number, h: number): boolean } }).__rvbs.placePlayer(-1800, 700, 160, 70));
      await page.waitForTimeout(1500);
    });
    const forest = await page.evaluate(() => (window as unknown as { __rvbs: { forest(): { trees: number; near: number } } }).__rvbs.forest());
    console.log(`high, low over the forest: ${r.fps.toFixed(1)} fps, ${r.calls} draw calls, ${forest.trees} trees (${forest.near} in 3D)`);
    expect(r.fps).toBeGreaterThanOrEqual(55);
    expect(r.calls).toBeLessThan(150);
  });

  test('laptop at high holds about 60 fps in Bomber Escort with jets', async ({ page }) => {
    const r = await measure(page, '?debug=1&gfx=high', 5, { era: 'modern', planeId: 'f15c', map: 'desert_mesas', mode: 'bomber_escort' });
    console.log(`high, Bomber Escort: ${r.fps.toFixed(1)} fps, ${r.calls} draw calls`);
    expect(r.fps).toBeGreaterThanOrEqual(55);
    expect(r.calls).toBeLessThan(150);
  });
});

// Day 11: three's WebGPURenderer (with its WebGL 2 fallback) against the WebGLRenderer the game uses, on the same
// benchmark scene. The numbers go into docs/PROGRESS.md; the game keeps WebGL unless WebGPU is clearly faster.
test('WebGPURenderer probe vs WebGLRenderer', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('./?debug=1&webgpuprobe=1');
  const r = await page.waitForFunction(() => (window as unknown as { __webgpuProbe?: unknown }).__webgpuProbe, null, { timeout: 60_000 }).then((h) => h.jsonValue());
  console.log(`webgpu probe: ${JSON.stringify(r)}`);
  expect((r as { webglFps: number }).webglFps).toBeGreaterThan(10);
});
