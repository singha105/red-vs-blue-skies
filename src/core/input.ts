// Desktop devices: mouse (pointer lock), keyboard and gamepad, all feeding PlayerControls.
//
// Mouse: move = aim, left button = fire, right button = missile.
// Keys: W/S throttle, A/D roll override, C (hold) free-look, Space fire, Q missile, F flare, L auto-level,
// arrow keys = direct pitch/roll for players without a mouse.
// Gamepad: left stick aims, right trigger / left trigger raise / lower throttle, A fire, B missile, X flare,
// Y auto-level, right stick free-look.
import type { PlaneState } from '../game/flight';
import type { PlayerControls } from './playerControls';

const MOUSE_RAD_PER_PX = 0.0022;
const PAD_RAD_PER_S = 1.9;
const CURSOR_RAD_PER_S = 1.6;
const THROTTLE_PER_S = 0.6;
const DEADZONE = 0.15;

export interface DesktopInput {
  /** Call every rendered frame. */
  update(dt: number, plane: PlaneState | null): void;
  readonly pointerLocked: boolean;
  /** Pointer lock was refused, so the cursor-offset fallback is steering. */
  readonly cursorSteering: boolean;
  readonly gamepadConnected: boolean;
  /** Weapon buttons held on desktop devices this frame; main combines them with touch. */
  readonly buttons: Readonly<{ fire: boolean; missile: boolean; flare: boolean }>;
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

export function createDesktopInput(canvas: HTMLCanvasElement, controls: PlayerControls, sensitivity: () => number): DesktopInput {
  const keys = new Set<string>();
  let enabled = false;
  let locked = false;
  let padConnected = false;
  let autoLevelQueued = false;
  let padButtons: boolean[] = [];
  // If the browser refuses pointer lock (some embedded views and iframes), steer by how far the cursor
  // sits from the screen centre instead, like a joystick.
  let lockRefused = false;
  const cursor = { x: 0, y: 0, inside: false };
  let mouseFire = false;
  let mouseMissile = false;
  const buttons = { fire: false, missile: false, flare: false };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (!enabled) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    keys.add(e.code);
    if (e.code === 'KeyL') autoLevelQueued = true;
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    keys.delete(e.code);
  };
  const onBlur = (): void => {
    keys.clear();
    mouseFire = false;
    mouseMissile = false;
  };
  const onMouseMove = (e: MouseEvent): void => {
    if (!enabled || !locked) return;
    const k = MOUSE_RAD_PER_PX * sensitivity();
    controls.moveAim(e.movementX * k, -e.movementY * k);
  };
  const onPointerDown = (e: PointerEvent): void => {
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
    if (e.button === 0) mouseFire = true;
    if (e.button === 2) mouseMissile = true;
  };
  const onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse') return;
    if (e.button === 0) mouseFire = false;
    if (e.button === 2) mouseMissile = false;
  };
  const onLockChange = (): void => {
    locked = document.pointerLockElement === canvas;
    if (!locked) {
      mouseFire = false;
      mouseMissile = false;
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
    setEnabled(next) {
      enabled = next;
      if (!next) {
        keys.clear();
        if (locked) document.exitPointerLock?.();
      }
    },
    update(dt, plane) {
      if (!enabled) return;
      const down = (code: string): boolean => keys.has(code);

      let throttleRate = (down('KeyW') ? 1 : 0) - (down('KeyS') ? 1 : 0);
      let fire = down('Space');
      let missile = down('KeyQ');
      let flare = down('KeyF');
      let freeLook = down('KeyC');

      // Arrow keys fly the plane directly; A/D override roll on top of mouse aim.
      const pitch = (down('ArrowUp') ? 1 : 0) - (down('ArrowDown') ? 1 : 0);
      const roll = (down('ArrowRight') || down('KeyD') ? 1 : 0) - (down('ArrowLeft') || down('KeyA') ? 1 : 0);
      controls.override.pitch = pitch;
      controls.override.roll = roll;
      controls.override.yaw = 0;

      const pad = navigator.getGamepads?.().find((p) => p !== null) ?? null;
      let padAim: [number, number] = [0, 0];
      let padLook: [number, number] = [0, 0];
      if (pad) {
        padConnected = true;
        padAim = [axis(pad.axes[0]), -axis(pad.axes[1])];
        padLook = [axis(pad.axes[2]), -axis(pad.axes[3])];
        throttleRate += (pad.buttons[7]?.value ?? 0) - (pad.buttons[6]?.value ?? 0);
        const b = pad.buttons.map((x) => x.pressed);
        fire = fire || Boolean(b[0]);
        missile = missile || Boolean(b[1]);
        flare = flare || Boolean(b[2]);
        if (b[3] && !padButtons[3]) autoLevelQueued = true;
        padButtons = b;
      }
      if (!locked && lockRefused && cursor.inside) {
        const ox = (cursor.x - window.innerWidth / 2) / (window.innerWidth / 2);
        const oy = (cursor.y - window.innerHeight / 2) / (window.innerHeight / 2);
        const dz = (v: number): number => (Math.abs(v) < 0.06 ? 0 : v - Math.sign(v) * 0.06);
        const k = CURSOR_RAD_PER_S * sensitivity() * dt;
        controls.moveAim(dz(ox) * k, -dz(oy) * k * 0.8);
      }
      const padLooking = padLook[0] !== 0 || padLook[1] !== 0;
      controls.freeLook = freeLook || padLooking;
      const k = PAD_RAD_PER_S * sensitivity() * dt;
      if (padLooking) controls.moveAim(padLook[0] * k * 1.4, padLook[1] * k * 1.4);
      else if (padAim[0] !== 0 || padAim[1] !== 0) controls.moveAim(padAim[0] * k, padAim[1] * k);

      if (!controls.freeLook) {
        controls.look.yaw = 0;
        controls.look.pitch = 0;
      }
      if (throttleRate !== 0) controls.setThrottle(controls.throttle + throttleRate * THROTTLE_PER_S * dt);
      buttons.fire = fire || mouseFire;
      buttons.missile = missile || mouseMissile;
      buttons.flare = flare;
      if (autoLevelQueued && plane) controls.autoLevel(plane);
      autoLevelQueued = false;
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
