// Three browsers on localhost: one hosts, two join through the share link, and every one of them must see
// the other two flying. Uses a local PeerJS signaling server (tests/e2e/peer-server.mjs) unless testing the
// live site.
import { expect, test } from '@playwright/test';
import { flags, hostRoom, humans, joinByLink, netInfo, openPage, PHONE, relevantErrors, voteAndPick } from './netHelpers';

const SHOTS = 'tests/screenshots';

test('1 host + 2 clients: everyone sees each other move', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'WebRTC between three Chromium contexts');
  test.setTimeout(150_000);
  const errors: string[] = [];

  const host = await openPage(browser, `./?${flags()}`, 'host', errors);
  const code = await hostRoom(host, 'Hosty');
  await expect(host.locator('.lobby__qr svg')).toBeVisible();
  await expect(host.locator('.lobby__link input')).toHaveValue(new RegExp(`\\?room=${code}$`));

  // Two friends open the share link (plus the test flags), type a callsign and join; Bravo is on a phone.
  const alpha = await openPage(browser, `./?room=${code}&${flags()}`, 'Alpha', errors);
  await joinByLink(alpha, code, 'Alpha');
  const bravo = await openPage(browser, `./?room=${code}&${flags()}`, 'Bravo', errors, PHONE);
  await joinByLink(bravo, code, 'Bravo');
  const all = [host, alpha, bravo];

  for (const page of all) await expect(page.locator('.rlist li')).toHaveCount(3, { timeout: 10_000 });
  await expect(host.locator('.rlist li', { hasText: 'Bravo' })).toContainText('phone');
  await host.screenshot({ path: `${SHOTS}/multiplayer-lobby-host.png` });
  await bravo.screenshot({ path: `${SHOTS}/multiplayer-lobby-phone.png` });

  await voteAndPick(host, all, 'Early WW2', ['Gloster Gladiator', 'Fiat CR.42', 'Boeing P-26']);

  // Let snapshots flow, then sample every browser's view of the other two humans twice.
  await host.waitForTimeout(3000);
  const first = await Promise.all(all.map(humans));
  await host.waitForTimeout(2000);
  const second = await Promise.all(all.map(humans));
  for (let i = 0; i < all.length; i++) {
    const a = first[i]!;
    expect(a.length, `browser ${i} sees ${a.map((h) => h.name).join(', ')}`).toBe(2);
    for (const h of second[i]!) {
      const before = a.find((x) => x.id === h.id)!;
      const moved = Math.hypot(h.pos[0] - before.pos[0], h.pos[1] - before.pos[1], h.pos[2] - before.pos[2]);
      // Planes fly at 250+ km/h: in 2 s anyone visible covers well over 100 m.
      expect(moved, `browser ${i} sees ${h.name} move`).toBeGreaterThan(100);
    }
  }

  // Bandwidth per client stays far under the 30 KB/s budget.
  for (const page of [alpha, bravo]) {
    const n = (await netInfo(page))!;
    expect(n.phase).toBe('playing');
    expect(n.stats!.snapshotsPerS).toBeGreaterThan(15);
    expect(n.stats!.bytesInPerS).toBeLessThan(30 * 1024);
  }
  await expect(alpha.getByTestId('netstats')).toContainText('snapshots');
  await alpha.screenshot({ path: `${SHOTS}/multiplayer-client.png` });
  await bravo.screenshot({ path: `${SHOTS}/multiplayer-phone.png` });

  // The host leaves: both clients get the "Host left" results with the scores so far.
  await host.context().close();
  for (const page of [alpha, bravo]) await expect(page.locator('.results__title')).toHaveText('Host left', { timeout: 15_000 });
  await bravo.screenshot({ path: `${SHOTS}/multiplayer-host-left.png` });

  const relevant = relevantErrors(errors);
  expect(relevant, relevant.join('\n')).toEqual([]);
});
