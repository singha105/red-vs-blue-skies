// Settings: graphics, sensitivity, touch aim assist, volume. Saved immediately.
import { getSettings, updateSettings, type GraphicsLevel } from '../core/settings';

export function openSettings(parent: HTMLElement, opts: { isTouch: boolean }): void {
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
      <button type="button" class="btn btn--primary" data-act="close">Done</button>
    </div>
  `;
  parent.appendChild(el);

  const fmt: Record<string, (v: number) => string> = {
    sensitivity: (v) => `${v.toFixed(1)}×`,
    aimAssist: (v) => `${Math.round(v * 100)}%`,
    volume: (v) => `${Math.round(v * 100)}%`,
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
  const close = (): void => el.remove();
  el.querySelector('[data-act="close"]')!.addEventListener('click', close);
  el.addEventListener('click', (e) => {
    if (e.target === el) close();
  });
  el.querySelector<HTMLElement>('select')?.focus();
}
