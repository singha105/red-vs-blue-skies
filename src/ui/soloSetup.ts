// Play Solo → pick an era, a plane, bot difficulty, the map and the mode. Planes are open as far as you've researched each era
// (everything with ?debug=1 on localhost).
import { readStorage, writeStorage } from '../core/storage';
import type { EraId, GameData, GameMode, Plane } from '../data/types';
import type { BotDifficulty } from '../game/world';
import { isUnlocked, unlockCost, type Unlocks } from '../game/unlocks';
import { escapeHtml as esc } from './hud';

const KEY = 'rvbs.solo.v1';

export interface SoloChoice {
  era: EraId;
  planeId: string;
  difficulty: BotDifficulty;
  /** Map and mode ids (default: the default map, Team Deathmatch). */
  map?: string;
  mode?: GameMode['id'];
}

function loadChoice(data: GameData): SoloChoice {
  const map = data.maps.find((m) => m.default)!.id;
  const fallback: SoloChoice = { era: 'early_ww2', planeId: 'gladiator', difficulty: 'normal', map, mode: 'tdm' };
  try {
    const saved = JSON.parse(readStorage(KEY) ?? 'null') as Partial<SoloChoice> | null;
    if (!saved) return fallback;
    const plane = data.planes.find((p) => p.id === saved.planeId);
    const difficulty = saved.difficulty === 'easy' || saved.difficulty === 'hard' ? saved.difficulty : 'normal';
    const savedMap = data.maps.find((m) => m.id === saved.map)?.id ?? map;
    const savedMode = data.modes.find((m) => m.id === saved.mode && m.playable)?.id ?? 'tdm';
    return plane ? { era: plane.era, planeId: plane.id, difficulty, map: savedMap, mode: savedMode } : { ...fallback, difficulty, map: savedMap, mode: savedMode };
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
  opts: { unlocks: () => Unlocks; title?: string; intro?: string; startLabel?: string; hangar?: boolean; matchPickers?: boolean },
  handlers: { onStart(choice: SoloChoice): void; onBack(): void; onHangar(choice: SoloChoice): void; onResearch?(era: EraId): void },
): { dispose(): void } {
  const choice = loadChoice(data);
  const unlocked = (p: Plane): boolean => isUnlocked(p, opts.unlocks());
  const el = document.createElement('section');
  el.className = 'setup';
  el.setAttribute('aria-label', 'Solo match setup');
  parent.appendChild(el);

  const render = (): void => {
    const planes = data.planes.filter((p) => p.era === choice.era).sort((a, b) => a.tier - b.tier);
    if (!planes.some((p) => p.id === choice.planeId && unlocked(p))) choice.planeId = planes.find(unlocked)?.id ?? planes[0]!.id;
    const mapName = data.maps.find((m) => m.id === choice.map)?.name ?? '';
    const mode = data.modes.find((m) => m.id === choice.mode) ?? data.modes[0]!;
    // Map and mode cycle on each tap: two compact buttons instead of two more rows of chips on a phone.
    const pickers = opts.matchPickers === false
      ? ''
      : `<div class="setup__match">
          <button type="button" class="chip chip--small" data-cycle="map" aria-label="Map: ${esc(mapName)}. Tap for the next map"><small>Map</small>${esc(mapName)}</button>
          <button type="button" class="chip chip--small" data-cycle="mode" aria-label="Mode: ${esc(mode.name)}. Tap for the next mode"><small>Mode</small>${esc(mode.name)}</button>
        </div>`;
    el.innerHTML = `
      <header class="setup__head">
        <button type="button" class="btn btn--secondary btn--small" data-act="back">Back</button>
        <h2>${esc(opts.title ?? 'Solo match')}</h2>
        ${pickers}
        <p>${esc(opts.intro ?? `${mode.name}, 10 vs 10 with bots. ${mode.description}`)}</p>
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
              ${open ? '' : `<span class="pcard__lock">Locked · ${unlockCost(p.tier).toLocaleString('en')} RP</span>`}
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
          ${handlers.onResearch ? '<button type="button" class="btn btn--secondary" data-act="research">Research</button>' : ''}
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
    if (t.dataset['act'] === 'research') {
      writeStorage(KEY, JSON.stringify(choice));
      return handlers.onResearch?.(choice.era);
    }
    if (t.dataset['act'] === 'hangar') {
      writeStorage(KEY, JSON.stringify(choice));
      return handlers.onHangar({ ...choice });
    }
    if (t.dataset['act'] === 'start') {
      writeStorage(KEY, JSON.stringify(choice));
      return handlers.onStart({ ...choice });
    }
    if (t.dataset['cycle'] === 'map') {
      const i = data.maps.findIndex((m) => m.id === choice.map);
      choice.map = data.maps[(i + 1) % data.maps.length]!.id;
    }
    if (t.dataset['cycle'] === 'mode') {
      const modes = data.modes.filter((m) => m.playable);
      const i = modes.findIndex((m) => m.id === choice.mode);
      choice.mode = modes[(i + 1) % modes.length]!.id;
    }
    if (t.dataset['era']) choice.era = t.dataset['era'] as EraId;
    if (t.dataset['plane']) choice.planeId = t.dataset['plane'];
    if (t.dataset['diff']) choice.difficulty = t.dataset['diff'] as BotDifficulty;
    render();
  });

  render();
  return { dispose: () => el.remove() };
}
