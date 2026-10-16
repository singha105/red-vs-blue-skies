import { expect, test, type Page } from '@playwright/test';

// Day 10 mobile QA: landscape phones from the iPhone SE to big Androids. On every main screen: no visible
// text under 14 px, no two buttons overlapping, every button at least 44 px (56 px for the in-flight touch
// buttons) and fully on screen. Runs in the touch (WebKit iPhone) project.
const SHOTS = 'tests/screenshots';
const PHONES = [
  { name: 'iphone-se', width: 667, height: 375 },
  { name: 'iphone-13', width: 844, height: 390 },
  { name: 'iphone-pro-max', width: 932, height: 430 },
  { name: 'android-small', width: 800, height: 360 },
  { name: 'android-large', width: 915, height: 412 },
];

interface Problem {
  kind: string;
  what: string;
}

/** Layout problems on the current screen (visible elements only). */
function audit(page: Page, minTouch: number): Promise<Problem[]> {
  return page.evaluate((minTouch) => {
    const problems: { kind: string; what: string }[] = [];
    const label = (el: Element): string => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${(el.textContent ?? '').trim().slice(0, 30)}"`;
    const visible = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      // Covered by something else (a dialog over the title, the footer over a scrolled list): not what you see.
      const cx = Math.min(window.innerWidth - 1, Math.max(0, r.left + r.width / 2));
      const cy = Math.min(window.innerHeight - 1, Math.max(0, r.top + r.height / 2));
      const top = document.elementFromPoint(cx, cy);
      // (HUD text has pointer-events: none, so the hit test falls through to the canvas: that's not covered.)
      if (top && top.id !== 'game' && top !== document.body && top !== el && !el.contains(top) && !top.contains(el)) return false;
      for (let n: Element | null = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
      }
      return true;
    };
    // Text: any element with its own non-empty text node.
    for (const el of document.querySelectorAll('#ui *')) {
      const own = [...el.childNodes].some((c) => c.nodeType === Node.TEXT_NODE && (c.textContent ?? '').trim() !== '');
      if (!own || !visible(el)) continue;
      // The scale property (HUD size) shrinks what you see, so measure the rendered size.
      const fs = parseFloat(getComputedStyle(el).fontSize);
      let scale = 1;
      for (let n: Element | null = el; n; n = n.parentElement) {
        const s = getComputedStyle(n).scale;
        if (s && s !== 'none') scale *= parseFloat(s);
      }
      if (fs * scale < 13.95) problems.push({ kind: 'text', what: `${label(el)} ${(fs * scale).toFixed(1)}px` });
    }
    const buttons = [...document.querySelectorAll('#ui button, #ui [role="slider"], #ui select, #ui input[type="range"]')].filter(visible);
    const W = window.innerWidth;
    const H = window.innerHeight;
    for (const b of buttons) {
      const r = b.getBoundingClientRect();
      if (r.left < -0.5 || r.top < -0.5 || r.right > W + 0.5 || r.bottom > H + 0.5) {
        // Inside a scrolling panel it's fine to be scrolled out of view.
        let scroller = false;
        for (let n = b.parentElement; n; n = n.parentElement) {
          const o = getComputedStyle(n);
          if (/(auto|scroll)/.test(o.overflowY + o.overflowX) && n.scrollHeight + n.scrollWidth > n.clientHeight + n.clientWidth + 2) scroller = true;
        }
        if (!scroller) problems.push({ kind: 'offscreen', what: label(b) });
      }
      const min = b.closest('.touch') ? 56 : minTouch;
      if (b.tagName !== 'INPUT' && (r.height < min - 0.5 || r.width < min - 0.5)) problems.push({ kind: 'small', what: `${label(b)} ${Math.round(r.width)}×${Math.round(r.height)}` });
    }
    // What you can see of an element: its box clipped by every scrolling or clipping ancestor.
    const shown = (el: Element): { left: number; top: number; right: number; bottom: number } => {
      const r = el.getBoundingClientRect();
      const out = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      for (let n = el.parentElement; n; n = n.parentElement) {
        const o = getComputedStyle(n);
        if (o.overflowX === 'visible' && o.overflowY === 'visible') continue;
        const c = n.getBoundingClientRect();
        out.left = Math.max(out.left, c.left);
        out.top = Math.max(out.top, c.top);
        out.right = Math.min(out.right, c.right);
        out.bottom = Math.min(out.bottom, c.bottom);
      }
      return out;
    };
    for (let i = 0; i < buttons.length; i++) {
      for (let j = i + 1; j < buttons.length; j++) {
        const a = shown(buttons[i]!);
        const b = shown(buttons[j]!);
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 1 && oy > 1 && !buttons[i]!.contains(buttons[j]!) && !buttons[j]!.contains(buttons[i]!)) problems.push({ kind: 'overlap', what: `${label(buttons[i]!)} × ${label(buttons[j]!)}` });
      }
    }
    return problems;
  }, minTouch);
}

test.describe('phones in landscape', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(!isMobile, 'touch layout');
  });

  for (const phone of PHONES) {
    test(`${phone.name} ${phone.width}×${phone.height}: title, setup, settings, how to play, HUD`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: phone.width, height: phone.height });
      await page.goto('./?debug=1');
      await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
      const found: Record<string, Problem[]> = {};
      const check = async (screen: string, minTouch = 44): Promise<void> => {
        const p = await audit(page, minTouch);
        if (p.length) found[screen] = p;
      };
      await check('title');
      await page.getByRole('button', { name: 'Settings' }).click();
      await check('settings');
      await page.getByRole('button', { name: 'Done' }).click();
      await page.getByRole('button', { name: 'How to play' }).click();
      await check('how to play');
      await page.screenshot({ path: `${SHOTS}/${phone.name}-howto.png` });
      await page.getByRole('button', { name: 'Done' }).click();
      await page.getByRole('button', { name: 'Play Solo' }).click();
      await check('setup');
      await page.evaluate(() => (window as unknown as { __rvbs: { startSolo(c: object): void } }).__rvbs.startSolo({ era: 'modern', planeId: 'mig29a' }));
      await expect(page.locator('.touch')).toBeVisible();
      await page.waitForTimeout(1500);
      await check('hud');
      await page.screenshot({ path: `${SHOTS}/${phone.name}-hud.png` });
      expect(found, JSON.stringify(found, null, 1)).toEqual({});
    });
  }
});
