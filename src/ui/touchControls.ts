// Phone and tablet controls. Left thumb: throttle slider plus Fire / Missile / Flare.
// Right thumb: drag anywhere on the right side to move the aim (relative, like a trackpad); a quick tap picks
// the enemy under your finger as the missile target. The Missile button shows a lock-progress ring.
// Top right: Auto-level and Free-look. Everything is at least 56 px and clear of the notch.
import type { PlaneState } from '../game/flight';
import type { PlayerControls } from '../core/playerControls';

const TOUCH_RAD_PER_PX = 0.0055;
/** A touch on the aim pad that moves less than this and lifts quickly is a tap (target select). */
const TAP_PX = 14;
const TAP_MS = 300;

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
  /** Missile taps since the last call (a tap can be shorter than a simulation tick). */
  takeMissilePress(): boolean;
  /** Missile button: lock progress 0–1 (ring), locked, and counts (null hides them, e.g. guns-only planes). */
  setWeapons(w: null | { progress: number; locked: boolean; missiles: number; flares: number; chaff: number }): void;
  dispose(): void;
}

export function createTouchControls(
  parent: HTMLElement,
  controls: PlayerControls,
  sensitivity: () => number,
  onTap: (x: number, y: number) => void = () => undefined,
): TouchControls {
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
      <button type="button" class="tbtn tbtn--missile" data-hold="missile" data-testid="missile-btn">Missile<span class="tbtn__count" data-c="missile"></span><svg class="tbtn__ring" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><rect x="2" y="2" width="96" height="96" rx="12" pathLength="100" /></svg></button>
      <button type="button" class="tbtn" data-hold="flare">Flare<span class="tbtn__count" data-c="flare"></span></button>
    </div>
    <div class="touch__utility">
      <button type="button" class="tbtn tbtn--small" data-tap="level">Level</button>
      <button type="button" class="tbtn tbtn--small" data-tap="look" aria-pressed="false">Look</button>
    </div>
  `;
  parent.appendChild(el);

  const buttons = { fire: false, missile: false, flare: false };
  let plane: PlaneState | null = null;
  let missileTapped = false;

  // Aim pad: relative drag, one finger at a time.
  const pad = el.querySelector<HTMLElement>('.touch__aim')!;
  let aimPointer: number | null = null;
  let lastX = 0;
  let lastY = 0;
  let downX = 0;
  let downY = 0;
  let downAt = 0;
  let moved = 0;
  pad.addEventListener('pointerdown', (e) => {
    if (aimPointer !== null) return;
    aimPointer = e.pointerId;
    lastX = downX = e.clientX;
    lastY = downY = e.clientY;
    downAt = performance.now();
    moved = 0;
    capture(pad, e.pointerId);
  });
  pad.addEventListener('pointermove', (e) => {
    if (e.pointerId !== aimPointer) return;
    const k = TOUCH_RAD_PER_PX * sensitivity();
    controls.moveAim((e.clientX - lastX) * k, -(e.clientY - lastY) * k);
    moved = Math.max(moved, Math.hypot(e.clientX - downX, e.clientY - downY));
    lastX = e.clientX;
    lastY = e.clientY;
  });
  const endAim = (e: PointerEvent): void => {
    if (e.pointerId !== aimPointer) return;
    aimPointer = null;
    if (e.type === 'pointerup' && moved < TAP_PX && performance.now() - downAt < TAP_MS) onTap(e.clientX, e.clientY);
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
      if (on && key === 'missile') missileTapped = true;
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

  const missileBtn = el.querySelector<HTMLButtonElement>('.tbtn--missile')!;
  const flareBtn = el.querySelector<HTMLButtonElement>('[data-hold="flare"]')!;
  const ringRect = el.querySelector<SVGRectElement>('.tbtn__ring rect')!;
  const missileCount = el.querySelector<HTMLElement>('[data-c="missile"]')!;
  const flareCount = el.querySelector<HTMLElement>('[data-c="flare"]')!;
  let weaponsKey = '';

  show();
  return {
    el,
    buttons,
    takeMissilePress() {
      const t = missileTapped;
      missileTapped = false;
      return t;
    },
    setWeapons(w) {
      const key = w ? `${Math.round(w.progress * 50)}|${w.locked}|${w.missiles}|${w.flares}|${w.chaff}` : 'none';
      if (key === weaponsKey) return;
      weaponsKey = key;
      ringRect.style.strokeDashoffset = String(w ? 100 - Math.round(w.progress * 100) : 100);
      missileBtn.classList.toggle('is-locked', Boolean(w?.locked));
      missileBtn.classList.toggle('is-empty', !w || w.missiles === 0);
      flareBtn.classList.toggle('is-empty', !w || w.flares + w.chaff === 0);
      missileCount.textContent = w ? `×${w.missiles}` : '';
      flareCount.textContent = w && w.flares + w.chaff > 0 ? `×${Math.max(w.flares, w.chaff)}` : '';
    },
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
