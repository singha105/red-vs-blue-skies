// The missile half of the cockpit: target box and lock box, missile and countermeasure counts, the
// radar-warning display (threat directions around your plane), and the red launch warning that also says
// which counter to use. Lives inside the HUD element; DOM writes only happen when a shown value changes.

export type ThreatKind = 'spike' | 'lock' | 'missile';

export interface WeaponsFrame {
  /** The plane you're locking (or have picked), on screen. `locked` once the seeker tone goes steady. */
  lock: null | { x: number; y: number; progress: number; locked: boolean; radar: boolean; inRange: boolean };
  /** You picked a target that the seeker can't see yet. */
  picked: null | { x: number; y: number };
  loadout: { label: string; count: number; active: boolean }[];
  flares: number;
  chaff: number;
  /** Threats around you: angle in radians from the nose, clockwise seen from above. */
  rwr: { angle: number; kind: ThreatKind }[];
  /** Inbound missile seekers (for the warning text), or null when nothing is inbound. */
  warning: null | { ir: boolean; radar: boolean };
}

const MAX_THREATS = 8;

export interface MissileHud {
  update(f: WeaponsFrame | null, alive: boolean): void;
}

export function createMissileHud(parent: HTMLElement): MissileHud {
  const wrap = document.createElement('div');
  wrap.className = 'mhud';
  wrap.innerHTML = `
    <div class="mhud__pick" aria-hidden="true"></div>
    <div class="mhud__lock" data-testid="lock-box" aria-hidden="true"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" pathLength="100" /></svg></div>
    <div class="mhud__rwr" data-testid="rwr" aria-label="Radar warning">
      <i class="mhud__rwr-me"></i>${'<i class="mhud__threat"></i>'.repeat(MAX_THREATS)}
    </div>
    <div class="mhud__launch" data-testid="launch-warning" role="alert" hidden></div>
    <div class="mhud__load" data-testid="loadout"></div>
  `;
  parent.appendChild(wrap);
  const q = <T extends Element>(sel: string): T => wrap.querySelector<T>(sel)!;
  const pick = q<HTMLElement>('.mhud__pick');
  const lock = q<HTMLElement>('.mhud__lock');
  const ring = q<SVGCircleElement>('.mhud__lock circle');
  const rwr = q<HTMLElement>('.mhud__rwr');
  const threats = [...wrap.querySelectorAll<HTMLElement>('.mhud__threat')];
  const launch = q<HTMLElement>('.mhud__launch');
  const load = q<HTMLElement>('.mhud__load');
  const last: Record<string, string> = {};
  const changed = (k: string, v: string): boolean => {
    if (last[k] === v) return false;
    last[k] = v;
    return true;
  };
  const place = (node: HTMLElement, p: { x: number; y: number } | null): void => {
    node.style.visibility = p ? 'visible' : 'hidden';
    if (p) node.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%)`;
  };

  return {
    update(f, alive) {
      const show = Boolean(f && alive);
      if (changed('show', String(show))) wrap.hidden = !show;
      if (!f || !show) return;
      const hasMissiles = f.loadout.length > 0;
      rwr.hidden = !hasMissiles && f.flares + f.chaff === 0;

      place(pick, f.picked);
      place(lock, f.lock);
      if (f.lock) {
        const state = f.lock.locked ? (f.lock.inRange ? 'locked' : 'far') : 'locking';
        if (changed('lockState', `${state}|${f.lock.radar}`)) lock.className = `mhud__lock is-${state}${f.lock.radar ? ' is-radar' : ''}`;
        const pct = String(Math.round(f.lock.progress * 100));
        if (changed('lockPct', pct)) ring.style.strokeDashoffset = String(100 - Number(pct));
      }

      for (let i = 0; i < MAX_THREATS; i++) {
        const t = f.rwr[i];
        const node = threats[i]!;
        if (!t) {
          if (node.style.display !== 'none') node.style.display = 'none';
          continue;
        }
        node.style.display = '';
        node.className = `mhud__threat is-${t.kind}`;
        node.style.transform = `rotate(${t.angle.toFixed(2)}rad) translateY(calc(var(--r) * -1))`;
      }

      const warn = f.warning ? (f.warning.ir && f.warning.radar ? 'MISSILE · flares + chaff, turn hard' : f.warning.radar ? 'MISSILE · radar: chaff, turn 90° to it' : 'MISSILE · IR: flares, cut throttle, turn') : '';
      if (changed('warn', warn)) {
        launch.hidden = warn === '';
        launch.textContent = warn;
      }

      const loadText = [
        ...f.loadout.map((l) => `<span class="${l.active ? 'is-active' : ''}${l.count === 0 ? ' is-empty' : ''}">${l.label} ×${l.count}</span>`),
        f.flares + f.chaff > 0 ? `<span>Flares ${f.flares} · Chaff ${f.chaff}</span>` : '',
      ].join('');
      if (changed('load', loadText)) load.innerHTML = loadText;
    },
  };
}
