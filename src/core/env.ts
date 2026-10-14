// Facts about the page and device, read once at startup.

const params = new URLSearchParams(window.location.search);

export const env = {
  debug: params.get('debug') === '1',
  room: params.get('room'),
  isTouch: window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0,
  version: __APP_VERSION__,
} as const;
