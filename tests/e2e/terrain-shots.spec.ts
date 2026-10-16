import { expect, test } from '@playwright/test';

// Mountain Valley from the blue spawn (looking west down the valley) on Low and High graphics, HUD hidden, for
// the Day 11 before/after comparison. SHOT_TAG names the files: run once against the old live site
// (SHOT_TAG=before BASE_URL=https://singha105.github.io/red-vs-blue-skies/) and once on the new build.
// The spawn view is the same in both versions, so the pictures line up.
const SHOTS = 'tests/screenshots';
const TAG = process.env['SHOT_TAG'] ?? 'after';

for (const gfx of (process.env['SHOT_GFX'] ?? 'low,high').split(',') as ('low' | 'medium' | 'high')[]) {
  test(`Mountain Valley on ${gfx}`, async ({ page, isMobile }) => {
    test.skip(isMobile, 'one viewport is enough');
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`./?debug=1&gfx=${gfx}`);
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    await page.evaluate(() => (window as unknown as { __rvbs: { startSolo(c: object): void } }).__rvbs.startSolo({ era: 'modern', planeId: 'f15c', map: 'mountain_valley', mode: 'tdm' }));
    await page.addStyleTag({ content: '.hud, .touch, .fps, .mmenu { display: none !important; }' });
    // Long enough for textures and trees to stream in (the plane flies on about a kilometre meanwhile).
    await page.waitForTimeout(gfx === 'high' ? 5000 : 3000);
    await page.screenshot({ path: `${SHOTS}/mountain-valley-${TAG}-${gfx}.png` });
  });
}

// Low over the forested canyon wall (near 3D trees, forest floor, rock), High only.
test('Mountain Valley low over the forest on high', async ({ page, isMobile }) => {
  test.skip(isMobile || process.env['SHOT_TAG'] === 'before', 'new build, desktop');
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('./?debug=1&gfx=high');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  type H = { __rvbs: { startSolo(c: object): Promise<void>; placePlayer(x: number, z: number, agl: number, h: number): boolean } };
  await page.evaluate(() => (window as unknown as H).__rvbs.startSolo({ era: 'modern', planeId: 'f15c', map: 'mountain_valley', mode: 'tdm' }));
  await page.addStyleTag({ content: '.hud, .touch, .fps, .mmenu { display: none !important; }' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => (window as unknown as H).__rvbs.placePlayer(-1800, 700, 140, 70));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/mountain-valley-${TAG}-high-low-level.png` });
});
