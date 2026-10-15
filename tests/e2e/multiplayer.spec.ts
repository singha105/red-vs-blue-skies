// Three browsers on localhost: one hosts, two join through the share link, and every one of them must see
// the other two flying. Uses a local PeerJS signaling server (tests/e2e/peer-server.mjs) so the public
// one is never involved.
import { expect, test, type Browser, type Page } from '@playwright/test';

const SHOTS = 'tests/screenshots';
const FLAGS = 'debug=1&gfx=low&signal=localhost:9187';

interface Human {
  id: string;
  name: string;
  pos: [number, number, number];
  alive: boolean;
}
interface NetInfo {
  isHost: boolean;
  code: string;
  phase: string;
  lobby: string[];
  stats: { pingMs: number | null; snapshotsPerS: number; bytesInPerS: number; bytesOutPerS: number } | null;
}
type Hooks = { __rvbs: { net(): NetInfo | null; humans(): Human[] } };

const netInfo = (page: Page): Promise<NetInfo | null> => page.evaluate(() => (window as unknown as Hooks).__rvbs.net());
const humans = (page: Page): Promise<Human[]> => page.evaluate(() => (window as unknown as Hooks).__rvbs.humans());

function watchErrors(page: Page, label: string, into: string[]): void {
  page.on('console', (m) => m.type() === 'error' && into.push(`${label}: ${m.text()}`));
  page.on('pageerror', (e) => into.push(`${label}: ${e.message}`));
}

const LAPTOP = { viewport: { width: 960, height: 540 } };
// A phone in landscape (Chromium with touch), so the phone layouts and the lobby's device column are covered.
const PHONE = { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

async function openPage(browser: Browser, url: string, label: string, errors: string[], device = LAPTOP): Promise<Page> {
  const context = await browser.newContext(device);
  const page = await context.newPage();
  watchErrors(page, label, errors);
  await page.goto(url);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  return page;
}

test('1 host + 2 clients: everyone sees each other move', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'WebRTC between three Chromium contexts');
  test.setTimeout(120_000);
  const errors: string[] = [];

  // Host: title → Host / Join → callsign → Host → setup → Create room.
  const host = await openPage(browser, `./?${FLAGS}`, 'host', errors);
  await host.getByRole('button', { name: 'Host / Join' }).click();
  await host.getByLabel('Your callsign').fill('Hosty');
  await host.getByRole('button', { name: 'Host', exact: true }).click();
  await host.getByRole('button', { name: 'Create room' }).click();
  const codeEl = host.getByTestId('room-code');
  await expect(codeEl).toHaveText(/^[A-Z]{4}$/, { timeout: 20_000 });
  const code = (await codeEl.textContent())!;
  await expect(host.locator('.lobby__qr svg')).toBeVisible();
  await expect(host.locator('.lobby__link input')).toHaveValue(new RegExp(`\\?room=${code}$`));

  // Two friends open the share link (plus the test flags), type a callsign and join.
  const clients: Page[] = [];
  for (const name of ['Alpha', 'Bravo']) {
    const page = await openPage(browser, `./?room=${code}&${FLAGS}`, name, errors, name === 'Bravo' ? PHONE : LAPTOP);
    await expect(page.locator('input[name="code"]')).toHaveValue(code);
    await page.getByLabel('Your callsign').fill(name);
    await page.getByRole('button', { name: 'Join', exact: true }).click();
    await expect(page.getByTestId('room-code')).toHaveText(code, { timeout: 30_000 });
    clients.push(page);
  }
  const all = [host, ...clients];

  // Everyone's lobby lists all three players.
  for (const page of all) await expect(page.locator('.lobby__players li')).toHaveCount(3, { timeout: 10_000 });
  await host.screenshot({ path: `${SHOTS}/multiplayer-lobby-host.png` });
  await expect(host.locator('.lobby__players li', { hasText: 'Bravo' })).toContainText('phone');
  await clients[1]!.screenshot({ path: `${SHOTS}/multiplayer-lobby-phone.png` });

  await host.getByRole('button', { name: 'Start match' }).click();
  for (const page of all) await expect(page.locator('.hud')).toBeVisible({ timeout: 15_000 });

  // Let snapshots flow, then sample every browser's view of the other two humans twice.
  await host.waitForTimeout(3000);
  const first = await Promise.all(all.map(humans));
  await host.waitForTimeout(2000);
  const second = await Promise.all(all.map(humans));
  for (let i = 0; i < all.length; i++) {
    const a = first[i]!;
    const b = second[i]!;
    expect(a.length, `browser ${i} sees ${a.map((h) => h.name).join(', ')}`).toBe(2);
    for (const h of b) {
      const before = a.find((x) => x.id === h.id)!;
      const moved = Math.hypot(h.pos[0] - before.pos[0], h.pos[1] - before.pos[1], h.pos[2] - before.pos[2]);
      // Planes fly at 300+ km/h: in 2 s anyone visible covers well over 100 m.
      expect(moved, `browser ${i} sees ${h.name} move`).toBeGreaterThan(100);
    }
  }

  // Bandwidth per client stays far under the 30 KB/s budget.
  for (const page of clients) {
    const n = (await netInfo(page))!;
    expect(n.phase).toBe('playing');
    expect(n.stats!.snapshotsPerS).toBeGreaterThan(15);
    expect(n.stats!.bytesInPerS).toBeLessThan(30 * 1024);
  }
  await expect(clients[0]!.getByTestId('netstats')).toContainText('snapshots');
  await clients[0]!.screenshot({ path: `${SHOTS}/multiplayer-client.png` });
  await clients[1]!.screenshot({ path: `${SHOTS}/multiplayer-phone.png` });

  // The host leaves: both clients get the "Host left" results with the scores so far.
  await host.context().close();
  for (const page of clients) await expect(page.locator('.results__title')).toHaveText('Host left', { timeout: 15_000 });
  await clients[1]!.screenshot({ path: `${SHOTS}/multiplayer-host-left.png` });

  const relevant = errors.filter((e) => !/WebGL|GPU stall|ERR_CONNECTION_REFUSED/i.test(e));
  expect(relevant, relevant.join('\n')).toEqual([]);
});
