// Fixed-step simulation loop with variable-rate rendering.

export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;
const MAX_FRAME_S = 0.25; // after a stall (tab switch, GC), don't try to catch up more than this
// Background tabs get timers at most once a second, so a hidden host catches up to this much per wake-up.
const MAX_HIDDEN_S = 1;
const HIDDEN_TICK_MS = 250;

export interface LoopHandlers {
  /** Advance the simulation by exactly SIM_DT seconds. */
  update(dt: number): void;
  /** Draw a frame. alpha is how far (0–1) we are between the last two simulation steps. */
  render(alpha: number, frameDt: number): void;
}

export interface Loop {
  /**
   * While the tab is hidden, browsers stop requestAnimationFrame. With this on (a host), a timer keeps the
   * simulation stepping (no rendering) so the match doesn't freeze for everyone else.
   */
  keepRunningHidden(on: () => boolean): void;
  start(): void;
  stop(): void;
  readonly running: boolean;
}

/** `maxFps` (optional): draw at most this many frames a second; the simulation still catches up every step. */
export function createLoop(handlers: LoopHandlers, maxFps: () => number = () => 0): Loop {
  let raf = 0;
  let last = 0;
  let acc = 0;
  let running = false;

  const frame = (now: number): void => {
    raf = requestAnimationFrame(frame);
    // Frame cap (Settings → 30 fps): skip display frames that come too soon. 2 ms of slack so a 60 Hz
    // display lands on every second frame instead of drifting.
    const cap = maxFps();
    if (cap > 0 && last !== 0 && now - last < 1000 / cap - 2) return;
    const frameDt = Math.min(MAX_FRAME_S, last === 0 ? SIM_DT : (now - last) / 1000);
    last = now;
    acc += frameDt;
    while (acc >= SIM_DT) {
      handlers.update(SIM_DT);
      acc -= SIM_DT;
    }
    handlers.render(acc / SIM_DT, frameDt);
  };

  let hiddenRun: () => boolean = () => false;
  let timer = 0;
  const hiddenStep = (): void => {
    const now = performance.now();
    const dt = Math.min(MAX_HIDDEN_S, last === 0 ? SIM_DT : (now - last) / 1000);
    last = now;
    acc += dt;
    while (acc >= SIM_DT) {
      handlers.update(SIM_DT);
      acc -= SIM_DT;
    }
  };
  const onVisibility = (): void => {
    window.clearInterval(timer);
    timer = 0;
    if (running && document.hidden && hiddenRun()) timer = window.setInterval(hiddenStep, HIDDEN_TICK_MS);
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  return {
    keepRunningHidden(on) {
      hiddenRun = on;
    },
    start() {
      if (running) return;
      running = true;
      last = 0;
      acc = 0;
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    get running() {
      return running;
    },
  };
}
