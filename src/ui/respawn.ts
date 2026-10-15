// Respawn screen plane picker: the era's unlocked planes with their spawn-point cost. Ones you can't afford
// are greyed out; the tier-1 reserve is always free, so nobody is ever stuck on the ground.
import type { Plane } from '../data/types';
import { isUnlocked, SP_ASSIST, SP_KILL, spawnCost } from '../game/unlocks';
import type { Silhouettes } from '../render/silhouettes';
import { escapeHtml as esc } from './hud';

export interface RespawnPicker {
  update(f: { visible: boolean; sp: number; selected: string }): void;
  dispose(): void;
}

export function createRespawnPicker(
  parent: HTMLElement,
  opts: { planes: readonly Plane[]; allUnlocked: boolean; silhouettes: Silhouettes },
  onPick: (planeId: string) => void,
): RespawnPicker {
  const list = opts.planes.filter((p) => isUnlocked(p, opts.allUnlocked)).sort((a, b) => a.tier - b.tier);
  const reserve = list[0]?.id ?? '';
  const el = document.createElement('div');
  el.className = 'respawn';
  el.hidden = true;
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Next plane');
  parent.appendChild(el);
  let key = '';

  const cost = (p: Plane): number => (p.id === reserve ? 0 : spawnCost(p.tier));

  el.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-plane]') : null;
    if (t && !t.hasAttribute('disabled') && t.dataset['plane']) onPick(t.dataset['plane']);
  });

  return {
    update(f) {
      const affordable = (p: Plane): boolean => cost(p) <= f.sp;
      const sel = list.find((p) => p.id === f.selected);
      // What you'll actually get: your pick if you can pay for it, otherwise the reserve.
      const effective = sel && affordable(sel) ? sel.id : reserve;
      const k = `${f.visible}|${f.sp}|${effective}`;
      if (k === key) return;
      key = k;
      el.hidden = !f.visible;
      if (!f.visible) return;
      el.innerHTML = `
        <p class="respawn__sp"><b>${f.sp} SP</b> · next plane <small>(+${SP_KILL} per kill, +${SP_ASSIST} per assist)</small></p>
        <div class="respawn__cards">${list
          .map((p) => {
            const c = cost(p);
            const ok = affordable(p);
            return `<button type="button" class="rcard${ok ? '' : ' rcard--poor'}" data-plane="${p.id}" aria-pressed="${p.id === effective}" ${ok ? '' : 'disabled'}>
              <img src="${opts.silhouettes.get(p.id)}" alt="" width="40" height="40" />
              <span class="rcard__name">${esc(p.name)}</span>
              <span class="rcard__cost">${c === 0 ? 'Free' : `${c} SP`}</span>
            </button>`;
          })
          .join('')}</div>`;
    },
    dispose: () => el.remove(),
  };
}
