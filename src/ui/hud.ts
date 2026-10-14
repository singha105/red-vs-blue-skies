// Flight HUD as an HTML/CSS overlay: speed, altitude, throttle, G, warnings, aim reticle, nose marker, minimap.
// Text only changes the DOM when the shown value changes, to keep layout work low on phones.

export interface HudFrame {
  speedKmh: number;
  altitudeM: number;
  throttle: number;
  g: number;
  stalled: boolean;
  edgeWarning: boolean;
  autoTurn: boolean;
  alive: boolean;
  respawnIn: number;
  /** Screen positions in CSS pixels, or null when behind the camera. */
  aim: { x: number; y: number } | null;
  nose: { x: number; y: number } | null;
  /** Position on the map, −1..1 on each axis, and heading in radians (0 = +Z, positive = right). */
  map: { x: number; z: number; heading: number };
  freeLook: boolean;
  hint: string;
}

export interface Hud {
  readonly el: HTMLElement;
  update(f: HudFrame): void;
  dispose(): void;
}

export function createHud(parent: HTMLElement, onMenu: () => void): Hud {
  const el = document.createElement('div');
  el.className = 'hud';
  el.innerHTML = `
    <button type="button" class="hud__menu" aria-label="Back to title">Menu</button>
    <div class="hud__reticle" data-testid="reticle" aria-hidden="true"></div>
    <div class="hud__nose" data-testid="nose" aria-hidden="true"></div>
    <div class="hud__readout">
      <div><span class="hud__value" data-k="speed">0</span><span class="hud__unit">km/h</span></div>
      <div><span class="hud__value" data-k="alt">0</span><span class="hud__unit">m</span></div>
      <div class="hud__small"><span data-k="thr">80</span>% throttle · <span data-k="g">1.0</span> G</div>
    </div>
    <div class="hud__warn" role="status" aria-live="assertive"></div>
    <div class="hud__hint"></div>
    <div class="hud__map" aria-label="Minimap"><div class="hud__map-dot"></div></div>
  `;
  parent.appendChild(el);
  el.querySelector('.hud__menu')!.addEventListener('click', onMenu);

  const q = <T extends HTMLElement>(sel: string): T => el.querySelector<T>(sel)!;
  const reticle = q('.hud__reticle');
  const nose = q('.hud__nose');
  const speed = q('[data-k="speed"]');
  const alt = q('[data-k="alt"]');
  const thr = q('[data-k="thr"]');
  const gEl = q('[data-k="g"]');
  const warn = q('.hud__warn');
  const hint = q('.hud__hint');
  const dot = q('.hud__map-dot');

  const last: Record<string, string> = {};
  const text = (key: string, node: HTMLElement, value: string): void => {
    if (last[key] === value) return;
    last[key] = value;
    node.textContent = value;
  };
  const place = (node: HTMLElement, p: { x: number; y: number } | null): void => {
    node.style.visibility = p ? 'visible' : 'hidden';
    if (p) node.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%)`;
  };

  return {
    el,
    update(f) {
      text('speed', speed, String(Math.round(f.speedKmh)));
      text('alt', alt, String(Math.round(f.altitudeM)));
      text('thr', thr, String(Math.round(f.throttle * 100)));
      text('g', gEl, f.g.toFixed(1));
      place(reticle, f.alive && !f.freeLook ? f.aim : null);
      place(nose, f.alive ? f.nose : null);

      let w = '';
      let cls = '';
      if (!f.alive) {
        w = `Crashed. Back in the air in ${Math.max(1, Math.ceil(f.respawnIn))}`;
        cls = 'is-crash';
      } else if (f.autoTurn) {
        w = 'Leaving the battle area. Turning back';
        cls = 'is-edge';
      } else if (f.stalled) {
        w = 'Stall. Nose down and add throttle';
        cls = 'is-stall';
      } else if (f.edgeWarning) {
        w = 'Battle area edge ahead';
        cls = 'is-edge';
      }
      text('warn', warn, w);
      if (last['warnCls'] !== cls) {
        last['warnCls'] = cls;
        warn.className = `hud__warn ${cls}`;
      }
      text('hint', hint, f.hint);

      // Seen from above with +Z up the map, world +X points left.
      dot.style.left = `${((1 - f.map.x) * 50).toFixed(1)}%`;
      dot.style.top = `${((1 - f.map.z) * 50).toFixed(1)}%`;
      dot.style.transform = `translate(-50%, -50%) rotate(${f.map.heading.toFixed(2)}rad)`;
    },
    dispose() {
      el.remove();
    },
  };
}
