// Flight HUD as an HTML/CSS overlay: flight readouts, health and damaged parts, ammo, score and clock,
// kill feed, scoreboard, hit markers, damage-direction arrows, lead indicator, plane markers, minimap,
// and the killcam / respawn screen. DOM writes only happen when a shown value changes.
import type { Team } from '../game/flight';
import { createMissileHud, type WeaponsFrame } from './missileHud';

export type ScreenPoint = { x: number; y: number } | null;

export interface Marker {
  x: number;
  y: number;
  team: Team;
  enemy: boolean;
  distM: number;
}

export interface ScoreRow {
  name: string;
  team: Team;
  plane: string;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  you: boolean;
}

/** Mode objectives on screen: zones (letters), ground targets and bombers. */
export interface ObjectiveMarker {
  x: number;
  y: number;
  kind: 'zone' | 'unit' | 'bomber';
  /** Owner (zones), the unit's team, or null for a neutral zone. */
  team: Team | null;
  enemy: boolean;
  label: string;
}

export interface ObjectiveFrame {
  /** What the two numbers at the top count: Kills, Tickets or Points. */
  scoreLabel: string;
  /** The mode in a line (shown at the start and while nothing else is happening). */
  role: string;
  zones: { letter: string; owner: Team | null; progress: number }[];
  /** Live status: "Capturing B · 45%", "Bombers inbound · 3 left"… */
  status: string;
}

export interface HudFrame {
  speedKmh: number;
  altitudeM: number;
  throttle: number;
  g: number;
  stalled: boolean;
  edgeWarning: boolean;
  autoTurn: boolean;
  alive: boolean;
  hp: number;
  maxHp: number;
  damaged: { engine: boolean; wingL: boolean; wingR: boolean };
  onFire: boolean;
  protectedFor: number;
  ammo: { label: string; rounds: number }[];
  aim: ScreenPoint;
  nose: ScreenPoint;
  lead: ScreenPoint;
  markers: Marker[];
  map: { x: number; z: number; heading: number };
  mapDots: { x: number; z: number; team: Team }[];
  score: Record<Team, number>;
  timeLeftS: number;
  killLimit: number;
  freeLook: boolean;
  hint: string;
  /** Missiles, countermeasures and threats (null for planes without any, and in menus). */
  weapons: WeaponsFrame | null;
  objective: ObjectiveFrame;
  objMarkers: ObjectiveMarker[];
  /** Minimap symbols: zones as letters, ground targets as squares (x, z in −1..1 like mapDots). */
  mapObjects: { x: number; z: number; kind: 'zone' | 'unit'; team: Team | null; label: string }[];
  death: null | { phase: 'killcam' | 'respawn'; killer: string | null; respawnIn: number };
}

export interface Hud {
  readonly el: HTMLElement;
  update(f: HudFrame): void;
  hitMarker(kill: boolean): void;
  /** Screen angle (radians, 0 = up, clockwise) toward whoever just hit you. */
  damageFrom(angle: number): void;
  killFeed(html: string, mine: boolean): void;
  /** A plain-text notice in the middle of the screen for `seconds` (the phone-host warning). */
  notice(text: string, seconds: number): void;
  setScoreboard(rows: ScoreRow[] | null): void;
  readonly scoreboardOpen: boolean;
  dispose(): void;
}

const MAX_MARKERS = 24;
const MAX_DOTS = 24;
const MAX_OBJ = 16;
const MAX_MAP_OBJ = 40;

const esc = (s: string): string => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
export { esc as escapeHtml };

