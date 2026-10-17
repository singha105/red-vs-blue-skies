// Day 12: the game targets laptop and desktop browsers (mouse and keyboard, gamepads, joysticks). Phones and
// tablets get a friendly "please play on a laptop or desktop" screen instead of the game. The touch code stays in
// the repo but is no longer maintained.

export interface DeviceFacts {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
}

/** True for phones and tablets. Touch-screen laptops have a fine pointer (trackpad or mouse) and stay supported. */
export function isPhoneOrTablet(d: DeviceFacts, media: (query: string) => boolean): boolean {
  if (/iPhone|iPod|iPad|Android|Mobi|Silk|Kindle|PlayBook|BB10/i.test(d.userAgent)) return true;
  // iPadOS Safari asks for the desktop site and calls itself a Mac; real Macs have no touch points.
  if (/Mac/.test(d.platform) && d.maxTouchPoints > 1) return true;
  return media('(pointer: coarse)') && !media('(any-pointer: fine)');
}

/** The "Continue anyway" choice on the unsupported-device screen, remembered per browser. */
export const DEVICE_OVERRIDE_KEY = 'rvbs.anydevice.v1';

/** The unsupported-device screen. Calls `onContinue` if the player chooses to try anyway. */
export function showDesktopOnly(root: HTMLElement, onContinue: () => void): void {
  const card = document.createElement('section');
  card.className = 'desktop-only';
  card.setAttribute('role', 'alert');
  card.innerHTML = `
    <div class="desktop-only__card">
      <div class="desktop-only__laptop" aria-hidden="true"></div>
      <h1>Please play on a laptop or desktop</h1>
      <p>Red vs Blue Skies is built for a keyboard and mouse, a gamepad or a joystick, on Chrome, Edge, Firefox or Safari on a Mac.</p>
      <p>Send yourself the link and open it on a computer:</p>
      <p class="desktop-only__url"></p>
      <button type="button" class="desktop-only__anyway">Continue anyway (not supported)</button>
    </div>`;
  const url = card.querySelector<HTMLElement>('.desktop-only__url');
  if (url) url.textContent = window.location.origin + window.location.pathname;
  card.querySelector('button')?.addEventListener('click', () => {
    card.remove();
    onContinue();
  });
  root.append(card);
  document.body.dataset['screen'] = 'desktop-only';
}
