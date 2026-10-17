// Settings: graphics and the 30 fps cap, controls (sensitivity, invert pitch, touch aim assist), display (HUD size,
// colour-blind team colours), volume per sound bus (all saved immediately), the tutorial again, and your account:
// progress lives on an anonymous Firebase account until you link Google, which carries it to other devices.
import { getSettings, updateSettings, type GraphicsLevel } from '../core/settings';
import { requestTiltPermission } from './touchControls';

export interface AccountControls {
  /** One line: who you're signed in as and whether progress is synced. */
  describe(): string;
  canLink(): boolean;
  link(): Promise<string>;
  onChange(fn: () => void): () => void;
}

export function openSettings(parent: HTMLElement, opts: { isTouch: boolean; account?: AccountControls; onTutorial?: () => void; onControls?: () => void; onClose?: () => void }): void {
  const s = getSettings();
  const el = document.createElement('div');
  el.className = 'modal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Settings');
  const levels: [GraphicsLevel, string][] = [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']];
  el.innerHTML = `
    <div class="modal__card">
      <h2>Settings</h2>
      <label class="field"><span>Graphics</span>
        <select data-k="graphics">${levels.map(([v, l]) => `<option value="${v}" ${v === s.graphics ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </label>
      <label class="field"><span>Frame rate</span>
        <select data-k="cap30">
          <option value="0" ${s.cap30 ? '' : 'selected'}>As fast as the screen allows</option>
          <option value="1" ${s.cap30 ? 'selected' : ''}>30 fps (saves battery)</option>
        </select>
      </label>
      <label class="field"><span>Aim sensitivity <output data-o="sensitivity">${s.sensitivity.toFixed(1)}×</output></span>
        <input type="range" data-k="sensitivity" min="0.2" max="3" step="0.1" value="${s.sensitivity}" />
      </label>
      <label class="field"><span>Pitch</span>
        <select data-k="invertPitch">
          <option value="0" ${s.invertPitch ? '' : 'selected'}>Normal: up moves the nose up</option>
          <option value="1" ${s.invertPitch ? 'selected' : ''}>Inverted: up moves the nose down</option>
        </select>
      </label>
      ${opts.onControls ? '<button type="button" class="btn btn--secondary btn--small" data-act="controls" data-testid="open-controls">Controls and key bindings</button>' : ''}
      <label class="field"><span>Mouse</span>
        <select data-k="controlMode">
          <option value="mouseAim" ${s.controlMode === 'mouseAim' ? 'selected' : ''}>Mouse aim (the plane flies to the aim circle)</option>
          <option value="joystick" ${s.controlMode === 'joystick' ? 'selected' : ''}>Mouse joystick (the mouse moves the stick)</option>
        </select>
      </label>
      <label class="field"><span>Flight model</span>
        <select data-k="flightModel" data-testid="flight-model">
          <option value="arcade" ${s.flightModel === 'arcade' ? 'selected' : ''}>Arcade (the stick turns the plane)</option>
          <option value="realistic" ${s.flightModel === 'realistic' ? 'selected' : ''}>Realistic (control surfaces, stalls, slip; solo)</option>
        </select>
      </label>
      <label class="field"><span>Units</span>
        <select data-k="units">
          <option value="imperial" ${s.units === 'imperial' ? 'selected' : ''}>Knots and feet</option>
          <option value="metric" ${s.units === 'metric' ? 'selected' : ''}>km/h and metres</option>
        </select>
      </label>
      <label class="field"><span>Touch extras</span>
        <select data-k="touchRudder">
          <option value="0" ${s.touchRudder ? '' : 'selected'}>No rudder buttons</option>
          <option value="1" ${s.touchRudder ? 'selected' : ''}>Rudder buttons</option>
        </select>
        <select data-k="tiltSteer" data-testid="tilt-select">
          <option value="0" ${s.tiltSteer ? '' : 'selected'}>Steer by dragging</option>
          <option value="1" ${s.tiltSteer ? 'selected' : ''}>Steer by tilting the phone too</option>
        </select>
        <small class="tilt__msg" role="status" aria-live="polite">${opts.isTouch ? 'Tilt steering asks for motion access on iPhone.' : 'Rudder buttons and tilt steering are for touch screens.'}</small>
      </label>
      <label class="field"><span>Touch aim assist <output data-o="aimAssist">${Math.round(s.aimAssist * 100)}%</output></span>
        <input type="range" data-k="aimAssist" min="0" max="1" step="0.05" value="${s.aimAssist}" />
        <small>${opts.isTouch ? 'Bends your bullets slightly toward enemies within 2° of your aim. 0% turns it off.' : 'Only applies when playing on a touch screen.'}</small>
      </label>
      <label class="field"><span>HUD size <output data-o="hudScale">${Math.round(s.hudScale * 100)}%</output></span>
        <input type="range" data-k="hudScale" min="1" max="1.6" step="0.05" value="${s.hudScale}" />
      </label>
      <label class="field"><span>Team colours</span>
        <select data-k="teamColours">
          <option value="classic" ${s.teamColours === 'classic' ? 'selected' : ''}>Blue and red</option>
          <option value="colourblind" ${s.teamColours === 'colourblind' ? 'selected' : ''}>Blue and orange (colour-blind safe)</option>
        </select>
      </label>
      <label class="field"><span>Volume <output data-o="volume">${Math.round(s.volume * 100)}%</output></span>
        <input type="range" data-k="volume" min="0" max="1" step="0.05" value="${s.volume}" />
      </label>
      <div class="field field--row">
        ${(
          [
            ['engineVolume', 'Engines'],
            ['effectsVolume', 'Guns and explosions'],
            ['cockpitVolume', 'Warnings and clicks'],
          ] as const
        )
          .map(
            ([k, label]) => `<label class="field"><span>${label} <output data-o="${k}">${Math.round(s[k] * 100)}%</output></span>
          <input type="range" data-k="${k}" min="0" max="1" step="0.05" value="${s[k]}" /></label>`,
          )
          .join('')}
      </div>
      <small class="field__note">Sound starts on your first tap or key press. On iPhone it plays even with the silent switch on; use these sliders instead. Every warning sound also shows on screen.</small>
      ${opts.onTutorial ? '<button type="button" class="btn btn--secondary btn--small" data-act="tutorial">Play the tutorial again</button>' : ''}
      ${
        opts.account
          ? `<div class="field account"><span>Account</span>
              <small class="account__who" data-testid="account"></small>
              <button type="button" class="btn btn--secondary btn--small" data-act="link" hidden>Link Google account</button>
              <small class="account__msg" role="status" aria-live="polite"></small>
            </div>`
          : ''
      }
      <button type="button" class="btn btn--primary" data-act="close">Done</button>
    </div>
  `;
  parent.appendChild(el);

  const fmt: Record<string, (v: number) => string> = {
    sensitivity: (v) => `${v.toFixed(1)}×`,
    aimAssist: (v) => `${Math.round(v * 100)}%`,
    volume: (v) => `${Math.round(v * 100)}%`,
    engineVolume: (v) => `${Math.round(v * 100)}%`,
    effectsVolume: (v) => `${Math.round(v * 100)}%`,
    cockpitVolume: (v) => `${Math.round(v * 100)}%`,
    hudScale: (v) => `${Math.round(v * 100)}%`,
  };
  el.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const k = t.dataset['k'];
    if (!k) return;
    if (k === 'graphics') updateSettings({ graphics: t.value as GraphicsLevel });
    else if (k === 'cap30' || k === 'invertPitch' || k === 'touchRudder') updateSettings({ [k]: t.value === '1' });
    else if (k === 'controlMode') updateSettings({ controlMode: t.value === 'joystick' ? 'joystick' : 'mouseAim' });
    else if (k === 'units') updateSettings({ units: t.value === 'metric' ? 'metric' : 'imperial' });
    else if (k === 'flightModel') updateSettings({ flightModel: t.value === 'realistic' ? 'realistic' : 'arcade' });
    else if (k === 'tiltSteer') {
      if (t.value !== '1') updateSettings({ tiltSteer: false });
      else {
        // iPhone only sends motion after a permission prompt from this tap.
        const msg = el.querySelector<HTMLElement>('.tilt__msg');
        void requestTiltPermission().then((ok) => {
          updateSettings({ tiltSteer: ok });
          if (!ok) t.value = '0';
          if (msg) msg.textContent = ok ? 'Tilt steering is on: tilt to steer, drag still works.' : 'Motion access was refused or isn\'t available, so tilt steering stays off.';
        });
      }
    }
    else if (k === 'teamColours') updateSettings({ teamColours: t.value === 'colourblind' ? 'colourblind' : 'classic' });
    else {
      const v = Number(t.value);
      updateSettings({ [k]: v });
      const out = el.querySelector(`[data-o="${k}"]`);
      if (out) out.textContent = fmt[k]?.(v) ?? String(v);
    }
  });
  const acc = opts.account;
  const who = el.querySelector<HTMLElement>('.account__who');
  const linkBtn = el.querySelector<HTMLButtonElement>('[data-act="link"]');
  const msg = el.querySelector<HTMLElement>('.account__msg');
  const showAccount = (): void => {
    if (!acc || !who || !linkBtn) return;
    who.textContent = acc.describe();
    linkBtn.hidden = !acc.canLink();
  };
  const off = acc?.onChange(showAccount);
  showAccount();
  // The popup has to open straight from the tap (iPhone Safari blocks it otherwise), so no await before link().
  linkBtn?.addEventListener('click', () => {
    if (!acc || !msg) return;
    linkBtn.disabled = true;
    msg.textContent = 'Opening Google sign-in…';
    void acc.link().then((text) => {
      msg.textContent = text;
      linkBtn.disabled = false;
      showAccount();
    });
  });
  const close = (): void => {
    off?.();
    el.remove();
    opts.onClose?.();
  };
  el.querySelector('[data-act="controls"]')?.addEventListener('click', () => {
    close();
    opts.onControls?.();
  });
  el.querySelector('[data-act="close"]')!.addEventListener('click', close);
  el.querySelector('[data-act="tutorial"]')?.addEventListener('click', () => {
    close();
    opts.onTutorial?.();
  });
  el.addEventListener('click', (e) => {
    if (e.target === el) close();
  });
  el.querySelector<HTMLElement>('select')?.focus();
}
