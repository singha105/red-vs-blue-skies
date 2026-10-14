import { expect, test } from '@playwright/test';

// Frame-rate budget: 30 fps on a throttled "phone" at low, 60 on the laptop at high.
// Chromium only (CPU throttling needs the DevTools protocol).

async function measure(page: import('@playwright/test').Page, query: string, seconds: number): Promise<{ fps: number; calls: number; quality: string }> {
  await page.goto(`./${query}`);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: 'Play Solo' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  // Let the two teams meet so the measurement includes tracers and effects.
  await page.waitForTimeout(25_000);
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

  test('throttled phone profile at low holds 30 fps', async ({ page, context }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const r = await measure(page, '?debug=1&gfx=low', 6);
    console.log(`low, 4x CPU throttle: ${r.fps.toFixed(1)} fps, ${r.calls} draw calls`);
    expect(r.quality).toBe('low');
    expect(r.fps).toBeGreaterThanOrEqual(30);
  });
});
