// Phone and tablet controls. Left thumb: throttle slider plus Fire / Missile / Flare.
// Right thumb: drag anywhere on the right side to move the aim (relative, like a trackpad).
// Top right: Auto-level and Free-look. Everything is at least 56 px and clear of the notch.
import type { PlaneState } from '../game/flight';
import type { PlayerControls } from '../core/playerControls';

const TOUCH_RAD_PER_PX = 0.0055;

const capture = (el: HTMLElement, id: number): void => {
  try {
    el.setPointerCapture(id);
  } catch {
    // Synthetic or already-ended pointers can't be captured; the drag still works without it.
  }
};

export interface TouchControls {
  readonly el: HTMLElement;
  readonly buttons: Readonly<{ fire: boolean; missile: boolean; flare: boolean }>;
  /** Keep the slider in step with throttle changes from elsewhere (respawn, keyboard). */
  sync(): void;
  setPlane(plane: PlaneState | null): void;
  dispose(): void;
}

export function createTouchControls(parent: HTMLElement, controls: PlayerControls, sensitivity: () => number): TouchControls {
  const el = document.createElement('div');
  el.className = 'touch';
  el.innerHTML = `
    <div class="touch__aim" data-testid="aim-pad" aria-label="Drag to aim"></div>
    <div class="touch__throttle" role="slider" aria-label="Throttle" aria-valuemin="0" aria-valuemax="100" tabindex="0">
      <div class="touch__throttle-fill"></div>
      <span class="touch__throttle-label">80%</span>
    </div>
    <div class="touch__weapons">
      <button type="button" class="tbtn tbtn--fire" data-hold="fire">Fire</button>
      <button type="button" class="tbtn" data-hold="missile">Missile</button>
      <button type="button" class="tbtn" data-hold="flare">Flare</button>
    </div>
    <div class="touch__utility">
      <button type="button" class="tbtn tbtn--small" data-tap="level">Level</button>
      <button type="button" class="tbtn tbtn--small" data-tap="look" aria-pressed="false">Look</button>
    </div>
  `;
  parent.appendChild(el);

  const buttons = { fire: false, missile: false, flare: false };
  let plane: PlaneState | null = null;

  // Aim pad: relative drag, one finger at a time.
  const pad = el.querySelector<HTMLElement>('.touch__aim')!;
  let aimPointer: number | null = null;
  let lastX = 0;
  let lastY = 0;
  pad.addEventListener('pointerdown', (e) => {
    if (aimPointer !== null) return;
    aimPointer = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    capture(pad, e.pointerId);
  });
  pad.addEventListener('pointermove', (e) => {
    if (e.pointerId !== aimPointer) return;
    const k = TOUCH_RAD_PER_PX * sensitivity();
    controls.moveAim((e.clientX - lastX) * k, -(e.clientY - lastY) * k);
    lastX = e.clientX;
    lastY = e.clientY;
  });
  const endAim = (e: PointerEvent): void => {
    if (e.pointerId === aimPointer) aimPointer = null;
  };
  pad.addEventListener('pointerup', endAim);
  pad.addEventListener('pointercancel', endAim);

  // Throttle: absolute position on the slider; top = 100%.
  const slider = el.querySelector<HTMLElement>('.touch__throttle')!;
  const fill = el.querySelector<HTMLElement>('.touch__throttle-fill')!;
  const label = el.querySelector<HTMLElement>('.touch__throttle-label')!;
  let throttlePointer: number | null = null;
  let shown = -1;
  const show = (): void => {
    const pct = Math.round(controls.throttle * 100);
    if (pct === shown) return;
    shown = pct;
    fill.style.transform = `scaleY(${controls.throttle})`;
    label.textContent = `${pct}%`;
    slider.setAttribute('aria-valuenow', String(pct));
  };
  const setFromY = (y: number): void => {
    const r = slider.getBoundingClientRect();
    controls.setThrottle(1 - (y - r.top) / r.height);
    show();
  };
  slider.addEventListener('pointerdown', (e) => {
    throttlePointer = e.pointerId;
    capture(slider, e.pointerId);
    setFromY(e.clientY);
  });
  slider.addEventListener('pointermove', (e) => {
    if (e.pointerId === throttlePointer) setFromY(e.clientY);
  });
  const endThrottle = (e: PointerEvent): void => {
    if (e.pointerId === throttlePointer) throttlePointer = null;
  };
  slider.addEventListener('pointerup', endThrottle);
  slider.addEventListener('pointercancel', endThrottle);

  // Hold buttons (fire, missile, flare) and tap buttons (level, look).
  for (const btn of el.querySelectorAll<HTMLButtonElement>('[data-hold]')) {
    const key = btn.dataset['hold'] as keyof typeof buttons;
    const press = (on: boolean) => (e: PointerEvent): void => {
      e.preventDefault();
      buttons[key] = on;
      btn.classList.toggle('is-down', on);
    };
    btn.addEventListener('pointerdown', press(true));
    btn.addEventListener('pointerup', press(false));
    btn.addEventListener('pointercancel', press(false));
    btn.addEventListener('pointerleave', press(false));
  }
  const lookBtn = el.querySelector<HTMLButtonElement>('[data-tap="look"]')!;
  el.querySelector<HTMLButtonElement>('[data-tap="level"]')!.addEventListener('click', () => {
    if (plane) controls.autoLevel(plane);
  });
  lookBtn.addEventListener('click', () => {
    controls.freeLook = !controls.freeLook;
    lookBtn.setAttribute('aria-pressed', String(controls.freeLook));
    if (!controls.freeLook) {
      controls.look.yaw = 0;
      controls.look.pitch = 0;
    }
  });

  show();
  return {
    el,
    buttons,
    sync() {
      show();
      lookBtn.setAttribute('aria-pressed', String(controls.freeLook));
    },
    setPlane(next) {
      plane = next;
    },
    dispose() {
      el.remove();
    },
  };
}
