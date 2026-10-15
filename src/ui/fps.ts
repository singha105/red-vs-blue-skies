// Frame-rate readout, shown only with ?debug=1.

export interface FpsCounter {
  frame(frameDt: number): void;
}

/** extra: more debug text appended twice a second (Firestore reads/writes). */
export function createFpsCounter(parent: HTMLElement, extra?: () => string): FpsCounter {
  const el = document.createElement('div');
  el.className = 'fps';
  el.dataset['testid'] = 'fps';
  el.textContent = '-- fps';
  parent.appendChild(el);

  let frames = 0;
  let elapsed = 0;
  let worst = 0;
  return {
    frame(frameDt) {
      frames++;
      elapsed += frameDt;
      worst = Math.max(worst, frameDt);
      if (elapsed >= 0.5) {
        el.textContent = `${Math.round(frames / elapsed)} fps · ${Math.round(worst * 1000)} ms max${extra ? `\n${extra()}` : ''}`;
        frames = 0;
        elapsed = 0;
        worst = 0;
      }
    },
  };
}
