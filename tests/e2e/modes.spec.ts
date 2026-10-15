import { expect, test, type Page } from '@playwright/test';

// Day 9: every mode with bots on every map, the solo setup's map and mode pickers, and sound after the first tap.
const SHOTS = 'tests/screenshots';
const live = Boolean(process.env['BASE_URL']);

interface Objectives {
  mode: string;
  score: { red: number; blue: number };
  zones: { owner: string | null; progress: number }[];
  units: { kind: string; team: string; alive: boolean }[];
  drawnUnits: number;
  bombers: { id: string; alive: boolean; team: string }[];
  escort: string | null;
}

type Hooks = {
  startSolo(c: object): void;
  objectives(): Objectives | null;
  match(): { state: string; timeLeftS: number; planes: number } | null;
  sound(): { state: string; unlocked: boolean; level: number };
};
const objectives = (page: Page): Promise<Objectives | null> => page.evaluate(() => (window as unknown as { __rvbs: Hooks }).__rvbs.objectives());

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

const MAPS = ['island_chain', 'mountain_valley', 'desert_mesas', 'carrier_strike'];
// Live site: a fresh profile only has tier 1 of each era.
const PLANES: Record<string, { era: string; planeId: string }> = {
  air_domination: { era: 'ww1', planeId: live ? 'fokker_e3' : 'sopwith_camel' },
  ground_strike: { era: 'late_ww2', planeId: live ? 'p40e' : 'p47d' },
  bomber_escort: { era: 'cold_war', planeId: live ? 'mig21f13' : 'f4e' },
};

for (const mode of ['air_domination', 'ground_strike', 'bomber_escort']) {
  test(`${mode}: plays with bots on all four maps`, async ({ page }, info) => {
    // Every map on the desktop run; the phone run checks one map per mode (the HUD layout is what differs).
    const maps = info.project.name === 'desktop-chrome' ? MAPS : [MAPS[MAPS.indexOf('mountain_valley')]!];
    test.setTimeout(30_000 + maps.length * 25_000);
    const errors = watchErrors(page);
    await page.goto('./?debug=1&timescale=4');
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
    for (const map of maps) {
      await page.evaluate((c) => (window as unknown as { __rvbs: Hooks }).__rvbs.startSolo(c), { ...PLANES[mode]!, map, mode });
      await expect(page.locator('.hud')).toBeVisible();
      const o = (await objectives(page))!;
      expect(o.mode).toBe(mode);
      await expect(page.locator('.hud__label')).toHaveText(mode === 'bomber_escort' ? 'Points' : 'Tickets');
      if (mode === 'air_domination') {
        expect(o.zones).toHaveLength(3);
        await expect(page.locator('.hud__zones .zc')).toHaveCount(3);
        expect(o.score).toEqual({ red: 300, blue: 300 });
      }
      if (mode === 'ground_strike') {
        for (const team of ['red', 'blue']) expect(o.units.filter((u) => u.team === team).length, `${map} ${team}`).toBeGreaterThanOrEqual(4);
        expect(o.drawnUnits).toBe(o.units.length);
      }
      if (mode === 'bomber_escort') expect(o.bombers).toHaveLength(4);
      // 6 s at 4× speed = 24 s of play: bots get to work.
      await page.waitForTimeout(6_000);
      const later = (await objectives(page))!;
      const m = (await page.evaluate(() => (window as unknown as { __rvbs: Hooks }).__rvbs.match()))!;
      expect(m.state).toBe('playing');
      expect(m.timeLeftS).toBeLessThan(590);
      if (mode === 'bomber_escort') expect(later.bombers.some((b) => b.alive)).toBe(true);
      await page.screenshot({ path: `${SHOTS}/${info.project.name}-${mode}-${map}.png` });
    }
    expect(errors, errors.join('\n')).toEqual([]);
  });
}

test('solo setup cycles the map and mode, and the match starts there', async ({ page }) => {
  await page.goto('./?debug=1');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: 'Play Solo' }).click();
  await page.getByRole('button', { name: /^Map: Island Chain/ }).click();
  await expect(page.getByRole('button', { name: /^Map: Mountain Valley/ })).toBeVisible();
  await page.getByRole('button', { name: /^Mode: Team Deathmatch/ }).click();
  await expect(page.getByRole('button', { name: /^Mode: Air Domination/ })).toBeVisible();
  await page.getByRole('radio', { name: /^WW1/ }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(page.locator('.hud__zones .zc')).toHaveCount(3);
  expect((await objectives(page))!.mode).toBe('air_domination');
});

test('sound starts on the first tap and plays during a match', async ({ page }, info) => {
  await page.goto('./?debug=1');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const before = await page.evaluate(() => (window as unknown as { __rvbs: Hooks }).__rvbs.sound());
  expect(before.state).toBe('none'); // nothing before a gesture
  // A real tap (touch on the iPhone profile, a click on desktop) on Play Solo.
  const solo = page.getByRole('button', { name: 'Play Solo' });
  if (info.project.name.includes('iphone')) await solo.tap();
  else await solo.click();
  await expect.poll(async () => (await page.evaluate(() => (window as unknown as { __rvbs: Hooks }).__rvbs.sound())).state, { timeout: 5_000 }).toBe('running');
  await page.getByRole('button', { name: 'Start match' }).click();
  await page.keyboard.down('Space');
  // Engines and guns: something is coming out of the master bus.
  await expect.poll(async () => (await page.evaluate(() => (window as unknown as { __rvbs: Hooks }).__rvbs.sound())).level, { timeout: 8_000 }).toBeGreaterThan(0.005);
  await page.keyboard.up('Space');
});
