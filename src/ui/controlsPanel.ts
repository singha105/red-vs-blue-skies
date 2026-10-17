// Controls screen: rebind every action for keyboard and mouse or for a gamepad, two slots per action. Click a
// slot, then press a key, mouse button or gamepad button (Esc clears the slot). A key bound to two actions is
// flagged; "Reset to defaults" puts that device back. Bindings save at once (src/core/keybinds.ts).
import {
  ACTION_LABELS,
  ACTIONS,
  allBindings,
  codeLabel,
  findConflicts,
  onBindingsChange,
  PAD_ACTIONS,
  resetBindings,
  setBinding,
  type Action,
  type Device,
} from '../core/keybinds';
import { getSettings, updateSettings } from '../core/settings';
import { escapeHtml as esc } from './hud';

export interface ControlsPanelOptions {
  /** Ask the input layer for the next key / button (null cancels). */
  capture(fn: ((code: string) => void) | null): void;
  isTouch: boolean;
  onClose?: () => void;
}

const GROUPS: { title: string; actions: Action[] }[] = [
  { title: 'Flying', actions: ['throttleUp', 'throttleDown', 'rollLeft', 'rollRight', 'pitchUp', 'pitchDown', 'rudderLeft', 'rudderRight', 'airbrake', 'flapsDown', 'flapsUp', 'gear', 'autoLevel'] },
  { title: 'Weapons', actions: ['fireGuns', 'fireSecondary', 'cycleSecondary', 'selectTarget', 'countermeasures'] },
  { title: 'Radar', actions: ['radarPower', 'radarMode', 'radarRange', 'radarLock'] },
  { title: 'View', actions: ['freeLook', 'lookBack', 'zoom', 'switchView'] },
  { title: 'Game', actions: ['scoreboard', 'map', 'chat', 'quickChat', 'menu', 'pause'] },
];

export function openControls(parent: HTMLElement, opts: ControlsPanelOptions): { close(): void } {
  let device: Device = 'keyboard';
  let waiting: { action: Action; slot: number } | null = null;
  const el = document.createElement('div');
  el.className = 'modal controls';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Controls');
  el.innerHTML = `
    <div class="modal__card controls__card">
      <h2>Controls</h2>
      <label class="field"><span>Mouse</span>
        <select data-k="controlMode">
          <option value="mouseAim">Mouse aim: the plane flies to the aim circle</option>
          <option value="joystick">Mouse joystick: the mouse moves the stick</option>
        </select>
      </label>
      <div class="tabs controls__tabs" role="tablist">
        <button type="button" role="tab" class="chip" data-dev="keyboard">Keyboard and mouse</button>
        <button type="button" role="tab" class="chip" data-dev="gamepad">Gamepad</button>
      </div>
      <p class="controls__note" data-k="note"></p>
      <div class="controls__list" data-testid="binding-list"></div>
      <p class="controls__warn" role="status" aria-live="polite" data-testid="binding-conflicts"></p>
      <div class="controls__foot">
        <button type="button" class="btn btn--secondary btn--small" data-act="reset" data-testid="reset-bindings">Reset to defaults</button>
        <button type="button" class="btn btn--primary" data-act="close">Done</button>
      </div>
    </div>
  `;
  parent.appendChild(el);
  const list = el.querySelector<HTMLElement>('.controls__list')!;
  const warn = el.querySelector<HTMLElement>('.controls__warn')!;
  const note = el.querySelector<HTMLElement>('[data-k="note"]')!;
  const mode = el.querySelector<HTMLSelectElement>('[data-k="controlMode"]')!;
  mode.value = getSettings().controlMode;
  mode.addEventListener('input', () => updateSettings({ controlMode: mode.value === 'joystick' ? 'joystick' : 'mouseAim' }));

  const render = (): void => {
    const b = allBindings()[device];
    const conflicts = findConflicts(b);
    const usable = device === 'gamepad' ? PAD_ACTIONS : ACTIONS;
    for (const t of el.querySelectorAll<HTMLElement>('[data-dev]')) t.setAttribute('aria-selected', String(t.dataset['dev'] === device));
    note.textContent =
      device === 'gamepad'
        ? 'Left stick steers, right stick looks around (fixed). PlayStation names are in brackets. Click a slot, then press a button on the pad.'
        : `Click a slot, then press a key or mouse button. Esc clears the slot.${opts.isTouch ? ' (For a keyboard or mouse plugged into this tablet.)' : ''}`;
    list.innerHTML = GROUPS.map((g) => {
      const rows = g.actions
        .filter((a) => usable.includes(a))
        .map((a) => {
          const codes = b[a] ?? [];
          const slots = [0, 1]
            .map((slot) => {
              const code = codes[slot];
              const isWaiting = waiting?.action === a && waiting.slot === slot;
              const clash = code && conflicts.has(code);
              const text = isWaiting ? 'Press…' : code ? codeLabel(code) + (device === 'gamepad' && codeLabel(code, true) !== codeLabel(code) ? ` [${codeLabel(code, true)}]` : '') : '—';
              return `<button type="button" class="bind${clash ? ' is-clash' : ''}${isWaiting ? ' is-waiting' : ''}" data-a="${a}" data-slot="${slot}" aria-label="${esc(ACTION_LABELS[a])}, slot ${slot + 1}: ${esc(text)}">${esc(text)}</button>`;
            })
            .join('');
          return `<div class="bind__row"><span class="bind__label">${esc(ACTION_LABELS[a])}</span>${slots}</div>`;
        })
        .join('');
      return rows ? `<h3>${g.title}</h3>${rows}` : '';
    }).join('');
    warn.textContent = [...conflicts.entries()].map(([code, acts]) => `${codeLabel(code)} is bound to ${acts.map((x) => ACTION_LABELS[x].replace(/ \(.*\)$/, '')).join(' and ')}.`).join(' ');
  };

  el.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button, [data-dev]');
    if (!t) {
      if (e.target === el) close();
      return;
    }
    if (t.dataset['dev']) {
      device = t.dataset['dev'] as Device;
      waiting = null;
      opts.capture(null);
      render();
      return;
    }
    if (t.dataset['act'] === 'reset') {
      resetBindings(device);
      return;
    }
    if (t.dataset['act'] === 'close') {
      close();
      return;
    }
    const a = t.dataset['a'] as Action | undefined;
    if (!a) return;
    const slot = Number(t.dataset['slot']);
    waiting = { action: a, slot };
    render();
    const dev = device;
    // Wait for the click itself to finish, or it would be captured as "Left mouse".
    window.setTimeout(() => {
      opts.capture((code) => {
        const isPad = !code.startsWith('Key') && !code.startsWith('Mouse') && !code.startsWith('Digit') && /^[A-Z][A-Za-z]*$/.test(code) && ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', 'DpadUp', 'DpadDown', 'DpadLeft', 'DpadRight'].includes(code);
        waiting = null;
        // A key pressed on the gamepad tab (or a pad button on the keyboard tab) is ignored.
        if (code !== '' && isPad !== (dev === 'gamepad')) {
          render();
          return;
        }
        setBinding(dev, a, slot, code);
      });
    }, 0);
  });

  const off = onBindingsChange(render);
  render();
  const close = (): void => {
    opts.capture(null);
    off();
    el.remove();
    opts.onClose?.();
  };
  return { close };
}
