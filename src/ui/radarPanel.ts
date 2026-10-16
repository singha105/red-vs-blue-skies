// Bottom-right instrument card: radar scope (jets with a radar), radar-warning display, and the throttle,
// WEP / afterburner heat and hull bars. One flat, dark, translucent card on one canvas (docs/ART_DIRECTION.md).
//
// Scope: a sector with your plane at the bottom point, range rings and a sweep line. In Search the sweep paints
// contacts as it passes them and the blips fade until the next pass; the locked target is tracked continuously
// and circled, with its range, altitude and closing speed. Dogfight shows its narrow cone and waits for a lock.
// Enemies red, friendlies blue; your missiles in flight are lines to their targets.

export interface ScopeContact {
  id: string;
  /** Radians off the nose, clockwise; metres away; altitude difference (m, + = above us). */
  bearing: number;
  distM: number;
  enemy: boolean;
}

export interface PanelFrame {
  compact: boolean;
  radar: null | {
    on: boolean;
    mode: 'search' | 'dogfight';
    /** Display range (km) and half-angle of the scan (degrees). */
    rangeKm: number;
    coneDeg: number;
    /** What the radar can see right now (notching and ground clutter already removed). */
    contacts: ScopeContact[];
    lock: null | { id: string; bearing: number; distM: number; altM: number; closingMs: number };
    /** Your missiles in flight: bearing/distance of the missile and of its target. */
    missiles: { mb: number; md: number; tb: number; td: number }[];
    lockWanted: boolean;
  };
  /** Threats: radians off the nose, clockwise. */
  rwr: { angle: number; kind: 'spike' | 'lock' | 'missile' }[];
  showRwr: boolean;
  throttle: number;
  wep: boolean;
  heat: number;
  overheat: boolean;
  hp: number;
  units: 'imperial' | 'metric';
  /** Scope colour scheme: team colours follow the colour-blind setting. */
  friendColor: string;
  enemyColor: string;
}

const GREEN = '#6dff95';
const DIM = 'rgba(109, 255, 149, 0.35)';
const FONT = "'Share Tech Mono', ui-monospace, monospace";
/** Seconds for the sweep to cross the cone one way. */
const SWEEP_S = 1.2;
/** Painted blips fade out over this long. */
const FADE_S = 2.6;

export interface RadarPanel {
  readonly el: HTMLCanvasElement;
  draw(f: PanelFrame, dt: number): void;
  dispose(): void;
}