export function createHud(parent: HTMLElement, handlers: { onMenu(): void; onScores(open: boolean): void }): Hud {
  const el = document.createElement('div');
  el.className = 'hud';
  el.innerHTML = `
    <div class="hud__markers" aria-hidden="true">${'<div class="mk"><span></span></div>'.repeat(MAX_MARKERS)}</div>
    <button type="button" class="hud__menu" aria-label="Leave the match">Menu</button>
    <button type="button" class="hud__scores-btn" aria-label="Scoreboard" aria-pressed="false">Scores</button>
    <div class="hud__objmarks" aria-hidden="true">${'<div class="omk"><b></b><span></span></div>'.repeat(MAX_OBJ)}</div>
    <div class="hud__top" aria-live="off">
      <span class="hud__team hud__team--blue" data-k="blue">0</span>
      <span class="hud__mid"><span class="hud__clock" data-k="clock">10:00</span><span class="hud__label" data-k="label">Kills</span></span>
      <span class="hud__team hud__team--red" data-k="red">0</span>
    </div>
    <div class="hud__zones" aria-label="Zones"></div>
    <div class="hud__obj" role="status" data-k="obj"></div>
    <div class="hud__reticle" data-testid="reticle" aria-hidden="true"></div>
    <div class="hud__nose" data-testid="nose" aria-hidden="true"></div>
    <div class="hud__lead" data-testid="lead" aria-hidden="true"></div>
    <div class="hud__hitmark" aria-hidden="true"></div>
    <div class="hud__arrows" aria-hidden="true">${'<div class="hud__arrow"></div>'.repeat(4)}</div>
    <div class="hud__readout">
      <div><span class="hud__value" data-k="speed">0</span><span class="hud__unit">km/h</span></div>
      <div><span class="hud__value" data-k="alt">0</span><span class="hud__unit">m</span></div>
      <div class="hud__small"><span data-k="thr">80</span>% throttle · <span data-k="g">1.0</span> G</div>
    </div>
    <div class="hud__status">
      <div class="hud__hp" role="meter" aria-label="Health" aria-valuemin="0" aria-valuemax="100"><div class="hud__hp-fill"></div></div>
      <div class="hud__parts">
        <span class="part" data-part="engine">Engine</span>
        <span class="part" data-part="wingL">L wing</span>
        <span class="part" data-part="wingR">R wing</span>
        <span class="part part--fire" data-part="fire">Fire</span>
      </div>
      <div class="hud__ammo" data-k="ammo"></div>
    </div>
    <div class="hud__warn" role="status" aria-live="assertive"></div>
    <div class="hud__feed" aria-live="polite"></div>
    <div class="hud__hint"></div>
    <div class="hud__notice" role="status" hidden></div>
    <div class="hud__map" aria-label="Minimap">${'<i class="mo"></i>'.repeat(MAX_MAP_OBJ)}${'<i class="dot"></i>'.repeat(MAX_DOTS)}<div class="hud__map-dot"></div></div>
    <div class="hud__death" hidden><div class="hud__death-title"></div><div class="hud__death-sub"></div></div>
    <div class="hud__board" hidden><table><thead><tr><th>Pilot</th><th>Plane</th><th>K</th><th>D</th><th>A</th><th>Dmg</th></tr></thead><tbody></tbody></table></div>
  `;
  parent.appendChild(el);
  const missiles = createMissileHud(el);

  const q = <T extends HTMLElement>(sel: string): T => el.querySelector<T>(sel)!;
  const qa = (sel: string): HTMLElement[] => [...el.querySelectorAll<HTMLElement>(sel)];
  q('.hud__menu').addEventListener('click', handlers.onMenu);
  const scoresBtn = q<HTMLButtonElement>('.hud__scores-btn');
  let boardOpen = false;
  scoresBtn.addEventListener('click', () => handlers.onScores(!boardOpen));
  // Tapping the team scores opens the scoreboard too (phones).
  q('.hud__top').addEventListener('click', () => handlers.onScores(!boardOpen));

  let noticeTimer = 0;
  const reticle = q('.hud__reticle');
  const nose = q('.hud__nose');
  const lead = q('.hud__lead');
  const hitmark = q('.hud__hitmark');
  const arrows = qa('.hud__arrow');
  const markers = qa('.mk');
  const dots = qa('.hud__map .dot');
  const mapObjs = qa('.hud__map .mo');
  const objMarks = qa('.omk');
  const zonesEl = q('.hud__zones');
  const playerDot = q('.hud__map-dot');
  const hpFill = q('.hud__hp-fill');
  const hpBar = q('.hud__hp');
  const parts = Object.fromEntries(qa('.part').map((p) => [p.dataset['part']!, p]));
  const warn = q('.hud__warn');
  const hint = q('.hud__hint');
  const feed = q('.hud__feed');
  const death = q('.hud__death');
  const deathTitle = q('.hud__death-title');
  const deathSub = q('.hud__death-sub');
  const board = q('.hud__board');
  const boardBody = q('.hud__board tbody');
  const fields = Object.fromEntries(qa('[data-k]').map((n) => [n.dataset['k']!, n]));

  const last: Record<string, string> = {};
  const text = (key: string, value: string): void => {
    if (last[key] === value) return;
    last[key] = value;
    const node = fields[key];
    if (node) node.textContent = value;
  };
  const place = (node: HTMLElement, p: ScreenPoint, show = true): void => {
    const visible = show && p !== null;
    node.style.visibility = visible ? 'visible' : 'hidden';
    if (visible) node.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%)`;
  };
  let arrowNext = 0;
  let hitTimer = 0;
  // Style and class writes only when the value changes (each write can cost a style recalc on a phone), and the
  // minimap at 10 Hz: a pixel there is ~130 m.
  const setClass = (node: HTMLElement, cls: string): void => {
    if (node.className !== cls) node.className = cls;
  };
  const setStyle = (node: HTMLElement, prop: 'left' | 'top' | 'transform', value: string): void => {
    if (node.style[prop] !== value) node.style[prop] = value;
  };
  let mapFrame = 0;

  return {
    el,
    get scoreboardOpen() {
      return boardOpen;
    },
    update(f) {
      text('speed', String(Math.round(f.speedKmh)));
      text('alt', String(Math.round(f.altitudeM)));
      text('thr', String(Math.round(f.throttle * 100)));
      text('g', f.g.toFixed(1));
      text('blue', String(Math.ceil(f.score.blue)));
      text('red', String(Math.ceil(f.score.red)));
      text('label', f.objective.scoreLabel);
      text('obj', f.objective.status || f.objective.role);
      const zkey = f.objective.zones.map((z) => `${z.letter}${z.owner ?? '-'}${Math.round(z.progress * 10)}`).join('|');
      if (last['zones'] !== zkey) {
        last['zones'] = zkey;
        zonesEl.innerHTML = f.objective.zones
          .map((z) => {
            const toward = z.progress > 0 ? 'blue' : 'red';
            const fill = Math.round(Math.abs(z.progress) * 100);
            return `<span class="zc zc--${z.owner ?? 'none'}" style="--fill:${fill}%;--toward:var(--${toward})">${z.letter}</span>`;
          })
          .join('');
      }
      for (let i = 0; i < MAX_OBJ; i++) {
        const node = objMarks[i]!;
        const m = f.objMarkers[i];
        if (!m) {
          if (node.style.display !== 'none') node.style.display = 'none';
          continue;
        }
        node.style.display = '';
        const cls = `omk omk--${m.kind} omk--${m.team ?? 'none'}${m.enemy ? ' omk--enemy' : ''}`;
        if (node.className !== cls) node.className = cls;
        node.style.transform = `translate(${m.x.toFixed(0)}px, ${m.y.toFixed(0)}px)`;
        const b = node.firstElementChild as HTMLElement;
        const letter = m.kind === 'zone' ? m.label.slice(0, 1) : '';
        if (b.textContent !== letter) b.textContent = letter;
        const span = node.lastElementChild as HTMLElement;
        const label = m.kind === 'zone' ? m.label.slice(2) : m.label;
        if (span.textContent !== label) span.textContent = label;
      }
      const mapNow = mapFrame++ % 6 === 0;
      for (let i = 0; i < (mapNow ? MAX_MAP_OBJ : 0); i++) {
        const node = mapObjs[i]!;
        const o = f.mapObjects[i];
        if (!o) {
          if (node.style.display !== 'none') node.style.display = 'none';
          continue;
        }
        if (node.style.display !== '') node.style.display = '';
        setClass(node, `mo mo--${o.kind} mo--${o.team ?? 'none'}`);
        setStyle(node, 'left', `${((1 - o.x) * 50).toFixed(1)}%`);
        setStyle(node, 'top', `${((1 - o.z) * 50).toFixed(1)}%`);
        if (node.textContent !== o.label) node.textContent = o.label;
      }
      const t = Math.ceil(f.timeLeftS);
      text('clock', f.timeLeftS > 1e8 ? 'Free flight' : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
      text('ammo', f.ammo.map((a) => `${a.label} ${a.rounds}`).join('   '));

      const hpPct = Math.max(0, Math.round((f.hp / f.maxHp) * 100));
      if (last['hp'] !== String(hpPct)) {
        last['hp'] = String(hpPct);
        hpFill.style.transform = `scaleX(${hpPct / 100})`;
        hpBar.setAttribute('aria-valuenow', String(hpPct));
        hpBar.classList.toggle('is-low', hpPct < 35);
      }
      for (const [k, on] of [['engine', f.damaged.engine], ['wingL', f.damaged.wingL], ['wingR', f.damaged.wingR], ['fire', f.onFire]] as const) {
        parts[k]?.classList.toggle('is-hit', on && f.alive);
      }

      const flying = f.alive && f.death === null;
      place(reticle, f.aim, flying && !f.freeLook);
      place(nose, f.nose, flying);
      place(lead, f.lead, flying);
      missiles.update(f.weapons, flying);

      for (let i = 0; i < MAX_MARKERS; i++) {
        const node = markers[i]!;
        const m = f.markers[i];
        if (!m) {
          if (node.style.display !== 'none') node.style.display = 'none';
          continue;
        }
        if (node.style.display !== '') node.style.display = '';
        setClass(node, `mk ${m.enemy ? 'mk--enemy' : 'mk--friend'} mk--${m.team}`);
        node.style.transform = `translate(${m.x.toFixed(0)}px, ${m.y.toFixed(0)}px)`;
        const label = m.enemy ? (m.distM < 1000 ? `${Math.round(m.distM / 10) * 10} m` : `${(m.distM / 1000).toFixed(1)} km`) : '';
        const span = node.firstElementChild as HTMLElement;
        if (span.textContent !== label) span.textContent = label;
      }

      for (let i = 0; i < (mapNow ? MAX_DOTS : 0); i++) {
        const node = dots[i]!;
        const d = f.mapDots[i];
        if (!d) {
          if (node.style.display !== 'none') node.style.display = 'none';
          continue;
        }
        if (node.style.display !== '') node.style.display = '';
        setClass(node, `dot dot--${d.team}`);
        setStyle(node, 'left', `${((1 - d.x) * 50).toFixed(1)}%`);
        setStyle(node, 'top', `${((1 - d.z) * 50).toFixed(1)}%`);
      }
      // Seen from above with +Z up the map, world +X points left.
      if (mapNow) {
        setStyle(playerDot, 'left', `${((1 - f.map.x) * 50).toFixed(1)}%`);
        setStyle(playerDot, 'top', `${((1 - f.map.z) * 50).toFixed(1)}%`);
        setStyle(playerDot, 'transform', `translate(-50%, -50%) rotate(${f.map.heading.toFixed(2)}rad)`);
      }

      let w = '';
      let cls = '';
      if (!f.alive) {
        w = '';
      } else if (f.autoTurn) {
        w = 'Leaving the battle area. Turning back';
        cls = 'is-edge';
      } else if (f.stalled) {
        w = 'Stall. Nose down and add throttle';
        cls = 'is-stall';
      } else if (f.edgeWarning) {
        w = 'Battle area edge ahead';
        cls = 'is-edge';
      } else if (f.protectedFor > 0) {
        w = 'Spawn protection';
        cls = 'is-protect';
      }
      if (last['warn'] !== w) {
        last['warn'] = w;
        warn.textContent = w;
        warn.className = `hud__warn ${cls}`;
      }
      if (last['hint'] !== f.hint) {
        last['hint'] = f.hint;
        hint.textContent = f.hint;
      }

      const deathKey = f.death ? `${f.death.phase}|${f.death.killer}|${Math.ceil(f.death.respawnIn)}` : '';
      if (last['death'] !== deathKey) {
        last['death'] = deathKey;
        death.hidden = f.death === null;
        if (f.death) {
          deathTitle.textContent = f.death.killer ? `Shot down by ${f.death.killer}` : 'You crashed';
          deathSub.textContent = f.death.phase === 'killcam' ? '' : `Back in the air in ${Math.max(1, Math.ceil(f.death.respawnIn))}`;
          death.classList.toggle('is-killcam', f.death.phase === 'killcam');
        }
      }

      if (hitTimer > 0) {
        hitTimer -= 1 / 60;
        if (hitTimer <= 0) hitmark.classList.remove('is-on', 'is-kill');
      }
    },
    hitMarker(kill) {
      hitmark.classList.remove('is-on');
      void hitmark.offsetWidth; // restart the animation
      hitmark.classList.add('is-on');
      hitmark.classList.toggle('is-kill', kill);
      hitTimer = kill ? 0.6 : 0.25;
    },
    damageFrom(angle) {
      const a = arrows[arrowNext++ % arrows.length]!;
      a.style.transform = `translate(-50%, -50%) rotate(${angle.toFixed(2)}rad) translateY(-90px)`;
      a.classList.remove('is-on');
      void a.offsetWidth;
      a.classList.add('is-on');
    },
    notice(text, seconds) {
      const n = q('.hud__notice');
      n.textContent = text;
      n.hidden = false;
      window.clearTimeout(noticeTimer);
      noticeTimer = window.setTimeout(() => (n.hidden = true), seconds * 1000);
    },
    killFeed(html, mine) {
      const row = document.createElement('div');
      row.className = mine ? 'feed feed--mine' : 'feed';
      row.innerHTML = html;
      feed.prepend(row);
      while (feed.children.length > 5) feed.lastElementChild?.remove();
      window.setTimeout(() => row.remove(), 7000);
    },
    setScoreboard(rows) {
      boardOpen = rows !== null;
      board.hidden = !boardOpen;
      scoresBtn.setAttribute('aria-pressed', String(boardOpen));
      if (!rows) return;
      boardBody.innerHTML = rows
        .map(
          (r) =>
            `<tr class="row--${r.team}${r.you ? ' row--you' : ''}"><td>${esc(r.name)}</td><td>${esc(r.plane)}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${r.assists}</td><td>${Math.round(r.damage)}</td></tr>`,
        )
        .join('');
    },
    dispose() {
      el.remove();
    },
  };
}
