// Key and gamepad bindings. Defaults live in src/data/keybinds.json; each player's changes are saved in
// localStorage (only the actions they changed), so a new default reaches everyone who didn't touch it.
// Codes: KeyboardEvent.code ("KeyW", "ShiftLeft"), "MouseLeft" / "MouseMiddle" / "MouseRight" / "Mouse4" /
// "Mouse5", and gamepad buttons by Xbox name ("A", "LB", "DpadUp"…, standard mapping).
import defaults from '../data/keybinds.json';
import { readStorage, writeStorage } from './storage';

export type Device = 'keyboard' | 'gamepad';
export type Action = keyof typeof defaults.keyboard;
export type Bindings = Record<Device, Partial<Record<Action, string[]>>>;

export const ACTIONS = Object.keys(defaults.keyboard) as Action[];
/** Actions a gamepad can't bind: the sticks steer and look, and typing needs a keyboard. */
const KEYBOARD_ONLY: readonly Action[] = ['pitchUp', 'pitchDown', 'rollLeft', 'rollRight', 'freeLook', 'chat', 'quickChat', 'map', 'pause'];
export const PAD_ACTIONS = ACTIONS.filter((a) => !KEYBOARD_ONLY.includes(a));

/** Standard-mapping button index → name (Xbox; PlayStation names in PAD_PS). */
export const PAD_BUTTONS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', 'DpadUp', 'DpadDown', 'DpadLeft', 'DpadRight'] as const;
export const PAD_PS: Record<string, string> = {
  A: 'Cross', B: 'Circle', X: 'Square', Y: 'Triangle', LB: 'L1', RB: 'R1', LT: 'L2', RT: 'R2', View: 'Touchpad', Menu: 'Options', LS: 'L3', RS: 'R3',
};

export const ACTION_LABELS: Record<Action, string> = {
  throttleUp: 'Throttle up (hold at 100% for WEP)',
  throttleDown: 'Throttle down',
  rollLeft: 'Roll left',
  rollRight: 'Roll right',
  pitchUp: 'Pitch up (direct)',
  pitchDown: 'Pitch down (direct)',
  rudderLeft: 'Rudder left',
  rudderRight: 'Rudder right',
  airbrake: 'Airbrake',
  flaps: 'Flaps',
  autoLevel: 'Auto-level',
  fireGuns: 'Guns',
  fireSecondary: 'Fire missile, rocket or bomb',
  cycleSecondary: 'Switch secondary weapon',
  selectTarget: 'Select target (again: next)',
  countermeasures: 'Flares and chaff',
  radarPower: 'Radar on / off',
  radarMode: 'Radar mode (Search / Dogfight)',
  radarRange: 'Radar range (5 / 10 / 20 km)',
  radarLock: 'Radar lock / unlock',
  freeLook: 'Free look (hold)',
  zoom: 'Zoom (hold)',
  switchView: 'Chase view / HUD view',
  scoreboard: 'Scoreboard (hold)',
  map: 'Map',
  chat: 'Chat',
  quickChat: 'Quick chat',
  menu: 'Menu',
  pause: 'Pause (solo)',
};

const KEY = 'rvbs.keybinds.v1';
const isCodeList = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 3 && v.every((x) => typeof x === 'string' && x.length > 0 && x.length < 24);

const defaultsFor = (device: Device): Partial<Record<Action, string[]>> => defaults[device] as Partial<Record<Action, string[]>>;

function load(): Bindings {
  const out: Bindings = { keyboard: {}, gamepad: {} };
  try {
    const raw = JSON.parse(readStorage(KEY) ?? '{}') as unknown;
    if (typeof raw !== 'object' || raw === null) return out;
    for (const device of ['keyboard', 'gamepad'] as const) {
      const d = (raw as Record<string, unknown>)[device];
      if (typeof d !== 'object' || d === null) continue;
      for (const a of ACTIONS) {
        const v = (d as Record<string, unknown>)[a];
        if (isCodeList(v)) out[device][a] = v;
      }
    }
  } catch {
    // Broken save: defaults.
  }
  return out;
}

let saved: Bindings = load();
let resolved: Record<Device, Record<Action, string[]>> = resolve();
const listeners = new Set<() => void>();

function resolve(): Record<Device, Record<Action, string[]>> {
  const r = { keyboard: {}, gamepad: {} } as Record<Device, Record<Action, string[]>>;
  for (const device of ['keyboard', 'gamepad'] as const) {
    const def = defaultsFor(device);
    for (const a of ACTIONS) r[device][a] = saved[device][a] ?? def[a] ?? [];
  }
  return r;
}

function commit(): void {
  writeStorage(KEY, JSON.stringify(saved));
  resolved = resolve();
  for (const fn of listeners) fn();
}

/** Codes bound to an action (resolved: the player's choice or the default). */
export const codesFor = (device: Device, action: Action): readonly string[] => resolved[device][action];
export const allBindings = (): Readonly<Record<Device, Record<Action, string[]>>> => resolved;

/** Bind `code` to `action` in `slot` (0 = primary, 1 = secondary). An empty code clears that slot. */
export function setBinding(device: Device, action: Action, slot: number, code: string): void {
  const list = [...resolved[device][action]];
  if (code === '') list.splice(slot, 1);
  else list[Math.min(slot, list.length)] = code;
  saved[device][action] = list.filter((c, i) => c && list.indexOf(c) === i).slice(0, 3);
  commit();
}

export function resetBindings(device?: Device): void {
  if (device) saved[device] = {};
  else saved = { keyboard: {}, gamepad: {} };
  commit();
}

export function onBindingsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Codes bound to more than one action, with the actions. Holds in-flight duplicates only (pure, for tests). */
export function findConflicts(b: Record<Action, readonly string[]>): Map<string, Action[]> {
  const seen = new Map<string, Action[]>();
  for (const a of ACTIONS) for (const c of b[a] ?? []) seen.set(c, [...(seen.get(c) ?? []), a]);
  for (const [c, list] of seen) if (list.length < 2) seen.delete(c);
  return seen;
}

/** "KeyW" → "W", "ShiftLeft" → "Left Shift", "MouseRight" → "Right mouse", "Digit1" → "1", "DpadUp" → "D-pad up". */
export function codeLabel(code: string, ps = false): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  const named: Record<string, string> = {
    MouseLeft: 'Left mouse', MouseMiddle: 'Middle mouse', MouseRight: 'Right mouse', Mouse4: 'Mouse 4', Mouse5: 'Mouse 5',
    ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Left Alt', AltRight: 'Right Alt',
    MetaLeft: 'Left Cmd', MetaRight: 'Right Cmd', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', Space: 'Space',
    DpadUp: 'D-pad up', DpadDown: 'D-pad down', DpadLeft: 'D-pad left', DpadRight: 'D-pad right', LS: 'Left stick click', RS: 'Right stick click',
    Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
  };
  if (ps && PAD_PS[code]) return PAD_PS[code];
  return named[code] ?? code;
}

/** Short "W / ↑" text for an action, for hints and How to play. */
export const keysText = (action: Action, device: Device = 'keyboard'): string => codesFor(device, action).map((c) => codeLabel(c)).join(' / ') || 'unbound';

/** Mouse button index (MouseEvent.button) → code. */
export const mouseCode = (button: number): string => ['MouseLeft', 'MouseMiddle', 'MouseRight', 'Mouse4', 'Mouse5'][button] ?? `Mouse${button + 1}`;
