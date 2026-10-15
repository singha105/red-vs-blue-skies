// Play Solo → pick an era, a plane and bot difficulty. Tiers 1–3 for now (all planes with ?debug=1);
// Day 8 replaces the tier lock with real research unlocks.
import { readStorage, writeStorage } from '../core/storage';
import type { EraId, GameData, Plane } from '../data/types';
import type { BotDifficulty } from '../game/world';
import { isUnlocked } from '../game/unlocks';
import { escapeHtml as esc } from './hud';

const KEY = 'rvbs.solo.v1';

export interface SoloChoice {
  era: EraId;
  planeId: string;
  difficulty: BotDifficulty;
}

function loadChoice(data: GameData): SoloChoice {
  const fallback: SoloChoice = { era: 'early_ww2', planeId: 'gladiator', difficulty: 'normal' };
  try {
    const saved = JSON.parse(readStorage(KEY) ?? 'null') as Partial<SoloChoice> | null;
    if (!saved) return fallback;
    const plane = data.planes.find((p) => p.id === saved.planeId);
    const difficulty = saved.difficulty === 'easy' || saved.difficulty === 'hard' ? saved.difficulty : 'normal';
    return plane ? { era: plane.era, planeId: plane.id, difficulty } : { ...fallback, difficulty };
  } catch {
    return fallback;
  }
}

export function gunsSummary(plane: Plane, data: GameData): string {
  return plane.guns
    .map((g) => {
      const gun = data.guns.find((x) => x.id === g.type);
      const calibre = gun?.name.split(' ').slice(0, 2).join(' ') ?? g.type;
      return `${g.count}× ${calibre}`;
    })
    .join(', ');
}

export function createSoloSetup(
  parent: HTMLElement,
  data: GameData,
  opts: { allUnlocked: boolean; title?: string; intro?: string; startLabel?: string; hangar?: boolean },
  handlers: { onStart(choice: SoloChoice): void; onBack(): void; onHangar(choice: SoloChoice): void },
): { dispose(): void } {
  const choice = loadChoice(data);
  const unlocked = (p: Plane): boolean => isUnlocked(p, opts.allUnlocked);
  const el = document.createElement('section');
  el.className = 'setup';
  el.setAttribute('aria-label', 'Solo match setup');
  parent.appendChild(el);

  const render = (): void => {
    const planes = data.planes.filter((p) => p.era === choice.era).sort((a, b) => a.tier - b.tier);
    if (!planes.some((p) => p.id === choice.planeId && unlocked(p))) choice.planeId = planes.find(unlocked)?.id ?? planes[0]!.id;
    el.innerHTML = `
      <header class="setup__head">
        <button type="button" class="btn btn--secondary btn--small" data-act="back">Back</button>
        <h2>${esc(opts.title ?? 'Solo match')}</h2>
        <p>${esc(opts.intro ?? 'Team Deathmatch, 10 vs 10 with bots. First to 50 kills, or most kills after 10 minutes.')}</p>
      </header>
      <div class="setup__eras" role="radiogroup" aria-label="Era">
        ${data.eras
          .map((e) => `<button type="button" role="radio" class="chip" aria-checked="${e.id === choice.era}" data-era="${e.id}">${esc(e.name)}<small>${e.yearFrom}–${e.yearTo}</small></button>`)
          .join('')}
      </div>
      <div class="setup__planes" role="radiogroup" aria-label="Plane">
        ${planes
          .map((p) => {
            const open = unlocked(p);
            return `<button type="button" role="radio" class="pcard" aria-checked="${p.id === choice.planeId}" data-plane="${p.id}" ${open ? '' : 'disabled'}>
              <span class="pcard__tier">Tier ${p.tier} · BR ${p.br.toFixed(1)}</span>
              <span class="pcard__name">${esc(p.name)}</span>
              <span class="pcard__stats">${p.stats.topSpeedKmh} km/h · ${esc(gunsSummary(p, data))}</span>
              ${open ? '' : '<span class="pcard__lock">Locked</span>'}
            </button>`;
          })
          .join('')}
      </div>
      <footer class="setup__foot">
        <div class="seg" role="radiogroup" aria-label="Bot difficulty">
          ${(['easy', 'normal', 'hard'] as BotDifficulty[])
            .map((d) => `<button type="button" role="radio" aria-checked="${d === choice.difficulty}" data-diff="${d}">${d[0]!.toUpperCase()}${d.slice(1)}</button>`)
            .join('')}
        </div>
        <div class="setup__go">
          ${opts.hangar === false ? '' : '<button type="button" class="btn btn--secondary" data-act="hangar">Hangar</button>'}
          <button type="button" class="btn btn--primary" data-act="start">${esc(opts.startLabel ?? 'Start match')}</button>
        </div>
      </footer>
    `;
    el.querySelector<HTMLElement>('[aria-checked="true"][data-plane]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };

  el.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target.closest<HTMLElement>('button') : null;
    if (!t || t.hasAttribute('disabled')) return;
    if (t.dataset['act'] === 'back') return handlers.onBack();
    if (t.dataset['act'] === 'hangar') {
      writeStorage(KEY, JSON.stringify(choice));
      return handlers.onHangar({ ...choice });
    }
    if (t.dataset['act'] === 'start') {
      writeStorage(KEY, JSON.stringify(choice));
      return handlers.onStart({ ...choice });
    }
    if (t.dataset['era']) choice.era = t.dataset['era'] as EraId;
    if (t.dataset['plane']) choice.planeId = t.dataset['plane'];
    if (t.dataset['diff']) choice.difficulty = t.dataset['diff'] as BotDifficulty;
    render();
  });

  render();
  return { dispose: () => el.remove() };
}
