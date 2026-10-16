// The flight HUD, drawn on one canvas so the lines stay crisp at any size and pixel ratio.
// * WW1 to Late WW2: a reflector gunsight ring on the nose and a small card of gauges (speed, altitude,
//   throttle, ammo).
// * Early Jets: a gyro gunsight (pipper and diamond ring) and the same gauges.
// * Cold War and Modern: the green jet HUD: speed tape left, altitude tape right, heading tape at the bottom,
//   pitch ladder (solid above the horizon, dashed below), flight-path marker, Mach / G / max G / AoA, radar
//   altitude below 1,500 ft, weapon counts, and a red PULL UP / TERRAIN box when terrain is under 4 s away.
// Our own layout and the self-hosted OFL Share Tech Mono font (see docs/ART_DIRECTION.md).
import type { Vec3 } from '../game/math';

export type HudStyle = 'gunsight' | 'gyro' | 'jet';
export type Units = 'imperial' | 'metric';
type Pt = { x: number; y: number } | null;

export interface FlightHudFrame {
  style: HudStyle;
  units: Units;
  /** Small screen: fewer, smaller elements. */
  compact: boolean;
  alive: boolean;
  speedMs: number;
  altM: number;
  /** Height above the ground or sea. */
  radarAltM: number;
  /** Radians: heading clockwise from north (+Z), pitch of the nose. */
  heading: number;
  pitch: number;
  mach: number;
  g: number;
  maxG: number;
  /** The plane's G limit: the G readout turns red near it. */
  gLimit: number;
  aoaDeg: number;
  /** 0..1, and whether WEP / afterburner is lit; engine heat 0..1; seconds of WEP left; seconds overheated. */
  throttle: number;
  wep: boolean;
  jet: boolean;
  heat: number;
  wepLeftS: number;
  overheatS: number;
  airbrake: boolean;
  flaps: boolean;
  /** Ammo per gun type, secondary weapons, countermeasures. */
  guns: number;
  secondary: string;
  flares: number;
  pullUp: boolean;
  /** Where the nose and the flight path point on screen (null when behind the camera). */
  nose: Pt;
  fpm: Pt;
  /** Screen point of a world direction from the camera, for the pitch ladder. */
  project(dir: Vec3): Pt;
}

const GREEN = '#6dff95';
const RED = '#ff4d4d';
const AMBER = '#ffd166';
const OUTLINE = 'rgba(0, 24, 8, 0.6)';
const KT = 1.943844;
const FT = 3.28084;
const DEG = Math.PI / 180;
const FONT = "'Share Tech Mono', ui-monospace, monospace";

export interface FlightHud {
  readonly el: HTMLCanvasElement;
  draw(f: FlightHudFrame): void;
  dispose(): void;
}

