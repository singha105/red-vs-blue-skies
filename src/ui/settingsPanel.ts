// Settings: graphics, sensitivity, touch aim assist, volume per sound bus (saved immediately), and your account: progress
// lives on an anonymous Firebase account until you link Google, which carries it to other devices.
import { getSettings, updateSettings, type GraphicsLevel } from '../core/settings';

export interface AccountControls {
  /** One line: who you're signed in as and whether progress is synced. */
  describe(): string;
  canLink(): boolean;
  link(): Promise<string>;
  onChange(fn: () => void): () => void;
}

export function openSettings(parent: HTMLElement, opts: { isTouch: boolean; account?: AccountControls }): void {
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
      <label class="field"><span>Aim sensitivity <output data-o="sensitivity">${s.sensitivity.toFixed(1)}×</output></span>
        <input type="range" data-k="sensitivity" min="0.2" max="3" step="0.1" value="${s.sensitivity}" />
      </label>
      <label class="field"><span>Touch aim assist <output data-o="aimAssist">${Math.round(s.aimAssist * 100)}%</output></span>
        <input type="range" data-k="aimAssist" min="0" max="1" step="0.05" value="${s.aimAssist}" />
        <small>${opts.isTouch ? 'Bends your bullets slightly toward enemies within 2° of your aim. 0% turns it off.' : 'Only applies when playing on a touch screen.'}</small>
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
      <small class="field__note">Sound starts on your first tap or key press. On iPhone it plays even with the silent switch on; use these sliders instead.</small>
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
  };
  el.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const k = t.dataset['k'];
    if (!k) return;
    if (k === 'graphics') updateSettings({ graphics: t.value as GraphicsLevel });
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
  };
  el.querySelector('[data-act="close"]')!.addEventListener('click', close);
  el.addEventListener('click', (e) => {
    if (e.target === el) close();
  });
  el.querySelector<HTMLElement>('select')?.focus();
}
