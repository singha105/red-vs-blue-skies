// Hangar: inspect a plane up close. Drag (mouse or finger) to turn it; stats beside it.
import type { GameData, Plane } from '../data/types';
import type { Team } from '../game/flight';
import { PLANE_MODELS } from '../game/planeModels';
import { escapeHtml as esc } from './hud';

export interface HangarUi {
  dispose(): void;
}

export function createHangarUi(
  parent: HTMLElement,
  plane: Plane,
  data: GameData,
  handlers: { onRotate(dx: number, dy: number): void; onZoom(factor: number): void; onTeam(team: Team): void; onBack(): void },
): HangarUi {
  const el = document.createElement('section');
  el.className = 'hangar';
  el.setAttribute('aria-label', `Hangar: ${plane.name}`);
  const guns = plane.guns
    .map((g) => `${g.count}× ${esc(data.guns.find((x) => x.id === g.type)?.name ?? g.type)} (${g.ammoPerGun} rounds each)`)
    .join('<br>');
  const missiles = plane.missiles.length
    ? plane.missiles.map((m) => `${m.count}× ${esc(data.missiles.missiles.find((x) => x.id === m.type)?.name ?? m.type)}`).join('<br>')
    : 'None';
  const model = PLANE_MODELS[plane.id];
  el.innerHTML = `
    <div class="hangar__drag" data-testid="hangar-drag" aria-label="Drag to turn the plane"></div>
    <div class="hangar__panel">
      <div class="hangar__top">
        <button type="button" class="btn btn--secondary btn--small" data-act="back">Back</button>
        <div class="seg" role="radiogroup" aria-label="Team paint">
          <button type="button" role="radio" aria-checked="true" data-team="blue">Blue</button>
          <button type="button" role="radio" aria-checked="false" data-team="red">Red</button>
        </div>
      </div>
      <h2>${esc(plane.name)}</h2>
      <p class="hangar__sub">Tier ${plane.tier} · BR ${plane.br.toFixed(1)} · ${esc(plane.years)}</p>
      <dl class="hangar__stats">
        <dt>Top speed</dt><dd>${plane.stats.topSpeedKmh} km/h</dd>
        <dt>Turn</dt><dd>${plane.stats.turnRateDegS}°/s</dd>
        <dt>Climb</dt><dd>${plane.stats.climbMs} m/s</dd>
        <dt>Roll</dt><dd>${plane.stats.rollRateDegS}°/s</dd>
        <dt>Health</dt><dd>${plane.stats.hp}</dd>
        <dt>Guns</dt><dd>${guns}</dd>
        <dt>Missiles</dt><dd>${missiles}</dd>
        ${model ? `<dt>Size</dt><dd>${model.lengthM} m long, ${model.wingspanM} m span</dd>` : '<dt>Model</dt><dd>Placeholder until its model is built</dd>'}
      </dl>
    </div>
    <p class="hangar__hint">Drag to turn the plane</p>
  `;
  parent.appendChild(el);

  el.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target.closest<HTMLElement>('button') : null;
    if (!t) return;
    if (t.dataset['act'] === 'back') handlers.onBack();
    const team = t.dataset['team'] as Team | undefined;
    if (team) {
      el.querySelectorAll('[data-team]').forEach((b) => b.setAttribute('aria-checked', String(b === t)));
      handlers.onTeam(team);
    }
  });

  const drag = el.querySelector<HTMLElement>('.hangar__drag')!;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  drag.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      drag.setPointerCapture(e.pointerId);
    } catch {
      // synthetic pointers can't be captured
    }
  });
  drag.addEventListener('pointermove', (e) => {
    const last = pointers.get(e.pointerId);
    if (!last) return;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (pinch > 0) handlers.onZoom(pinch / Math.max(1, d));
      pinch = d;
    } else {
      handlers.onRotate(e.clientX - last.x, e.clientY - last.y);
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });
  const end = (e: PointerEvent): void => {
    pointers.delete(e.pointerId);
    pinch = 0;
  };
  drag.addEventListener('pointerup', end);
  drag.addEventListener('pointercancel', end);
  drag.addEventListener('wheel', (e) => handlers.onZoom(e.deltaY > 0 ? 1.08 : 0.93), { passive: true });

  return { dispose: () => el.remove() };
}
