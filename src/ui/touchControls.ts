// Phone and tablet controls.
// Left thumb: throttle slider (the top band is WEP / afterburner) plus FIRE (guns, hold), MSL (secondary weapon,
// with a lock-progress ring and a small arrow to switch weapon), CM (flares and chaff) and RDR (tap: lock or
// unlock; long-press: Search / Dogfight).
// Right thumb: drag anywhere on the right side to steer (relative, like a trackpad); a quick tap on an enemy
// selects it. Top right: LEVEL, the eye (drag it to look around), ZOOM (hold). Optional (Settings): rudder
// buttons, and tilt steering (asks for motion permission on iPhone).
// Everything is at least 56 px and clear of the notch.
import type { PlaneState } from '../game/flight';
import { WEP_THROTTLE, type PlayerControls } from '../core/playerControls';

const TOUCH_RAD_PER_PX = 0.0055;
const LOOK_RAD_PER_PX = 0.008;
/** A touch on the aim pad that moves less than this and lifts quickly is a tap (target select). */
const TAP_PX = 14;
const TAP_MS = 300;
const LONG_PRESS_MS = 450;
/** The slider's top band (this fraction of its height) is WEP. */
const WEP_BAND = 0.12;
/** Tilt steering: degrees of tilt for full deflection, and the dead zone. */
const TILT_FULL_DEG = 25;
const TILT_DEAD_DEG = 3;

const capture = (el: HTMLElement, id: number): void => {
  try {
    el.setPointerCapture(id);
  } catch {
    // Synthetic or already-ended pointers can't be captured; the drag still works without it.
  }
};

export interface TouchWeapons {
  progress: number;
  locked: boolean;
  missiles: number;
  flares: number;
  chaff: number;
  /** Short name of the selected secondary weapon ("AIM-9L", "Rockets"). */
  label: string;
  /** More than one secondary to switch between. */
  canSwitch: boolean;
}

export interface TouchControls {
  readonly el: HTMLElement;
  readonly buttons: Readonly<{ fire: boolean; missile: boolean; flare: boolean }>;
  /** Keep the slider in step with throttle changes from elsewhere (respawn, keyboard). */
  sync(): void;
  setPlane(plane: PlaneState | null): void;
  /** Missile taps since the last call (a tap can be shorter than a simulation tick). */
  takeMissilePress(): boolean;
  /** One-shot presses: switch secondary, radar lock toggle, radar mode. */
  takePress(what: 'cycleSecondary' | 'radarLock' | 'radarMode'): boolean;
  /** MSL button: lock progress ring, counts and weapon name (null hides them, e.g. guns-only planes). */
  setWeapons(w: TouchWeapons | null): void;
  /** RDR button: hidden without a radar; shows LOCK / DGFT. */
  setRadar(r: null | { locked: boolean; dogfight: boolean; on: boolean }): void;
  /** Show the optional rudder buttons and tilt steering (Settings). */
  setOptions(o: { rudder: boolean; tilt: boolean }): void;
  /** Let go of every held button (the app went to the background mid-press; no pointerup will come). */
  releaseAll(): void;
  dispose(): void;
}

