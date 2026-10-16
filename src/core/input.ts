// Desktop devices: mouse (pointer lock), keyboard and gamepad, all feeding PlayerControls through the player's
// bindings (src/core/keybinds.ts, defaults in src/data/keybinds.json).
//
// Flying actions (throttle, roll, pitch, rudder, guns, missile, flares, free look, zoom, airbrake on the
// throttle-down trigger) are applied here every frame. One-shot actions (radar, views, target select, menu,
// map, chat…) are queued and read by main with takePress(), because they need the match and the plane.
// Sticks are fixed: left stick steers, right stick looks around.
import type { PlaneState } from '../game/flight';
import { ACTIONS, codesFor, mouseCode, PAD_BUTTONS, type Action } from './keybinds';
import type { PlayerControls } from './playerControls';

const MOUSE_RAD_PER_PX = 0.0022;
const PAD_RAD_PER_S = 1.9;
const CURSOR_RAD_PER_S = 1.6;
const THROTTLE_PER_S = 0.6;
const DEADZONE = 0.15;
/** An analog trigger counts as pressed past this. */
const TRIGGER_ON = 0.3;

/** Actions main reads once per press. */
export type PressAction = Extract<
  Action,
  | 'autoLevel' | 'airbrake' | 'flaps' | 'cycleSecondary' | 'selectTarget' | 'radarPower' | 'radarMode' | 'radarRange' | 'radarLock'
  | 'switchView' | 'scoreboard' | 'map' | 'chat' | 'quickChat' | 'menu' | 'pause' | 'fireSecondary'
>;
const PRESS_ACTIONS: readonly PressAction[] = [
  'autoLevel', 'airbrake', 'flaps', 'cycleSecondary', 'selectTarget', 'radarPower', 'radarMode', 'radarRange', 'radarLock',
  'switchView', 'scoreboard', 'map', 'chat', 'quickChat', 'menu', 'pause', 'fireSecondary',
];

export interface DesktopInput {
  /** Call every rendered frame. */
  update(dt: number, plane: PlaneState | null): void;
  readonly pointerLocked: boolean;
  /** Pointer lock was refused, so the cursor-offset fallback is steering. */
  readonly cursorSteering: boolean;
  readonly gamepadConnected: boolean;
  /** Weapon buttons held on desktop devices this frame; main combines them with touch. */
  readonly buttons: Readonly<{ fire: boolean; missile: boolean; flare: boolean }>;
  /** Is a bound key or button for this action held right now? */
  held(action: Action): boolean;
  /** True once per press of a one-shot action since the last call. */
  takePress(action: PressAction): boolean;
  /** Mouse was released by the browser (Esc, or the tab lost focus) while flying: main shows the menu. */
  takeLockLost(): boolean;
  /** While a text box (chat) is focused, keys type instead of flying. */
  setTyping(typing: boolean): void;
  /** Capture the next key or button for the Controls screen instead of acting on it. */
  captureNext(fn: ((code: string) => void) | null): void;
  setEnabled(enabled: boolean): void;
  /** Drop held keys and mouse buttons (the tab went to the background; no keyup will come). */
  releaseAll(): void;
  /** Leave pointer lock without it counting as "lock lost" (menus, leaving the match). */
  exitLock(): void;
  dispose(): void;
}

