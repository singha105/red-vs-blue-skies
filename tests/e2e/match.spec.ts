import { expect, test, type Page } from '@playwright/test';

const SHOTS = 'tests/screenshots';

interface MatchInfo {
  state: string;
  score: { red: number; blue: number };
  timeLeftS: number;
  planes: number;
  bullets: number;
}

const matchInfo = (page: Page): Promise<MatchInfo | null> =>
  page.evaluate(() => (window as unknown as { __rvbs: { match(): MatchInfo | null } }).__rvbs.match());

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test('solo match: setup, 20 seconds of 10 v 10 with no errors', async ({ page }, info) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  await page.goto('./?debug=1');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: 'Play Solo' }).click();

  // Setup screen: eras, planes, difficulty.
  await expect(page.getByRole('radiogroup', { name: 'Era' })).toBeVisible();
  await page.getByRole('radio', { name: /Late WW2/ }).click();
  await page.getByRole('radio', { name: /P-51D Mustang/ }).click();
  await page.getByRole('radio', { name: 'Easy' }).click();
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-setup.png` });
  await page.getByRole('button', { name: 'Start match' }).click();

  await expect(page.locator('.hud')).toBeVisible();
  const start = (await matchInfo(page))!;
  expect(start.planes).toBe(20);
  expect(start.state).toBe('playing');

  await page.waitForTimeout(20_000);
  const later = (await matchInfo(page))!;
  expect(later.timeLeftS).toBeLessThan(start.timeLeftS - 15);
  expect(later.state).toBe('playing');
  await expect(page.locator('.hud__top')).toContainText(/\d+:\d\d/);

  // Scoreboard opens from its button (works on touch and desktop).
  await page.getByRole('button', { name: 'Scoreboard' }).click();
  await expect(page.locator('.hud__board tbody tr')).toHaveCount(20);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-scoreboard.png` });
  await page.getByRole('button', { name: 'Scoreboard' }).click();
  await expect(page.locator('.hud__board')).toBeHidden();

  await page.screenshot({ path: `${SHOTS}/${info.project.name}-match.png` });
  expect(errors, errors.join('\n')).toEqual([]);
});

// The full 10-minute match, run at 10× game speed (?timescale=10, debug only) so it takes a minute.
// FULL_MATCH=1 npx playwright test match.spec
test('a full 10-minute Team Deathmatch reaches the results screen', async ({ page }, info) => {
  test.skip(!process.env['FULL_MATCH'], 'set FULL_MATCH=1 to run the full match');
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  await page.goto('./?debug=1&timescale=10');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: 'Play Solo' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(page.locator('.hud')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Match results' })).toBeVisible({ timeout: 200_000 });
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(/Victory|Draw|team wins/);
  await expect(page.locator('.results__table tbody tr')).toHaveCount(20);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-results.png` });
  expect(errors, errors.join('\n')).toEqual([]);
  // Play again starts a fresh match.
  await page.getByRole('button', { name: 'Play again' }).click();
  await expect(page.locator('.hud')).toBeVisible();
});
