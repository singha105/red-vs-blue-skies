// Day 8 progress against the local Firebase emulators (auth + Firestore, project demo-rvbs):
//   npm run test:profile     (starts the emulators, runs this spec with EMULATORS=1, stops them)
// Covers: RP saved after a match and still there after a reload, buying research with a confirmation, the
// offline queue syncing later, and a second device picking up the same progress after linking Google.
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

const ON = process.env['EMULATORS'] === '1';
const FS = 'http://127.0.0.1:8187';
const AUTH = 'http://127.0.0.1:9199';
const PROJECT = 'demo-rvbs';
const SHOTS = 'tests/screenshots';
// A 10-second match at 10× speed: a second of real time.
const URL = './?debug=1&emu=1&locks=1&gfx=low&matchtime=10&timescale=10';

interface ProfileHook {
  status: string;
  uid: string | null;
  anonymous: boolean | null;
  rp: number;
  unlocked: Record<string, number>;
  stats: { matches: number; kills: number };
  pending: number;
  usage: { match: { reads: number; writes: number; ruleReads: number } };
}

const hook = (page: Page): Promise<ProfileHook> => page.evaluate(() => (window as unknown as { __rvbs: { profile(): ProfileHook } }).__rvbs.profile());

async function online(page: Page): Promise<ProfileHook> {
  await expect.poll(async () => (await hook(page)).status, { timeout: 20_000 }).toBe('online');
  return hook(page);
}

