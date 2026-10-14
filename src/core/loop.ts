// Fixed-step simulation loop with variable-rate rendering.

export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;
const MAX_FRAME_S = 0.25; // after a stall (tab switch, GC), don't try to catch up more than this

export interface LoopHandlers {
  /** Advance the simulation by exactly SIM_DT seconds. */
  update(dt: number): void;
  /** Draw a frame. alpha is how far (0–1) we are between the last two simulation steps. */
  render(alpha: number, frameDt: number): void;
}

export interface Loop {
  start(): void;
  stop(): void;
  readonly running: boolean;
}

export function createLoop(handlers: LoopHandlers): Loop {
  let raf = 0;
  let last = 0;
  let acc = 0;
  let running = false;

  const frame = (now: number): void => {
    raf = requestAnimationFrame(frame);
    const frameDt = Math.min(MAX_FRAME_S, last === 0 ? SIM_DT : (now - last) / 1000);
    last = now;
    acc += frameDt;
    while (acc >= SIM_DT) {
      handlers.update(SIM_DT);
      acc -= SIM_DT;
    }
    handlers.render(acc / SIM_DT, frameDt);
  };

  return {
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