export function createRadarPanel(parent: HTMLElement, onSelect: (id: string) => void = () => undefined): RadarPanel {
  const el = document.createElement('canvas');
  el.className = 'rpanel';
  el.dataset['testid'] = 'radar-panel';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'Radar and engine panel');
  parent.appendChild(el);
  const g = el.getContext('2d')!;
  let sweep = 0;
  let sweepDir = 1;
  /** Last painted position of each contact: bearing, distance, and how long ago. */
  const painted = new Map<string, { b: number; d: number; age: number; enemy: boolean }>();
  let lastLabel = '';
  /** Where blips were drawn last frame (CSS px in the canvas), so a tap can pick one. */
  const blips: { id: string; x: number; y: number }[] = [];
  el.addEventListener('pointerup', (e) => {
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    let best: string | null = null;
    let bestD = 22;
    for (const b of blips) {
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < bestD) {
        bestD = d;
        best = b.id;
      }
    }
    if (best) onSelect(best);
  });

  const text = (s: string, x: number, y: number, size: number, color = GREEN, align: CanvasTextAlign = 'left'): void => {
    g.font = `${size}px ${FONT}`;
    g.textAlign = align;
    g.textBaseline = 'middle';
    g.fillStyle = color;
    g.fillText(s, x, y);
  };

  const bar = (x: number, y: number, bw: number, bh: number, frac: number, color: string, label: string, value: string, size: number): void => {
    g.fillStyle = 'rgba(244, 247, 251, 0.12)';
    g.fillRect(x, y, bw, bh);
    g.fillStyle = color;
    const f = Math.max(0, Math.min(1, frac));
    g.fillRect(x, y + bh * (1 - f), bw, bh * f);
    g.strokeStyle = 'rgba(244, 247, 251, 0.35)';
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, bw - 1, bh - 1);
    text(value, x + bw / 2, y - size * 0.7, size, '#f4f7fb', 'center');
    text(label, x + bw / 2, y + bh + size * 0.75, size * 0.85, 'rgba(244, 247, 251, 0.75)', 'center');
  };

  return {
    el,
    draw(f, dt) {
      const size = f.compact ? 11 : 13;
      const scopeW = f.radar ? (f.compact ? 132 : 176) : 0;
      const rwrW = f.showRwr ? (f.compact ? 62 : 78) : 0;
      const barsW = f.compact ? 84 : 104;
      const pad = f.compact ? 8 : 10;
      const cssW = pad + scopeW + (scopeW ? pad : 0) + rwrW + (rwrW ? pad : 0) + barsW + pad;
      const cssH = f.compact ? 112 : 142;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const label = `${cssW}x${cssH}`;
      if (label !== lastLabel) {
        lastLabel = label;
        el.style.width = `${cssW}px`;
        el.style.height = `${cssH}px`;
        el.width = Math.round(cssW * dpr);
        el.height = Math.round(cssH * dpr);
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, cssW, cssH);
      g.fillStyle = 'rgba(10, 20, 30, 0.72)';
      g.beginPath();
      g.roundRect(0, 0, cssW, cssH, 10);
      g.fill();

      let x = pad;
      blips.length = 0;
      // --- Scope.
      const r = f.radar;
      if (r) {
        const ox = x + scopeW / 2;
        const oy = cssH - pad - size;
        const R = Math.min(scopeW / 2 / Math.sin(Math.min(70, r.coneDeg) * (Math.PI / 180)), oy - pad - size);
        const cone = Math.min(70, r.coneDeg) * (Math.PI / 180);
        const live = r.on;
        const half = r.mode === 'dogfight' ? (10 * Math.PI) / 180 : cone;
        g.lineWidth = 1;
        // Cone edges and range rings.
        g.strokeStyle = live ? GREEN : DIM;
        g.beginPath();
        g.moveTo(ox, oy);
        g.lineTo(ox + Math.sin(-cone) * R, oy - Math.cos(cone) * R);
        g.moveTo(ox, oy);
        g.lineTo(ox + Math.sin(cone) * R, oy - Math.cos(cone) * R);
        g.stroke();
        g.strokeStyle = DIM;
        for (let k = 1; k <= 4; k++) {
          g.beginPath();
          g.arc(ox, oy, (R * k) / 4, -Math.PI / 2 - cone, -Math.PI / 2 + cone);
          g.stroke();
        }
        if (r.mode === 'dogfight' && live) {
          g.strokeStyle = GREEN;
          g.setLineDash([3, 3]);
          g.beginPath();
          g.moveTo(ox, oy);
          g.lineTo(ox + Math.sin(-half) * R, oy - Math.cos(half) * R);
          g.moveTo(ox, oy);
          g.lineTo(ox + Math.sin(half) * R, oy - Math.cos(half) * R);
          g.stroke();
          g.setLineDash([]);
        }
        // Own plane at the bottom point.
        g.fillStyle = GREEN;
        g.beginPath();
        g.moveTo(ox, oy - 6);
        g.lineTo(ox - 4, oy + 3);
        g.lineTo(ox + 4, oy + 3);
        g.closePath();
        g.fill();

        const rangeM = r.rangeKm * 1000;
        const toScope = (b: number, d: number): [number, number] => {
          const rr = (Math.min(d, rangeM) / rangeM) * R;
          return [ox + Math.sin(b) * rr, oy - Math.cos(b) * rr];
        };

        if (live && r.mode === 'search') {
          // Sweep back and forth across the cone; paint whatever it passes.
          const prev = sweep;
          sweep += (sweepDir * 2 * cone * dt) / SWEEP_S;
          if (sweep > cone) {
            sweep = cone;
            sweepDir = -1;
          } else if (sweep < -cone) {
            sweep = -cone;
            sweepDir = 1;
          }
          const lo = Math.min(prev, sweep) - 0.02;
          const hi = Math.max(prev, sweep) + 0.02;
          for (const c of r.contacts) {
            if (c.bearing >= lo && c.bearing <= hi) painted.set(c.id, { b: c.bearing, d: c.distM, age: 0, enemy: c.enemy });
          }
          g.strokeStyle = 'rgba(109, 255, 149, 0.7)';
          g.beginPath();
          g.moveTo(ox, oy);
          g.lineTo(ox + Math.sin(sweep) * R, oy - Math.cos(sweep) * R);
          g.stroke();
        } else painted.clear();
        for (const [id, p] of painted) {
          p.age += dt;
          if (p.age > FADE_S) {
            painted.delete(id);
            continue;
          }
          if (r.lock && id === r.lock.id) continue;
          const [px, py] = toScope(p.b, p.d);
          g.globalAlpha = 1 - p.age / FADE_S;
          g.fillStyle = p.enemy ? f.enemyColor : f.friendColor;
          g.fillRect(px - 3, py - 3, 6, 6);
          g.globalAlpha = 1;
          if (p.enemy) blips.push({ id, x: px, y: py });
        }
        // Missiles in flight: a line from each missile to its target.
        g.strokeStyle = '#ffd166';
        for (const m of r.missiles) {
          const [mx, my] = toScope(m.mb, m.md);
          const [tx, ty] = toScope(m.tb, m.td);
          g.beginPath();
          g.moveTo(mx, my);
          g.lineTo(tx, ty);
          g.stroke();
          g.fillStyle = '#ffd166';
          g.fillRect(mx - 1.5, my - 1.5, 3, 3);
        }
        // The lock: tracked every frame and circled.
        if (r.lock && live) {
          const [lx, ly] = toScope(r.lock.bearing, r.lock.distM);
          blips.push({ id: r.lock.id, x: lx, y: ly });
          g.fillStyle = f.enemyColor;
          g.fillRect(lx - 3, ly - 3, 6, 6);
          g.strokeStyle = '#f4f7fb';
          g.lineWidth = 1.5;
          g.beginPath();
          g.arc(lx, ly, 7, 0, Math.PI * 2);
          g.stroke();
          g.lineWidth = 1;
        }
        // Labels: mode and range at the top, lock data underneath.
        const mode = !live ? 'RDR OFF' : r.lock ? 'LOCK' : r.mode === 'dogfight' ? 'DGFT' : r.lockWanted ? 'ACQ' : 'SRCH';
        text(mode, x, pad + size * 0.4, size, live ? GREEN : DIM);
        text(`${r.rangeKm} KM`, x + scopeW, pad + size * 0.4, size, live ? GREEN : DIM, 'right');
        if (r.lock && live) {
          const imperial = f.units === 'imperial';
          const range = imperial ? `${(r.lock.distM / 1852).toFixed(1)} NM` : `${(r.lock.distM / 1000).toFixed(1)} KM`;
          const alt = imperial ? `${Math.round((r.lock.altM * 3.28084) / 100) * 100} FT` : `${Math.round(r.lock.altM / 10) * 10} M`;
          const vc = imperial ? `${Math.round(r.lock.closingMs * 1.943844)} KT` : `${Math.round(r.lock.closingMs * 3.6)} KM/H`;
          text(`${range} ${alt}`, x, cssH - pad - size * 0.2, size * 0.9, '#f4f7fb');
          text(`VC ${vc}`, x + scopeW, cssH - pad - size * 0.2, size * 0.9, r.lock.closingMs >= 0 ? '#f4f7fb' : '#ffd166', 'right');
        }
        x += scopeW + pad;
      }

      // --- RWR: a ring with your plane in the middle and threat directions around it.
      if (f.showRwr) {
        const cx = x + rwrW / 2;
        const cy = cssH / 2 - size * 0.3;
        const rr = rwrW / 2 - 4;
        g.strokeStyle = 'rgba(244, 247, 251, 0.45)';
        g.lineWidth = 1;
        g.beginPath();
        g.arc(cx, cy, rr, 0, Math.PI * 2);
        g.stroke();
        g.beginPath();
        g.arc(cx, cy, rr * 0.5, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = '#f4f7fb';
        g.beginPath();
        g.moveTo(cx, cy - 5);
        g.lineTo(cx - 4, cy + 4);
        g.lineTo(cx + 4, cy + 4);
        g.closePath();
        g.fill();
        const blink = Math.floor(performance.now() / 125) % 2 === 0;
        for (const t of f.rwr) {
          const px = cx + Math.sin(t.angle) * rr * 0.78;
          const py = cy - Math.cos(t.angle) * rr * 0.78;
          if (t.kind === 'missile') {
            if (!blink) continue;
            g.fillStyle = '#ff3b30';
            g.beginPath();
            g.arc(px, py, 5, 0, Math.PI * 2);
            g.fill();
          } else {
            g.fillStyle = t.kind === 'lock' ? '#ff8a3d' : '#ffd166';
            g.fillRect(px - 4, py - 4, 8, 8);
          }
        }
        text('RWR', cx, cssH - pad - size * 0.2, size * 0.85, 'rgba(244, 247, 251, 0.75)', 'center');
        x += rwrW + pad;
      }

      // --- Bars: throttle (amber with WEP), engine heat, hull.
      const bw = (barsW - 2 * 8) / 3;
      const by = pad + size * 1.6;
      const bh = cssH - by - pad - size * 1.4;
      bar(x, by, bw, bh, f.wep ? 1 : f.throttle, f.wep ? '#ffd166' : '#f4f7fb', 'THR', f.wep ? 'WEP' : String(Math.round(f.throttle * 100)), size);
      bar(x + bw + 8, by, bw, bh, f.heat, f.overheat ? '#ff3b30' : f.heat > 0.8 ? '#ffd166' : '#ff8a3d', 'HEAT', f.overheat ? 'HOT' : String(Math.round(f.heat * 100)), size);
      bar(x + 2 * (bw + 8), by, bw, bh, f.hp, f.hp < 0.35 ? '#ff3b30' : GREEN, 'HULL', String(Math.round(f.hp * 100)), size);
    },
    dispose() {
      el.remove();
    },
  };
}