/** iPhone Safari needs a permission prompt, from a tap, before it sends motion events. */
export async function requestTiltPermission(): Promise<boolean> {
  const D = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
  if (!D) return false;
  if (typeof D.requestPermission !== 'function') return true;
  try {
    return (await D.requestPermission()) === 'granted';
  } catch {
    return false;
  }
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
    <div class="touch__aim" data-testid="aim-pad" aria-label="Drag to steer"></div>
    <div class="touch__throttle" role="slider" aria-label="Throttle" aria-valuemin="0" aria-valuemax="110" tabindex="0">
      <div class="touch__wep" aria-hidden="true"></div>
      <div class="touch__throttle-fill"></div>
      <span class="touch__throttle-label">80%</span>
    </div>
    <div class="touch__weapons">
      <button type="button" class="tbtn tbtn--fire" data-hold="fire">FIRE</button>
      <button type="button" class="tbtn tbtn--missile" data-hold="missile" data-testid="missile-btn">MSL<span class="tbtn__count" data-c="missile"></span><span class="tbtn__name" data-c="name"></span><svg class="tbtn__ring" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><rect x="2" y="2" width="96" height="96" rx="12" pathLength="100" /></svg></button>
      <button type="button" class="tbtn tbtn--switch" data-tap="switch" aria-label="Switch secondary weapon" data-testid="switch-btn">›</button>
      <button type="button" class="tbtn" data-hold="flare" data-testid="cm-btn">CM<span class="tbtn__count" data-c="flare"></span></button>
      <button type="button" class="tbtn tbtn--radar" data-testid="radar-btn" aria-label="Radar: tap to lock, hold to change mode">RDR<span class="tbtn__sub" data-c="radar"></span></button>
    </div>
    <div class="touch__utility">
      <button type="button" class="tbtn tbtn--small" data-tap="level">LEVEL</button>
      <button type="button" class="tbtn tbtn--small tbtn--eye" data-testid="look-btn" aria-label="Drag to look around" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg></button>
      <button type="button" class="tbtn tbtn--small" data-zoom="1" aria-pressed="false">ZOOM</button>
    </div>
    <div class="touch__rudder" hidden>
      <button type="button" class="tbtn tbtn--small" data-rudder="-1" aria-label="Rudder left">◀</button>
      <button type="button" class="tbtn tbtn--small" data-rudder="1" aria-label="Rudder right">▶</button>
    </div>
  `;
  parent.appendChild(el);

  const buttons = { fire: false, missile: false, flare: false };
  const presses = new Set<'cycleSecondary' | 'radarLock' | 'radarMode'>();
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

  // Throttle: absolute position on the slider; the top band is WEP.
  const slider = el.querySelector<HTMLElement>('.touch__throttle')!;
  const fill = el.querySelector<HTMLElement>('.touch__throttle-fill')!;
  const label = el.querySelector<HTMLElement>('.touch__throttle-label')!;
  let throttlePointer: number | null = null;
  let shown = '';
  const show = (): void => {
    const wep = controls.throttle > 1;
    const pct = Math.round(Math.min(1, controls.throttle) * 100);
    const key = wep ? 'wep' : String(pct);
    if (key === shown) return;
    shown = key;
    fill.style.transform = `scaleY(${wep ? 1 : Math.min(1, controls.throttle) * (1 - WEP_BAND)})`;
    slider.classList.toggle('is-wep', wep);
    label.textContent = wep ? 'WEP' : `${pct}%`;
    slider.setAttribute('aria-valuenow', String(wep ? 110 : pct));
  };
  const setFromY = (y: number): void => {
    const r = slider.getBoundingClientRect();
    const t = 1 - (y - r.top) / r.height;
    controls.setThrottle(t > 1 - WEP_BAND ? WEP_THROTTLE : Math.max(0, t / (1 - WEP_BAND)));
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

  // Hold buttons (fire, missile, flare).
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
  el.querySelector<HTMLButtonElement>('[data-tap="switch"]')!.addEventListener('click', () => presses.add('cycleSecondary'));
  el.querySelector<HTMLButtonElement>('[data-tap="level"]')!.addEventListener('click', () => {
    if (plane) controls.autoLevel(plane);
  });

  // RDR: tap = lock / unlock, long-press = mode.
  const radarBtn = el.querySelector<HTMLButtonElement>('.tbtn--radar')!;
  const radarSub = el.querySelector<HTMLElement>('[data-c="radar"]')!;
  let radarTimer = 0;
  let radarLong = false;
  radarBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    radarLong = false;
    radarBtn.classList.add('is-down');
    window.clearTimeout(radarTimer);
    radarTimer = window.setTimeout(() => {
      radarLong = true;
      presses.add('radarMode');
      navigator.vibrate?.(20);
    }, LONG_PRESS_MS);
  });
  const radarUp = (e: PointerEvent): void => {
    radarBtn.classList.remove('is-down');
    window.clearTimeout(radarTimer);
    if (e.type === 'pointerup' && !radarLong) presses.add('radarLock');
    radarLong = true; // a cancel or leave never toggles the lock
  };
  radarBtn.addEventListener('pointerup', radarUp);
  radarBtn.addEventListener('pointercancel', radarUp);
  radarBtn.addEventListener('pointerleave', radarUp);

  // The eye: drag it to look around; let go and the view swings back.
  const lookBtn = el.querySelector<HTMLButtonElement>('.tbtn--eye')!;
  let lookPointer: number | null = null;
  let lookX = 0;
  let lookY = 0;
  lookBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    lookPointer = e.pointerId;
    lookX = e.clientX;
    lookY = e.clientY;
    capture(lookBtn, e.pointerId);
    controls.freeLook = true;
    controls.touch.look = true;
    lookBtn.setAttribute('aria-pressed', 'true');
  });
  lookBtn.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lookPointer) return;
    controls.look.yaw += (e.clientX - lookX) * LOOK_RAD_PER_PX;
    controls.look.pitch = Math.max(-1.2, Math.min(1.2, controls.look.pitch - (e.clientY - lookY) * LOOK_RAD_PER_PX));
    lookX = e.clientX;
    lookY = e.clientY;
  });
  const endLook = (e: PointerEvent): void => {
    if (e.pointerId !== lookPointer) return;
    lookPointer = null;
    controls.freeLook = false;
    controls.touch.look = false;
    controls.look.yaw = 0;
    controls.look.pitch = 0;
    lookBtn.setAttribute('aria-pressed', 'false');
  };
  lookBtn.addEventListener('pointerup', endLook);
  lookBtn.addEventListener('pointercancel', endLook);

  // ZOOM (hold).
  const zoomBtn = el.querySelector<HTMLButtonElement>('[data-zoom]')!;
  const zoom = (on: boolean) => (e: PointerEvent): void => {
    e.preventDefault();
    controls.zoom = on;
    controls.touch.zoom = on;
    zoomBtn.setAttribute('aria-pressed', String(on));
  };
  zoomBtn.addEventListener('pointerdown', zoom(true));
  zoomBtn.addEventListener('pointerup', zoom(false));
  zoomBtn.addEventListener('pointercancel', zoom(false));
  zoomBtn.addEventListener('pointerleave', zoom(false));

  // Rudder buttons (optional).
  const rudderBox = el.querySelector<HTMLElement>('.touch__rudder')!;
  const rudderHeld = new Set<number>();
  for (const btn of el.querySelectorAll<HTMLButtonElement>('[data-rudder]')) {
    const side = Number(btn.dataset['rudder']);
    const set = (on: boolean) => (e: PointerEvent): void => {
      e.preventDefault();
      if (on) rudderHeld.add(side);
      else rudderHeld.delete(side);
      btn.classList.toggle('is-down', on);
      controls.touch.rudder = (rudderHeld.has(1) ? 1 : 0) - (rudderHeld.has(-1) ? 1 : 0);
      controls.rudderWanted = controls.touch.rudder;
    };
    btn.addEventListener('pointerdown', set(true));
    btn.addEventListener('pointerup', set(false));
    btn.addEventListener('pointercancel', set(false));
    btn.addEventListener('pointerleave', set(false));
  }

  // Tilt steering: the phone's tilt away from where it was held when steering started moves the aim.
  let tilt = false;
  let tiltBase: { beta: number; gamma: number } | null = null;
  const onOrientation = (e: DeviceOrientationEvent): void => {
    if (!tilt || e.beta === null || e.gamma === null) return;
    // Landscape: gamma is the nose up/down tilt, beta the left/right lean (sign depends on which way it's turned).
    const landscape = (screen.orientation?.angle ?? 90) === 90 ? 1 : -1;
    const pitchDeg = e.gamma;
    const rollDeg = e.beta * landscape;
    if (!tiltBase) tiltBase = { beta: rollDeg, gamma: pitchDeg };
    const dz = (v: number): number => (Math.abs(v) < TILT_DEAD_DEG ? 0 : Math.max(-1, Math.min(1, (v - Math.sign(v) * TILT_DEAD_DEG) / TILT_FULL_DEG)));
    tiltAim.x = dz(rollDeg - tiltBase.beta);
    tiltAim.y = -dz(pitchDeg - tiltBase.gamma) * landscape;
  };
  const tiltAim = { x: 0, y: 0 };
  let tiltFrame = 0;
  let tiltLast = 0;
  const tiltTick = (t: number): void => {
    const dt = tiltLast ? Math.min(0.05, (t - tiltLast) / 1000) : 0;
    tiltLast = t;
    if (tilt && aimPointer === null && (tiltAim.x !== 0 || tiltAim.y !== 0)) controls.moveAim(tiltAim.x * 1.6 * sensitivity() * dt, tiltAim.y * 1.2 * sensitivity() * dt);
    tiltFrame = requestAnimationFrame(tiltTick);
  };

  const missileBtn = el.querySelector<HTMLButtonElement>('.tbtn--missile')!;
  const switchBtn = el.querySelector<HTMLButtonElement>('.tbtn--switch')!;
  const flareBtn = el.querySelector<HTMLButtonElement>('[data-hold="flare"]')!;
  const ringRect = el.querySelector<SVGRectElement>('.tbtn__ring rect')!;
  const missileCount = el.querySelector<HTMLElement>('[data-c="missile"]')!;
  const missileName = el.querySelector<HTMLElement>('[data-c="name"]')!;
  const flareCount = el.querySelector<HTMLElement>('[data-c="flare"]')!;
  let weaponsKey = '';
  let radarKey = '';
  radarBtn.hidden = true;

  show();
  return {
    el,
    buttons,
    takeMissilePress() {
      const t = missileTapped;
      missileTapped = false;
      return t;
    },
    takePress(what) {
      return presses.delete(what);
    },
    setWeapons(w) {
      const key = w ? `${Math.round(w.progress * 50)}|${w.locked}|${w.missiles}|${w.flares}|${w.chaff}|${w.label}|${w.canSwitch}` : 'none';
      if (key === weaponsKey) return;
      weaponsKey = key;
      ringRect.style.strokeDashoffset = String(w ? 100 - Math.round(w.progress * 100) : 100);
      missileBtn.classList.toggle('is-locked', Boolean(w?.locked));
      missileBtn.classList.toggle('is-empty', !w || w.missiles === 0);
      flareBtn.classList.toggle('is-empty', !w || w.flares + w.chaff === 0);
      missileCount.textContent = w ? `×${w.missiles}` : '';
      missileName.textContent = w?.label ?? '';
      switchBtn.hidden = !w?.canSwitch;
      flareCount.textContent = w && w.flares + w.chaff > 0 ? `×${Math.max(w.flares, w.chaff)}` : '';
    },
    setRadar(r) {
      const key = r ? `${r.locked}|${r.dogfight}|${r.on}` : 'none';
      if (key === radarKey) return;
      radarKey = key;
      radarBtn.hidden = !r;
      radarBtn.classList.toggle('is-locked', Boolean(r?.locked));
      radarSub.textContent = !r ? '' : !r.on ? 'OFF' : r.locked ? 'LOCK' : r.dogfight ? 'DGFT' : 'SRCH';
    },
    setOptions(o) {
      rudderBox.hidden = !o.rudder;
      if (o.tilt !== tilt) {
        tilt = o.tilt;
        tiltBase = null;
        if (tilt) {
          window.addEventListener('deviceorientation', onOrientation);
          tiltLast = 0;
          tiltFrame = requestAnimationFrame(tiltTick);
        } else {
          window.removeEventListener('deviceorientation', onOrientation);
          cancelAnimationFrame(tiltFrame);
        }
      }
    },
    sync() {
      show();
    },
    setPlane(next) {
      plane = next;
      tiltBase = null;
    },
    releaseAll() {
      for (const k of Object.keys(buttons) as (keyof typeof buttons)[]) buttons[k] = false;
      missileTapped = false;
      presses.clear();
      rudderHeld.clear();
      controls.rudderWanted = 0;
      controls.touch.rudder = 0;
      controls.touch.zoom = false;
      controls.touch.look = false;
      controls.zoom = false;
      for (const b of el.querySelectorAll('.is-down')) b.classList.remove('is-down');
    },
    dispose() {
      window.removeEventListener('deviceorientation', onOrientation);
      cancelAnimationFrame(tiltFrame);
      el.remove();
    },
  };
}
