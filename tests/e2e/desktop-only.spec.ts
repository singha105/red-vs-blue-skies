import { devices, expect, test } from '@playwright/test';

// Day 12: the game is for laptops and desktops. Phones and tablets get a friendly screen instead of the game,
// with a "Continue anyway" escape hatch (remembered); desktop browsers never see it.
const SHOTS = 'tests/screenshots';

test('a phone sees "Please play on a laptop or desktop"', async ({ browser }) => {
  test.setTimeout(120_000); // two full boots, software rendered at the phone's pixel ratio
  const { defaultBrowserType: _ignored, ...iphone } = devices['iPhone 13 landscape'];
  const context = await browser.newContext(iphone);
  const page = await context.newPage();
  await page.goto('./');
  await expect(page.getByRole('heading', { name: /please play on a laptop or desktop/i })).toBeVisible();
  await expect(page.locator('#game')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Play Solo' })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/desktop-only-phone.png` });
  // Continue anyway starts the game, and the choice is remembered.
  await page.getByRole('button', { name: /continue anyway/i }).click();
  await expect(page.locator('.desktop-only')).toHaveCount(0);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 45_000 });
  await page.reload();
  await expect(page.getByRole('heading', { name: /please play on a laptop or desktop/i })).toHaveCount(0);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 45_000 });
  await context.close();
});

test('an iPad asking for the desktop site is still a tablet', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1180, height: 820 },
    hasTouch: true,
    isMobile: false,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 });
    Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: /please play on a laptop or desktop/i })).toBeVisible();
  await context.close();
});

test('a desktop browser goes straight to the title', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await expect(page.locator('.desktop-only')).toHaveCount(0);
});