export function createFlightHud(parent: HTMLElement): FlightHud {
  const el = document.createElement('canvas');
  el.className = 'fhud';
  el.setAttribute('aria-hidden', 'true');
  el.dataset['testid'] = 'flight-hud';
  parent.prepend(el);
  const g = el.getContext('2d')!;
  let w = 0;
  let h = 0;
  let dpr = 1;
  const scratch: Vec3 = [0, 0, 0];

  const resize = (): void => {
    const r = el.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const nw = Math.round(r.width * dpr);
    const nh = Math.round(r.height * dpr);
    if (nw !== el.width || nh !== el.height) {
      el.width = nw;
      el.height = nh;
    }
    w = r.width;
    h = r.height;
  };

  // Every line is drawn twice: a dark outline (readable over snow and sky) under the coloured stroke.
  const strokePath = (path: () => void, color = GREEN, width = 1.5, dash: number[] = []): void => {
    g.setLineDash(dash);
    g.lineWidth = width + 2.2;
    g.strokeStyle = OUTLINE;
    g.beginPath();
    path();
    g.stroke();
    g.lineWidth = width;
    g.strokeStyle = color;
    g.beginPath();
    path();
    g.stroke();
    g.setLineDash([]);
  };
  const text = (s: string, x: number, y: number, size: number, align: CanvasTextAlign = 'left', color = GREEN): void => {
    g.font = `${size}px ${FONT}`;
    g.textAlign = align;
    g.textBaseline = 'middle';
    g.lineWidth = 3;
    g.strokeStyle = OUTLINE;
    g.strokeText(s, x, y);
    g.fillStyle = color;
    g.fillText(s, x, y);
  };
  const box = (x: number, y: number, bw: number, bh: number, color = GREEN): void => strokePath(() => g.rect(x, y, bw, bh), color);

  const speedOf = (f: FlightHudFrame): number => (f.units === 'imperial' ? f.speedMs * KT : f.speedMs * 3.6);
  const altOf = (m: number, f: FlightHudFrame): number => (f.units === 'imperial' ? m * FT : m);

  /** A vertical tape: ticks every `minor`, labels every `major`, the current value boxed at the middle. */
  const tape = (x: number, cy: number, half: number, value: number, minor: number, major: number, pxPer: number, side: 'left' | 'right', unit: string, size: number): void => {
    const dir = side === 'left' ? -1 : 1;
    strokePath(() => {
      g.moveTo(x, cy - half);
      g.lineTo(x, cy + half);
      const first = Math.ceil((value - half / pxPer) / minor) * minor;
      for (let v = first; v <= value + half / pxPer; v += minor) {
        const y = cy - (v - value) * pxPer;
        const long = Math.abs(v % major) < 1e-6;
        g.moveTo(x, y);
        g.lineTo(x + dir * (long ? 10 : 5), y);
      }
    });
    const first = Math.ceil((value - half / pxPer) / major) * major;
    for (let v = first; v <= value + half / pxPer; v += major) {
      const y = cy - (v - value) * pxPer;
      if (Math.abs(y - cy) < size * 1.4 || v < 0) continue;
      text(String(Math.round(v)), x + dir * 14, y, size * 0.8, side === 'left' ? 'right' : 'left');
    }
    const bw = size * 3.6;
    const bx = side === 'left' ? x - 12 - bw : x + 12;
    g.fillStyle = 'rgba(0, 20, 6, 0.35)';
    g.fillRect(bx, cy - size * 0.75, bw, size * 1.5);
    box(bx, cy - size * 0.75, bw, size * 1.5);
    text(String(Math.round(value)), bx + bw / 2, cy, size, 'center');
    text(unit, bx + bw / 2, cy - half - size * 0.8, size * 0.75, 'center');
  };

  const headingLabel = (deg: number): string => {
    const d = ((Math.round(deg) % 360) + 360) % 360;
    return d === 0 ? 'N' : d === 90 ? 'E' : d === 180 ? 'S' : d === 270 ? 'W' : String(Math.round(d / 10)).padStart(2, '0');
  };

  const pullUpBox = (cx: number, y: number, size: number): void => {
    // Blink at 3 Hz so it reads as a warning, not a label.
    if (Math.floor(performance.now() / 166) % 2 === 1) return;
    const bw = size * 7;
    g.fillStyle = 'rgba(60, 0, 0, 0.35)';
    g.fillRect(cx - bw / 2, y - size, bw, size * 2);
    box(cx - bw / 2, y - size, bw, size * 2, RED);
    text('PULL UP', cx, y, size * 1.15, 'center', RED);
    text('TERRAIN', cx, y + size * 1.6, size * 0.8, 'center', RED);
  };

  const engineLine = (f: FlightHudFrame): { s: string; color: string } => {
    if (f.overheatS > 0) return { s: `ENG HOT ${Math.ceil(f.overheatS)} s`, color: RED };
    const name = f.jet ? 'AB' : 'WEP';
    if (f.wep) return { s: `${name} ${Math.max(0, Math.ceil(f.wepLeftS))} s`, color: f.heat > 0.8 ? AMBER : GREEN };
    return { s: `THR ${Math.round(f.throttle * 100)}%`, color: GREEN };
  };

  function drawJet(f: FlightHudFrame): void {
    const size = f.compact ? 13 : Math.max(14, Math.min(18, h / 42));
    const cx = w / 2;
    // Phones: the HUD fits between the score bar and the thumb controls and panel at the bottom.
    const cy = h * (f.compact ? 0.36 : 0.44);
    const fw = f.compact ? Math.min(w * 0.26, 230) : Math.min(w * 0.36, h * 0.6);
    const fh = f.compact ? h * 0.38 : h * 0.46;
    const left = cx - fw / 2;
    const right = cx + fw / 2;
    const top = cy - fh / 2;
    const bottom = cy + fh / 2;

    // HUD field of view: corner brackets rather than a closed box, so the scene stays visible.
    const c = Math.min(fw, fh) * 0.08;
    strokePath(() => {
      for (const [x, y, dx, dy] of [[left, top, 1, 1], [right, top, -1, 1], [left, bottom, 1, -1], [right, bottom, -1, -1]] as const) {
        g.moveTo(x + dx * c, y);
        g.lineTo(x, y);
        g.lineTo(x, y + dy * c);
      }
    }, GREEN, 1.2);

    // Pitch ladder, clipped to the HUD field.
    g.save();
    g.beginPath();
    g.rect(left + 2, top + 2, fw - 4, fh - 4);
    g.clip();
    const base = Math.round(f.pitch / DEG / 5) * 5;
    for (let p = base - 30; p <= base + 30; p += 5) {
      if (p < -85 || p > 85) continue;
      const half = p === 0 ? 14 : 5;
      const a = f.project(dir(f.heading - half * DEG, p * DEG));
      const b = f.project(dir(f.heading + half * DEG, p * DEG));
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      if (p === 0) {
        strokePath(() => {
          g.moveTo(mx - ux * fw, my - uy * fw);
          g.lineTo(mx - ux * fw * 0.08, my - uy * fw * 0.08);
          g.moveTo(mx + ux * fw * 0.08, my + uy * fw * 0.08);
          g.lineTo(mx + ux * fw, my + uy * fw);
        });
        continue;
      }
      const rung = fw * 0.2;
      const gap = fw * 0.07;
      const tick = (p > 0 ? 1 : -1) * size * 0.5;
      // Ticks point toward the horizon; below the horizon the rungs are dashed.
      const nx = -uy;
      const ny = ux;
      strokePath(() => {
        g.moveTo(mx - ux * (gap + rung) + nx * tick, my - uy * (gap + rung) + ny * tick);
        g.lineTo(mx - ux * (gap + rung), my - uy * (gap + rung));
        g.lineTo(mx - ux * gap, my - uy * gap);
        g.moveTo(mx + ux * gap, my + uy * gap);
        g.lineTo(mx + ux * (gap + rung), my + uy * (gap + rung));
        g.lineTo(mx + ux * (gap + rung) + nx * tick, my + uy * (gap + rung) + ny * tick);
      }, GREEN, 1.2, p < 0 ? [6, 4] : []);
      const label = String(Math.abs(p));
      text(label, mx - ux * (gap + rung + size), my - uy * (gap + rung + size), size * 0.75, 'center');
      text(label, mx + ux * (gap + rung + size), my + uy * (gap + rung + size), size * 0.75, 'center');
    }
    g.restore();

    // Flight-path marker: where the plane is actually going.
    if (f.fpm) {
      const { x, y } = f.fpm;
      const r = size * 0.45;
      strokePath(() => {
        g.moveTo(x + r, y);
        g.arc(x, y, r, 0, Math.PI * 2);
        g.moveTo(x - r, y);
        g.lineTo(x - r * 2.4, y);
        g.moveTo(x + r, y);
        g.lineTo(x + r * 2.4, y);
        g.moveTo(x, y - r);
        g.lineTo(x, y - r * 2);
      });
    }

    // Tapes.
    const half = fh * 0.38;
    const spd = speedOf(f);
    const imperial = f.units === 'imperial';
    tape(left - 8, cy, half, spd, imperial ? 10 : 20, imperial ? 50 : 100, half / (imperial ? 120 : 220), 'left', imperial ? 'KT' : 'KM/H', size);
    const alt = altOf(f.altM, f);
    tape(right + 8, cy, half, alt, imperial ? 100 : 25, imperial ? 500 : 100, half / (imperial ? 1200 : 360), 'right', imperial ? 'FT' : 'M', size);

    // Heading tape below the field (inside its bottom edge on phones, where the panel sits underneath).
    const hy = f.compact ? bottom - size * 2.8 : bottom + size * 1.6;
    const hdg = ((f.heading / DEG) % 360 + 360) % 360;
    const span = 50;
    const pxDeg = (fw * 0.9) / span;
    strokePath(() => {
      g.moveTo(cx - fw * 0.45, hy);
      g.lineTo(cx + fw * 0.45, hy);
      for (let d = Math.ceil((hdg - span / 2) / 5) * 5; d <= hdg + span / 2; d += 5) {
        const x = cx + (d - hdg) * pxDeg;
        g.moveTo(x, hy);
        g.lineTo(x, hy + (d % 10 === 0 ? 8 : 4));
      }
    });
    for (let d = Math.ceil((hdg - span / 2) / 10) * 10; d <= hdg + span / 2; d += 10) {
      const x = cx + (d - hdg) * pxDeg;
      if (Math.abs(x - cx) < size * 2) continue;
      text(headingLabel(d), x, hy + size * 1.1, size * 0.8, 'center');
    }
    const hb = size * 2.8;
    g.fillStyle = 'rgba(0, 20, 6, 0.35)';
    g.fillRect(cx - hb / 2, hy + size * 0.3, hb, size * 1.5);
    box(cx - hb / 2, hy + size * 0.3, hb, size * 1.5);
    text(String(Math.round(hdg) % 360).padStart(3, '0'), cx, hy + size * 1.05, size, 'center');

    // Lower left: Mach, G and max G (red near the limit), AoA, engine. Phones: top left, under Menu.
    const lx = f.compact ? 92 : left - size * 4.6;
    let ly = f.compact ? 72 : bottom + size * 0.2;
    const step = size * 1.25;
    text(`M ${f.mach.toFixed(2)}`, lx, ly, size);
    ly += step;
    const gRed = f.g >= f.gLimit * 0.97;
    text(`${f.g.toFixed(1)} G`, lx, ly, size, 'left', gRed ? RED : GREEN);
    text(`MAX ${f.maxG.toFixed(1)}`, lx + size * 4.2, ly, size, 'left', f.maxG >= f.gLimit * 0.97 ? RED : GREEN);
    ly += step;
    if (!f.compact) {
      text(`AOA ${f.aoaDeg.toFixed(1)}`, lx, ly, size);
      ly += step;
    }
    const eng = engineLine(f);
    text(eng.s, lx, ly, size, 'left', eng.color);
    const extras = [f.airbrake ? 'BRK' : '', f.flaps ? 'FLP' : ''].filter(Boolean).join(' ');
    if (extras) text(extras, lx + size * 6.2, ly, size * 0.85, 'left', AMBER);

    // Right: weapons beside the field; radar altitude below it when low.
    const rx = f.compact ? right + 24 + size * 3.6 + 8 : right + size * 0.8;
    let ry = f.compact ? top + size * 0.6 : bottom + size * 0.2;
    if (f.secondary) {
      text(f.secondary, rx, ry, size);
      ry += step;
    }
    text(`GUN ${f.guns}`, rx, ry, size);
    ry += step;
    if (f.flares > 0 || f.secondary) {
      text(`FLR ${f.flares}`, rx, ry, size);
      ry += step;
    }
    if (f.radarAltM < 1500 / FT) text(imperial ? `R ${Math.round(f.radarAltM * FT / 10) * 10} FT` : `R ${Math.round(f.radarAltM)} M`, rx, ry, size, 'left', f.radarAltM < 60 ? AMBER : GREEN);

    if (f.pullUp) pullUpBox(cx, top + size * 1.6, size);
  }

  /** Card of round gauges for propeller planes and early jets (bottom left on desktop, top left on phones). */
  function drawGauges(f: FlightHudFrame): void {
    const r = f.compact ? 24 : 34;
    const pad = 10;
    const cw = r * 2 * 3 + pad * 4 + (f.compact ? 30 : 40);
    const ch = r * 2 + pad * 2 + 18;
    // Desktop: middle of the left edge. Phones: bottom, right of the weapon buttons.
    const x0 = f.compact ? 356 : 16;
    const y0 = f.compact ? h - ch - 12 : h / 2 - ch / 2;
    g.fillStyle = 'rgba(10, 20, 30, 0.72)';
    roundRect(x0, y0, cw, ch, 10);
    g.fill();
    const imperial = f.units === 'imperial';
    const spd = speedOf(f);
    const maxSpd = imperial ? 500 : 900;
    const dial = (cx: number, value: number, max: number, label: string, readout: string): void => {
      const cy = y0 + pad + r;
      g.strokeStyle = 'rgba(244, 247, 251, 0.75)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI * 0.75 + (i / 9) * Math.PI * 1.5;
        g.beginPath();
        g.moveTo(cx + Math.cos(a - Math.PI / 2) * r * 0.82, cy + Math.sin(a - Math.PI / 2) * r * 0.82);
        g.lineTo(cx + Math.cos(a - Math.PI / 2) * r * 0.95, cy + Math.sin(a - Math.PI / 2) * r * 0.95);
        g.stroke();
      }
      const a = -Math.PI * 0.75 + Math.min(1, Math.max(0, value / max)) * Math.PI * 1.5 - Math.PI / 2;
      g.strokeStyle = AMBER;
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8);
      g.stroke();
      text(readout, cx, cy + r * 0.45, f.compact ? 12 : 14, 'center', '#f4f7fb');
      text(label, cx, y0 + ch - 10, f.compact ? 11 : 13, 'center', 'rgba(244, 247, 251, 0.8)');
    };
    dial(x0 + pad + r, spd, maxSpd, imperial ? 'KT' : 'KM/H', String(Math.round(spd)));
    const alt = altOf(f.altM, f);
    // The altimeter needle goes round once per 1,000 ft (or 300 m), like the real thing.
    dial(x0 + pad * 2 + r * 3, alt % (imperial ? 1000 : 300), imperial ? 1000 : 300, imperial ? 'FT' : 'M', String(Math.round(alt)));
    // Throttle bar with the WEP band, then ammo.
    const bx = x0 + pad * 3 + r * 4;
    const bh = r * 2;
    const by = y0 + pad;
    g.fillStyle = 'rgba(244, 247, 251, 0.15)';
    g.fillRect(bx, by, 12, bh);
    g.fillStyle = f.overheatS > 0 ? RED : f.wep ? AMBER : '#f4f7fb';
    const fill = f.wep ? 1 : f.throttle * 0.88;
    g.fillRect(bx, by + bh * (1 - fill), 12, bh * fill);
    g.fillStyle = RED;
    g.fillRect(bx + 14, by + bh * (1 - f.heat), 4, bh * f.heat);
    text(f.wep ? (f.jet ? 'AB' : 'WEP') : f.overheatS > 0 ? 'HOT' : 'THR', bx + 6, y0 + ch - 10, f.compact ? 11 : 13, 'center', 'rgba(244, 247, 251, 0.8)');
    const ax = bx + 26;
    text(String(f.guns), ax + r * 0.9, y0 + pad + r - 6, f.compact ? 15 : 18, 'center', '#f4f7fb');
    text('ROUNDS', ax + r * 0.9, y0 + pad + r + 12, f.compact ? 10 : 12, 'center', 'rgba(244, 247, 251, 0.8)');
    if (f.secondary) text(f.secondary, ax + r * 0.9, y0 + ch - 10, f.compact ? 11 : 13, 'center', AMBER);
    if (f.pullUp) pullUpBox(w / 2, h * 0.2, f.compact ? 13 : 16);
  }

  function roundRect(x: number, y: number, rw: number, rh: number, r: number): void {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + rw, y, x + rw, y + rh, r);
    g.arcTo(x + rw, y + rh, x, y + rh, r);
    g.arcTo(x, y + rh, x, y, r);
    g.arcTo(x, y, x + rw, y, r);
    g.closePath();
  }

  function drawReflector(f: FlightHudFrame): void {
    if (!f.nose) return;
    const { x, y } = f.nose;
    const r = f.compact ? 34 : 46;
    // Amber reflector glass: ring with gaps, centre dot.
    strokePath(() => {
      for (let i = 0; i < 4; i++) {
        const a = i * (Math.PI / 2) + 0.2;
        g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        g.arc(x, y, r, a, a + Math.PI / 2 - 0.4);
      }
      g.moveTo(x + 2, y);
      g.arc(x, y, 2, 0, Math.PI * 2);
      g.moveTo(x - r * 0.35, y);
      g.lineTo(x - r * 0.15, y);
      g.moveTo(x + r * 0.15, y);
      g.lineTo(x + r * 0.35, y);
    }, AMBER, 1.6);
  }

  function drawGyro(f: FlightHudFrame): void {
    if (!f.nose) return;
    const { x, y } = f.nose;
    const r = f.compact ? 32 : 42;
    strokePath(() => {
      g.moveTo(x + 2.5, y);
      g.arc(x, y, 2.5, 0, Math.PI * 2);
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r;
        const d = 4;
        g.moveTo(px, py - d);
        g.lineTo(px + d, py);
        g.lineTo(px, py + d);
        g.lineTo(px - d, py);
        g.closePath();
      }
    }, GREEN, 1.4);
  }

  function dir(heading: number, pitch: number): Vec3 {
    // Heading clockwise from +Z (north) seen from above, with +X to the west (the sim's convention).
    scratch[0] = -Math.sin(heading) * Math.cos(pitch);
    scratch[1] = Math.sin(pitch);
    scratch[2] = Math.cos(heading) * Math.cos(pitch);
    return scratch;
  }

  return {
    el,
    draw(f) {
      resize();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      if (!f.alive) return;
      if (f.style === 'jet') drawJet(f);
      else {
        if (f.style === 'gyro') drawGyro(f);
        else drawReflector(f);
        drawGauges(f);
      }
    },
    dispose() {
      el.remove();
    },
  };
}
