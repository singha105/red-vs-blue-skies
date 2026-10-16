// The tutorial's instruction card (top centre) with the step, what to press on this device, progress, and Skip.
import type { TutorialState, TutorialStep } from '../app/tutorial';

export type Device = 'touch' | 'mouse' | 'gamepad';

const TITLES: Record<TutorialStep, string> = {
  rings: 'Fly through the rings',
  balloons: 'Shoot the balloons',
  missile: 'Fire a missile at the drone',
  flares: 'Beat a missile with flares',
  done: "You're ready",
};

/** What to do in each step, in the words of the device being used. */
export function tutorialHint(step: TutorialStep, device: Device): string {
  const steer = device === 'touch' ? 'Drag on the right side of the screen to move the aim circle' : device === 'gamepad' ? 'Move the left stick to move the aim circle' : 'Click once, then move the mouse to move the aim circle';
  const fire = device === 'touch' ? 'hold Fire' : device === 'gamepad' ? 'hold A' : 'hold Space or the left button';
  const missile = device === 'touch' ? 'tap Missile' : device === 'gamepad' ? 'press B' : 'press Q (or the right button)';
  const flare = device === 'touch' ? 'tap Flare' : device === 'gamepad' ? 'press X' : 'press F';
  switch (step) {
    case 'rings':
      return `${steer}; the plane follows it. Fly through the yellow ring.`;
    case 'balloons':
      return `Put the small circle (your nose) on the diamond next to a balloon and ${fire}.`;
    case 'missile':
      return `Keep the drone in front of you until the box turns solid red (locked), then ${missile}.`;
    case 'flares':
      return `An enemy is behind you. When MISSILE flashes, ${flare} and turn hard.`;
    case 'done':
      return 'Play Solo against bots, or Host / Join to fly with friends. How to play is on the title screen.';
  }
}

export interface TutorialPanel {
  update(t: TutorialState, device: Device): void;
  dispose(): void;
}

export function createTutorialPanel(parent: HTMLElement, onSkip: () => void): TutorialPanel {
  const el = document.createElement('section');
  el.className = 'tut';
  el.setAttribute('aria-label', 'Tutorial');
  el.innerHTML = `
    <div class="tut__step" data-testid="tutorial-step"></div>
    <h2 class="tut__title"></h2>
    <p class="tut__hint"></p>
    <p class="tut__note" role="status" aria-live="polite"></p>
    <button type="button" class="btn btn--secondary btn--small tut__skip" data-testid="tutorial-skip">Skip tutorial</button>
  `;
  parent.appendChild(el);
  el.querySelector('.tut__skip')!.addEventListener('click', onSkip);
  const stepEl = el.querySelector<HTMLElement>('.tut__step')!;
  const titleEl = el.querySelector<HTMLElement>('.tut__title')!;
  const hintEl = el.querySelector<HTMLElement>('.tut__hint')!;
  const noteEl = el.querySelector<HTMLElement>('.tut__note')!;
  let key = '';
  return {
    update(t, device) {
      const order: TutorialStep[] = ['rings', 'balloons', 'missile', 'flares'];
      const n = order.indexOf(t.step);
      const progress =
        t.step === 'rings' ? ` · ring ${Math.min(t.ring + 1, t.rings.length)} of ${t.rings.length}` : t.step === 'balloons' ? ` · ${t.balloons.filter((b) => b.popped).length} of ${t.balloons.length} popped` : '';
      const next = `${t.step}|${device}|${progress}|${t.note}`;
      if (next === key) return;
      key = next;
      el.dataset['step'] = t.step;
      stepEl.textContent = n >= 0 ? `Step ${n + 1} of 4${progress}` : t.ringsHit > 0 ? `${t.ringsHit} of ${t.rings.length} rings` : 'Done';
      titleEl.textContent = TITLES[t.step];
      hintEl.textContent = tutorialHint(t.step, device);
      noteEl.textContent = t.note;
    },
    dispose() {
      el.remove();
    },
  };
}
