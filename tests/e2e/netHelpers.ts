// Shared steps for the multiplayer browser tests: open a browser context, host, join, play a round.
import { expect, type Browser, type Page } from '@playwright/test';

// Against the live site (BASE_URL), or with PUBLIC_SIGNAL=1, use PeerJS's public signaling server exactly
// like real players: an https page can't reach the local http one.
export const PUBLIC = Boolean(process.env['PUBLIC_SIGNAL'] || process.env['BASE_URL']);
/** The live site has no "all unlocked" (that's localhost-only), and tests never sign in, so a fresh player
 * can only fly each era's tier-1 plane there. */
export const LIVE = Boolean(process.env['BASE_URL']);
export const TIER1: Record<string, string> = {
  WW1: 'Fokker E.III',
  'Early WW2': 'Boeing P-26',
  'Late WW2': 'P-40E Warhawk',
  'Early Jets': 'P-80 Shooting Star',
  'Cold War': 'MiG-21F-13',
  Modern: 'MiG-29A',
};
// renderscale: three software-rendered pages share one browser; a quarter of the pixels keeps them all moving.
export const flags = (extra = ''): string => `debug=1&gfx=low&renderscale=0.5${PUBLIC ? '' : '&signal=localhost:9187'}${extra}`;

export const LAPTOP = { viewport: { width: 960, height: 540 } };
// A small phone in landscape (Chromium with touch): 667 × 375 like an iPhone SE.
export const PHONE = { viewport: { width: 667, height: 375 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

export interface RoomInfo {
  phase: string;
  round: number;
  br: { blue: number; red: number } | null;
  players: { id: string; name: string; team: string | null; planeId: string | null; party: string | null }[];
}
export interface NetInfo {
  isHost: boolean;
  code: string;
  playerId: string;
  phase: string;
  mode: string;
  lobby: string[];
  room: RoomInfo | null;
  stats: { pingMs: number | null; snapshotsPerS: number; bytesInPerS: number; bytesOutPerS: number } | null;
}
export interface Human {
  id: string;
  name: string;
  pos: [number, number, number];
  alive: boolean;
}
type Hooks = { __rvbs: { net(): NetInfo | null; humans(): Human[]; teamBr(): { blue: number; red: number } | null } };

export const netInfo = (page: Page): Promise<NetInfo | null> => page.evaluate(() => (window as unknown as Hooks).__rvbs.net());
export const humans = (page: Page): Promise<Human[]> => page.evaluate(() => (window as unknown as Hooks).__rvbs.humans());
export const teamBr = (page: Page): Promise<{ blue: number; red: number } | null> => page.evaluate(() => (window as unknown as Hooks).__rvbs.teamBr());

export function watchErrors(page: Page, label: string, into: string[]): void {
  page.on('console', (m) => m.type() === 'error' && into.push(`${label}: ${m.text()}`));
  page.on('pageerror', (e) => into.push(`${label}: ${e.message}`));
}

export const relevantErrors = (errors: string[]): string[] => errors.filter((e) => !/WebGL|GPU stall|ERR_CONNECTION_REFUSED/i.test(e));

export async function openPage(browser: Browser, url: string, label: string, errors: string[], device: object = LAPTOP): Promise<Page> {
  const context = await browser.newContext(device);
  const page = await context.newPage();
  watchErrors(page, label, errors);
  await page.goto(url);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  return page;
}

/** Title → Host / Join → callsign → Host. Returns the room code. */
export async function hostRoom(page: Page, callsign: string): Promise<string> {
  await page.getByRole('button', { name: 'Host / Join' }).click();
  await page.getByLabel('Your callsign').fill(callsign);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Host', exact: true }).click();
  const codeEl = page.getByTestId('room-code');
  await expect(codeEl).toHaveText(/^[A-Z]{4}$/, { timeout: 20_000 });
  return (await codeEl.textContent())!;
}

/** The share link → callsign → Join. */
export async function joinByLink(page: Page, code: string, callsign: string): Promise<void> {
  await expect(page.getByRole('heading', { name: `Join room ${code}` })).toBeVisible();
  await page.getByLabel('Your callsign').fill(callsign);
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page.getByTestId('room-code')).toHaveText(code, { timeout: 30_000 });
}

export const inPhase = (page: Page, phase: string, timeout = 15_000) => expect(page.locator(`.room[data-phase="${phase}"]`)).toBeVisible({ timeout });

/**
 * One round from the lobby: the host starts the vote, everyone votes (era by name), teams appear, everyone
 * picks a plane (by name, one per page) and locks it in, and the match starts on every page.
 */
export async function voteAndPick(host: Page, all: Page[], era: string, planes: string[], onPhase?: (phase: string) => Promise<void>): Promise<void> {
  await host.getByRole('button', { name: /^Start vote/ }).click();
  for (const page of all) await inPhase(page, 'vote');
  await onPhase?.('vote');
  for (const page of all) {
    await page.getByRole('radiogroup', { name: 'Era' }).getByRole('radio', { name: new RegExp(era) }).click();
    await page.getByRole('radiogroup', { name: 'Map' }).getByRole('radio', { name: /Island Chain/ }).click();
    await page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: /Team Deathmatch/ }).click();
  }
  for (const page of all) await inPhase(page, 'teams', 10_000);
  await onPhase?.('teams');
  for (const page of all) await inPhase(page, 'select', 10_000);
  await onPhase?.('select');
  for (let i = 0; i < all.length; i++) {
    const page = all[i]!;
    const plane = LIVE ? (TIER1[era] ?? planes[i]!) : planes[i]!;
    await page.getByRole('radiogroup', { name: 'Plane' }).getByRole('radio', { name: new RegExp(plane) }).click();
    await page.getByRole('button', { name: /^Fly the / }).click();
  }
  for (const page of all) await expect(page.locator('.hud')).toBeVisible({ timeout: 15_000 });
}
