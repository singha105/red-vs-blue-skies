// Keeps the screen on while a room or match is open (Screen Wake Lock API: Chrome 84+, Safari 16.4+, and in
// home-screen apps on iOS 18.4+). A phone that dims and locks drops its WebRTC connection, and a phone host
// would end the match for everyone. Browsers release the lock when the tab is hidden, so it's taken again
// when the tab comes back. Where the API is missing this does nothing.
interface Sentinel {
  release(): Promise<void>;
  addEventListener(type: 'release', fn: () => void): void;
}
interface WakeLockApi {
  request(type: 'screen'): Promise<Sentinel>;
}

export interface WakeLock {
  want(on: boolean): void;
  readonly held: boolean;
}

export function createWakeLock(): WakeLock {
  const api = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
  let wanted = false;
  let sentinel: Sentinel | null = null;
  let asking = false;
  const take = (): void => {
    if (!api || !wanted || sentinel || asking || document.hidden) return;
    asking = true;
    api
      .request('screen')
      .then((s) => {
        asking = false;
        if (!wanted) {
          void s.release().catch(() => undefined);
          return;
        }
        sentinel = s;
        s.addEventListener('release', () => {
          if (sentinel === s) sentinel = null;
        });
      })
      .catch(() => {
        // Refused (battery saver, not allowed in this frame): the lobby's warning still applies.
        asking = false;
      });
  };
  document.addEventListener('visibilitychange', take);
  return {
    want(on) {
      wanted = on;
      if (on) take();
      else if (sentinel) {
        const s = sentinel;
        sentinel = null;
        void s.release().catch(() => undefined);
      }
    },
    get held() {
      return sentinel !== null;
    },
  };
}
