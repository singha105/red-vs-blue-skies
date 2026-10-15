// The whole session loop, twice, without reloading: lobby → vote → teams → plane select → a 30 s match
// (?matchtime=30, debug only) → results → Play again → lobby. Three browsers (host laptop, laptop, phone).
// Every match must start with team BR totals within 10%.
import { expect, test } from '@playwright/test';
import { flags, hostRoom, inPhase, joinByLink, netInfo, openPage, PHONE, relevantErrors, teamBr, voteAndPick } from './netHelpers';

const SHOTS = 'tests/screenshots';

test('full loop twice: vote → play 30 s → results → lobby', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'WebRTC between three Chromium contexts');
  test.setTimeout(300_000);
  const errors: string[] = [];

  const host = await openPage(browser, `./?${flags('&matchtime=30')}`, 'host', errors);
  const code = await hostRoom(host, 'Hosty');
  const alpha = await openPage(browser, `./?room=${code}&${flags()}`, 'Alpha', errors);
  await joinByLink(alpha, code, 'Alpha');
  const bravo = await openPage(browser, `./?room=${code}&${flags()}`, 'Bravo', errors, PHONE);
  await joinByLink(bravo, code, 'Bravo');
  const all = [host, alpha, bravo];
  for (const page of all) await expect(page.locator('.rlist li')).toHaveCount(3, { timeout: 10_000 });

  // Lobby: Bravo readies up and parties with Alpha; quick chat reaches everyone.
  await bravo.getByRole('button', { name: "I'm ready" }).click();
  await bravo.locator('.rlist li', { hasText: 'Alpha' }).getByRole('button', { name: 'Party up' }).click();
  await alpha.getByRole('button', { name: 'Nice shot' }).click();
  for (const page of all) await expect(page.locator('.chat__lines')).toContainText('Nice shot');
  await expect(host.getByRole('button', { name: /^Start vote \(1\/2 ready\)/ })).toBeVisible();
  await bravo.screenshot({ path: `${SHOTS}/loop-lobby-phone.png` });

  const rounds = [
    { era: 'Late WW2', planes: ['Spitfire Mk XIV', 'P-40E Warhawk', 'P-39Q Airacobra'] },
    { era: 'WW1', planes: ['Fokker E.III', 'Fokker D.VII', 'Sopwith Camel'] },
  ];
  for (const [r, round] of rounds.entries()) {
    await voteAndPick(host, all, round.era, round.planes, async (phase) => {
      if (r > 0) return;
      await bravo.screenshot({ path: `${SHOTS}/loop-${phase}-phone.png` });
      if (phase === 'select') await host.screenshot({ path: `${SHOTS}/loop-select-host.png` });
    });

    // Parties stay together; the match starts with both teams' BR within 10% (bots even it out).
    const room = (await netInfo(host))!.room!;
    const team = (name: string) => room.players.find((p) => p.name === name)!.team;
    expect(team('Alpha')).toBe(team('Bravo'));
    const br = (await teamBr(host))!;
    const gap = Math.abs(br.blue - br.red) / Math.max(br.blue, br.red);
    expect(gap, `round ${r + 1}: blue ${br.blue.toFixed(1)} vs red ${br.red.toFixed(1)}`).toBeLessThanOrEqual(0.1);
    // Every page flies the plane it picked.
    for (let i = 0; i < all.length; i++) {
      const me = await all[i]!.evaluate(() => (window as unknown as { __rvbs: { player(): { planeId: string } | null } }).__rvbs.player());
      expect(me?.planeId).toBeTruthy();
    }
    if (r === 0) await bravo.screenshot({ path: `${SHOTS}/loop-match-phone.png` });

    // 30 s match, then the results inside the room, with awards and RP.
    for (const page of all) await inPhase(page, 'results', 60_000);
    for (const page of all) {
      // Both scoreboards list all 10 pilots, with an RP column and your own RP earned.
      await expect(page.locator('.results__table--blue tbody tr')).toHaveCount(10);
      await expect(page.locator('.results__table--red tbody tr')).toHaveCount(10);
      await expect(page.locator('.results__table th', { hasText: 'RP' }).first()).toBeAttached();
      await expect(page.locator('.results__rp')).toContainText('RP');
    }
    await host.screenshot({ path: `${SHOTS}/loop-results-host-${r + 1}.png` });
    await bravo.screenshot({ path: `${SHOTS}/loop-results-phone-${r + 1}.png` });

    // Alpha is ready for more; the host's Play again takes everyone back to the lobby on the same connection.
    await alpha.getByRole('button', { name: 'Play again' }).click();
    await expect(alpha.getByText('Waiting for the host')).toBeVisible();
    await host.getByRole('button', { name: /^Play again/ }).click();
    for (const page of all) await inPhase(page, 'lobby');
    expect((await netInfo(host))!.room!.round).toBe(r + 2);
  }

  const relevant = relevantErrors(errors);
  expect(relevant, relevant.join('\n')).toEqual([]);
});