async function reset(request: APIRequestContext): Promise<void> {
  await request.delete(`${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`);
  await request.delete(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`);
}

/** Admin write (rules off): give a player RP to spend. */
async function setRp(request: APIRequestContext, uid: string, rp: number): Promise<void> {
  const res = await request.patch(`${FS}/v1/projects/${PROJECT}/databases/(default)/documents/players/${uid}?updateMask.fieldPaths=rp`, {
    headers: { Authorization: 'Bearer owner' },
    data: { fields: { rp: { integerValue: String(rp) } } },
  });
  expect(res.ok()).toBe(true);
}

/** Play Solo in the era's tier-1 plane and wait for the results screen. */
async function playSolo(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Play Solo' }).click();
  await page.getByRole('radio', { name: /^WW1/ }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(page.locator('.results')).toBeVisible({ timeout: 30_000 });
}

test.describe('progress on the Firebase emulators', () => {
  test.skip(!ON, 'run with npm run test:profile (needs the auth and Firestore emulators)');
  test.beforeEach(async ({ request, page }) => {
    await reset(request);
    page.on('console', (m) => {
      if (m.type() === 'warning' || m.type() === 'error') console.log(`[page ${m.type()}] ${m.text()}`);
    });
  });

  test('RP is saved after a match and survives a reload; research unlocks tiers in order', async ({ page, request }, info) => {
    test.setTimeout(120_000);
    await page.goto(URL);
    const first = await online(page);
    expect(first.anonymous).toBe(true);
    expect(first.rp).toBe(0);
    await expect(page.getByTestId('title-profile')).toContainText('0 RP');

    await playSolo(page);
    await expect(page.getByTestId('save-state')).toHaveText('RP saved to your profile.', { timeout: 15_000 });
    const earned = Number((await page.locator('.results__rp').textContent())!.replace(/[^\d]/g, ''));
    expect(earned).toBeGreaterThanOrEqual(50);
    const after = await hook(page);
    expect(after.rp).toBe(earned);
    expect(after.stats.matches).toBe(1);
    // ?debug=1 overlay counts Firestore operations for the match: 1 match record + result + profile = 3 writes.
    expect(after.usage.match.writes).toBe(3);
    await expect(page.getByTestId('fps')).toContainText(/FS match \d+r\+\d+rr\/3w/);
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-results-saved.png` });

    // Reload with the local copy wiped: the RP comes back from Firestore.
    await page.evaluate(() => localStorage.removeItem('rvbs.profile.v1'));
    await page.reload();
    const reloaded = await online(page);
    expect(reloaded.uid).toBe(first.uid);
    expect(reloaded.rp).toBe(earned);

    // Enough RP for WW1 tier 2 (400) and 3 (600) but not 4 (800 more).
    await setRp(request, first.uid!, 1200);
    await page.reload();
    expect((await online(page)).rp).toBe(1200);
    await page.getByRole('button', { name: 'Research' }).click();
    const tree = page.getByRole('list', { name: /WW1 unlock tree/ });
    await expect(tree).toBeVisible();
    // Only the next tier can be bought; tier 3 waits for tier 2.
    await expect(tree.getByRole('button', { name: /Unlock/ })).toHaveCount(1);
    await expect(tree.locator('li').nth(2)).toContainText('after tier 2');
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-research.png` });
    await tree.getByRole('button', { name: 'Unlock · 400 RP' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Confirm unlock' });
    await expect(confirm).toContainText("You'll have 800 RP left");
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-research-confirm.png` });
    await confirm.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByTestId('rp-balance')).toHaveText('800 RP');
    await tree.getByRole('button', { name: 'Unlock · 600 RP' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByTestId('rp-balance')).toHaveText('200 RP');
    await expect(tree.getByRole('button', { name: /Unlock/ })).toHaveCount(0);
    await expect(tree.locator('li').nth(3)).toContainText('Need 800 RP');
    await page.getByRole('button', { name: 'Back' }).click();

    // After a reload the unlocks are still there, and solo plane select offers tiers 1–3 of WW1.
    await page.evaluate(() => localStorage.removeItem('rvbs.profile.v1'));
    await page.reload();
    const final = await online(page);
    expect(final.unlocked['ww1']).toBe(3);
    expect(final.rp).toBe(200);
    await page.getByRole('button', { name: 'Play Solo' }).click();
    await page.getByRole('radio', { name: /^WW1/ }).click();
    await expect(page.locator('.setup__planes .pcard:not([disabled])')).toHaveCount(3);
    await expect(page.locator('.setup__planes .pcard[disabled]').first()).toContainText('800 RP');
  });

  test('offline: the result waits on this device and syncs when Firebase is back', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop-chrome', 'one browser is enough');
    test.setTimeout(90_000);
    await page.goto(URL);
    await online(page);
    await page.route(`${FS}/**`, (r) => r.abort('internetdisconnected'));
    await playSolo(page);
    await expect(page.getByTestId('save-state')).toContainText('syncs when you', { timeout: 15_000 });
    const waiting = await hook(page);
    expect(waiting.pending).toBeGreaterThanOrEqual(50);
    expect(waiting.rp).toBe(0);
    // Back online: the browser's online event (or the 60 s retry) syncs the queue.
    await page.unroute(`${FS}/**`);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByTestId('save-state')).toHaveText('RP saved to your profile.', { timeout: 15_000 });
    const synced = await hook(page);
    expect(synced.pending).toBe(0);
    expect(synced.rp).toBe(waiting.pending);
  });

  test('a second device gets the same RP and unlocks after linking Google', async ({ browser, request }) => {
    test.skip(test.info().project.name !== 'desktop-chrome', 'popups: one browser is enough');
    test.setTimeout(120_000);
    const device = async (b: Browser): Promise<Page> => {
      const ctx = await b.newContext();
      const p = await ctx.newPage();
      await p.goto(URL);
      await online(p);
      return p;
    };
    /** Settings → Link Google account → the emulator's sign-in popup, as the same fake Google user each time. */
    const link = async (p: Page): Promise<void> => {
      await p.getByRole('button', { name: 'Settings' }).click();
      const popupP = p.waitForEvent('popup');
      await p.getByRole('button', { name: 'Link Google account' }).click();
      const popup = await popupP;
      await popup.waitForLoadState();
      const existing = popup.getByText('ace@example.com');
      if (await existing.isVisible({ timeout: 2000 }).catch(() => false)) await existing.click();
      else {
        await popup.getByRole('button', { name: /add new account/i }).click();
        await popup.locator('#email-input').fill('ace@example.com');
        await popup.locator('#display-name-input').fill('Ace');
        await popup.locator('#sign-in').click();
      }
      await expect(p.locator('.account__msg')).not.toHaveText(/Opening/, { timeout: 15_000 });
    };

    const a = await device(browser);
    const uidA = (await hook(a)).uid!;
    await setRp(request, uidA, 3000);
    await a.reload();
    await online(a);
    await a.getByRole('button', { name: 'Research' }).click();
    await a.getByRole('radio', { name: /Modern/ }).click();
    await a.getByRole('button', { name: 'Unlock · 400 RP' }).click();
    await a.getByRole('alertdialog').getByRole('button', { name: 'Unlock' }).click();
    await expect(a.getByTestId('rp-balance')).toHaveText('2,600 RP');
    await a.getByRole('button', { name: 'Back' }).click();
    await link(a);
    await expect(a.locator('.account__msg')).toContainText('Google account linked');
    await expect(a.getByTestId('account')).toContainText('Linked to Google');
    expect((await hook(a)).anonymous).toBe(false);

    // A fresh browser is a new guest with nothing; linking the same Google account switches to the saved player.
    const b = await device(browser);
    expect((await hook(b)).rp).toBe(0);
    await link(b);
    await expect(b.locator('.account__msg')).toContainText('now uses the progress saved on your Google account');
    const onB = await hook(b);
    expect(onB.uid).toBe(uidA);
    expect(onB.rp).toBe(2600);
    expect(onB.unlocked['modern']).toBe(2);
    await b.reload();
    const reloaded = await online(b);
    expect(reloaded.uid).toBe(uidA);
    expect(reloaded.rp).toBe(2600);
  });
});