export function createDesktopInput(canvas: HTMLCanvasElement, controls: PlayerControls, sensitivity: () => number): DesktopInput {
  const held = new Set<string>();
  const pressed = new Set<PressAction>();
  let enabled = false;
  let typing = false;
  let locked = false;
  let ownExit = false;
  let lockLost = false;
  let padConnected = false;
  let padPrev = new Set<string>();
  let capture: ((code: string) => void) | null = null;
  // If the browser refuses pointer lock (some embedded views and iframes), steer by how far the cursor
  // sits from the screen centre instead, like a joystick.
  let lockRefused = false;
  const cursor = { x: 0, y: 0, inside: false };
  const buttons = { fire: false, missile: false, flare: false };

  const actionsFor = (code: string, device: 'keyboard' | 'gamepad'): PressAction[] => PRESS_ACTIONS.filter((a) => codesFor(device, a).includes(code));
  const bound = (code: string): boolean => ACTIONS.some((a) => codesFor('keyboard', a).includes(code));

  const down = (code: string, repeat: boolean): void => {
    held.add(code);
    if (repeat) return;
    for (const a of actionsFor(code, 'keyboard')) pressed.add(a);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (capture) {
      e.preventDefault();
      const fn = capture;
      capture = null;
      fn(e.code === 'Escape' ? '' : e.code);
      return;
    }
    if (!enabled || typing) return;
    const flightKey = ['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code);
    if (flightKey || bound(e.code)) e.preventDefault();
    down(e.code, e.repeat);
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    held.delete(e.code);
  };
  const onBlur = (): void => {
    held.clear();
  };
  const onMouseMove = (e: MouseEvent): void => {
    if (!enabled || !locked || typing) return;
    const k = MOUSE_RAD_PER_PX * sensitivity();
    controls.moveAim(e.movementX * k, -e.movementY * k);
  };
  const onPointerDown = (e: PointerEvent): void => {
    if (capture && e.pointerType === 'mouse') {
      e.preventDefault();
      const fn = capture;
      capture = null;
      fn(mouseCode(e.button));
      return;
    }
    if (!enabled || e.pointerType !== 'mouse') return;
    if (!locked && !lockRefused) {
      // First click only captures the mouse; it doesn't fire.
      try {
        const req = canvas.requestPointerLock?.() as Promise<void> | undefined;
        req?.catch?.(() => {
          lockRefused = true;
        });
      } catch {
        lockRefused = true;
      }
      return;
    }
    if (e.button === 1) e.preventDefault(); // no autoscroll on middle click
    down(mouseCode(e.button), false);
  };
  const onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse') return;
    held.delete(mouseCode(e.button));
  };
  const onLockChange = (): void => {
    const was = locked;
    locked = document.pointerLockElement === canvas;
    if (!locked) {
      for (const c of [...held]) if (c.startsWith('Mouse')) held.delete(c);
      if (was && enabled && !ownExit) lockLost = true;
      ownExit = false;
    }
  };
  const onLockError = (): void => {
    lockRefused = true;
  };
  const onCursor = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse') return;
    cursor.x = e.clientX;
    cursor.y = e.clientY;
    cursor.inside = e.type !== 'pointerleave';
  };
  const onContextMenu = (e: Event): void => {
    if (enabled) e.preventDefault();
  };
  const onPad = (): void => {
    padConnected = navigator.getGamepads?.().some((p) => p !== null) ?? false;
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerdown', (e) => {
    // The Controls screen captures mouse buttons anywhere on the page.
    if (capture && e.target !== canvas) onPointerDown(e);
  });
  window.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointerlockchange', onLockChange);
  document.addEventListener('pointerlockerror', onLockError);
  canvas.addEventListener('pointermove', onCursor);
  canvas.addEventListener('pointerleave', onCursor);
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('gamepadconnected', onPad);
  window.addEventListener('gamepaddisconnected', onPad);

  const axis = (v: number | undefined): number => {
    const x = v ?? 0;
    return Math.abs(x) < DEADZONE ? 0 : (x - Math.sign(x) * DEADZONE) / (1 - DEADZONE);
  };

  /** Gamepad buttons held this frame (by name) and their analog values. */
  const padHeld = new Set<string>();
  const padValue = new Map<string, number>();
  const readPad = (pad: Gamepad | null): void => {
    padHeld.clear();
    padValue.clear();
    if (!pad) return;
    PAD_BUTTONS.forEach((name, i) => {
      const b = pad.buttons[i];
      const v = b ? (name === 'LT' || name === 'RT' ? b.value : b.pressed ? 1 : 0) : 0;
      padValue.set(name, v);
      if (v > TRIGGER_ON || b?.pressed) padHeld.add(name);
    });
    if (capture) {
      const fresh = [...padHeld].find((n) => !padPrev.has(n));
      if (fresh) {
        const fn = capture;
        capture = null;
        fn(fresh);
      }
    } else if (enabled) {
      for (const name of padHeld) {
        if (padPrev.has(name)) continue;
        for (const a of actionsFor(name, 'gamepad')) pressed.add(a);
      }
    }
    padPrev = new Set(padHeld);
  };

  const isHeld = (action: Action): boolean => codesFor('keyboard', action).some((c) => held.has(c)) || codesFor('gamepad', action).some((c) => padHeld.has(c));
  /** Strongest analog value of the gamepad buttons bound to an action (triggers are analog, the rest 0/1). */
  const padAmount = (action: Action): number => Math.max(0, ...codesFor('gamepad', action).map((c) => padValue.get(c) ?? 0).filter((v) => v > 0.05));

  return {
    buttons,
    get pointerLocked() {
      return locked;
    },
    get cursorSteering() {
      return lockRefused && !locked;
    },
    get gamepadConnected() {
      return padConnected;
    },
    held: isHeld,
    takePress(action) {
      const q = pressed.has(action);
      pressed.delete(action);
      return q;
    },
    takeLockLost() {
      const q = lockLost;
      lockLost = false;
      return q;
    },
    setTyping(next) {
      typing = next;
      if (next) held.clear();
    },
    captureNext(fn) {
      capture = fn;
    },
    releaseAll() {
      onBlur();
      pressed.clear();
      buttons.fire = buttons.missile = buttons.flare = false;
    },
    exitLock() {
      if (!locked) return;
      ownExit = true;
      document.exitPointerLock?.();
    },
    setEnabled(next) {
      enabled = next;
      if (!next) {
        held.clear();
        pressed.clear();
        if (locked) {
          ownExit = true;
          document.exitPointerLock?.();
        }
      }
    },
    update(dt, plane) {
      const pad = navigator.getGamepads?.().find((p) => p !== null) ?? null;
      if (pad) padConnected = true;
      readPad(pad);
      if (!enabled) return;

      const kb = (a: Action): boolean => codesFor('keyboard', a).some((c) => held.has(c));
      // Throttle: keys at a fixed rate, triggers by how far they're pulled.
      const up = Math.max(kb('throttleUp') ? 1 : 0, padAmount('throttleUp'));
      const downAmt = Math.max(kb('throttleDown') ? 1 : 0, padAmount('throttleDown'));
      if (up > 0 && downAmt === 0) controls.throttleUp(dt, THROTTLE_PER_S * up);
      else if (downAmt > 0 && up === 0) controls.throttleDown(dt, THROTTLE_PER_S * downAmt);
      // The gamepad's throttle-down trigger doubles as the airbrake once the throttle is at idle.
      controls.airbrakeHeld = codesFor('gamepad', 'throttleDown').some((c) => padHeld.has(c)) && controls.throttle <= 0.001;

      // Direct pitch keys and roll keys override the autopilot on that axis.
      const pitch = (kb('pitchUp') ? 1 : 0) - (kb('pitchDown') ? 1 : 0);
      const roll = (kb('rollRight') ? 1 : 0) - (kb('rollLeft') ? 1 : 0);
      controls.override.pitch = controls.invertPitch ? -pitch : pitch;
      controls.override.roll = roll;
      controls.override.yaw = 0;
      controls.rudderWanted = Math.max(-1, Math.min(1, (isHeld('rudderRight') ? 1 : 0) - (isHeld('rudderLeft') ? 1 : 0) + controls.touch.rudder));

      let padAim: [number, number] = [0, 0];
      let padLook: [number, number] = [0, 0];
      if (pad) {
        padAim = [axis(pad.axes[0]), -axis(pad.axes[1])];
        padLook = [axis(pad.axes[2]), -axis(pad.axes[3])];
      }
      if (!locked && lockRefused && cursor.inside && !typing) {
        const ox = (cursor.x - window.innerWidth / 2) / (window.innerWidth / 2);
        const oy = (cursor.y - window.innerHeight / 2) / (window.innerHeight / 2);
        const dz = (v: number): number => (Math.abs(v) < 0.06 ? 0 : v - Math.sign(v) * 0.06);
        const k = CURSOR_RAD_PER_S * sensitivity() * dt;
        controls.moveAim(dz(ox) * k, -dz(oy) * k * 0.8);
      }
      const padLooking = padLook[0] !== 0 || padLook[1] !== 0;
      controls.freeLook = isHeld('freeLook') || padLooking || controls.touch.look;
      const k = PAD_RAD_PER_S * sensitivity() * dt;
      if (padLooking) controls.moveAim(padLook[0] * k * 1.4, padLook[1] * k * 1.4);
      else if (padAim[0] !== 0 || padAim[1] !== 0) controls.moveAim(padAim[0] * k, padAim[1] * k);
      if (!controls.freeLook) {
        controls.look.yaw = 0;
        controls.look.pitch = 0;
      }
      controls.zoom = isHeld('zoom') || controls.touch.zoom;

      buttons.fire = isHeld('fireGuns');
      buttons.missile = isHeld('fireSecondary');
      buttons.flare = isHeld('countermeasures');
      if (plane && pressed.has('autoLevel')) {
        pressed.delete('autoLevel');
        controls.autoLevel(plane);
      }
      if (pressed.delete('airbrake')) controls.airbrake = !controls.airbrake;
      if (pressed.delete('flaps')) controls.flaps = !controls.flaps;
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('pointerlockerror', onLockError);
      canvas.removeEventListener('pointermove', onCursor);
      canvas.removeEventListener('pointerleave', onCursor);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('gamepadconnected', onPad);
      window.removeEventListener('gamepaddisconnected', onPad);
    },
  };
}
