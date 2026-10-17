// Facts about the page and device, read once at startup.
import { isPhoneOrTablet } from './device';

const params = new URLSearchParams(window.location.search);
const debug = params.get('debug') === '1';
const local = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

export const env = {
  debug,
  /** Running on this machine (dev server or preview), never the live site. */
  local,
  /** Every plane open: ?debug=1 on localhost only, so the live site can't be unlocked from the URL.
   * &locks=1 keeps the real unlocks (testing research). */
  allUnlocked: debug && local && params.get('locks') !== '1',
  /** ?debug=1&emu=1 on localhost: Firebase talks to the local emulators (tests). */
  emulator: debug && local && params.get('emu') === '1',
  /** Pretend Firebase is unreachable: ?debug=1&offline=1, and in automated browsers (Playwright) unless they
   * use the emulators or ask for it with ?fb=1, so test runs never create real accounts. */
  firebaseOff:
    (debug && params.get('offline') === '1') || (navigator.webdriver && params.get('emu') !== '1' && params.get('fb') !== '1'),
  room: params.get('room'),
  isTouch: window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0,
  /** Phones and tablets aren't supported since Day 12 (see core/device.ts). */
  phoneOrTablet: isPhoneOrTablet(navigator, (q) => window.matchMedia(q).matches),
  version: __APP_VERSION__,
} as const;
