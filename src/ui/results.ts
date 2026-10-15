// End-of-match screen: winner, awards, both teams' scoreboards with RP earned. Solo shows it on its own;
// multiplayer draws the same thing inside the room view (resultsHtml).
import type { Team } from '../game/flight';
import { AWARDS, type AwardId, type MatchResults } from '../game/results';
import { escapeHtml as esc } from './hud';

export interface ResultsView {
  me: string;
  planeName(id: string): string;
  /** Replaces the headline, e.g. "Host left". */
  title?: string;
  /** Whether your RP was saved (profile sync). */
  save?: string;
}

export function headline(r: MatchResults, yourTeam: Team | null, title?: string): string {
  if (title) return title;
  if (r.winner === 'draw') return 'Draw';
  if (yourTeam && r.winner === yourTeam) return 'Victory';
  if (r.winner) return `${r.winner === 'red' ? 'Red' : 'Blue'} team wins`;
  return 'Match over';
}

export function resultsHtml(r: MatchResults, v: ResultsView): string {
  const mine = r.rows.find((x) => x.id === v.me);
  const yourTeam = mine?.team ?? null;
  const title = headline(r, yourTeam, v.title);
  const win = !v.title && yourTeam !== null && r.winner === yourTeam;
  const awards = (Object.keys(AWARDS) as AwardId[])
    .map((a) => {
      const who = r.rows.filter((x) => x.awards.includes(a));
      if (who.length === 0) return '';
      const names = who.map((x) => `<b class="t-${x.team}">${esc(x.name)}</b>`).join(', ');
      return `<li class="award${who.some((x) => x.id === v.me) ? ' award--you' : ''}"><span class="award__name">${AWARDS[a].name}</span><span class="award__who">${names}</span><small>${AWARDS[a].why}</small></li>`;
    })
    .join('');
  const table = (team: Team): string => `
    <table class="results__table results__table--${team}">
      <caption>${team === 'blue' ? 'Blue' : 'Red'} · ${r.score[team]}${r.br ? ` <small>BR ${r.br[team].toFixed(1)}</small>` : ''}</caption>
      <thead><tr><th>Pilot</th><th title="Kills">K</th><th title="Assists">A</th><th title="Damage, % of a plane">Dmg</th><th title="Deaths">D</th><th title="Research points earned">RP</th></tr></thead>
      <tbody>${r.rows
        .filter((x) => x.team === team)
        .map(
          (x) =>
            `<tr class="${x.id === v.me ? 'row--you' : ''}"><td>${esc(x.name)}<small>${esc(v.planeName(x.planeId))}</small></td><td>${x.kills}</td><td>${x.assists}</td><td>${x.damagePct}%</td><td>${x.deaths}</td><td>${x.bot ? '–' : x.rp.toLocaleString('en')}</td></tr>`,
        )
        .join('')}</tbody>
    </table>`;
  return `
    <h2 class="results__title results__title--${win ? 'win' : 'loss'}">${esc(title)}</h2>
    <p class="results__score"><span class="t-blue">${r.score.blue}</span> – <span class="t-red">${r.score.red}</span>${mine && !mine.bot ? ` <span class="results__rp">+${mine.rp.toLocaleString('en')} RP</span>` : ''}</p>
    ${v.save ? `<p class="results__save" data-testid="save-state">${esc(v.save)}</p>` : ''}
    ${awards ? `<ul class="results__awards" aria-label="Awards">${awards}</ul>` : ''}
    <div class="results__tables">${table('blue')}${table('red')}</div>`;
}

export function showResults(
  parent: HTMLElement,
  r: MatchResults,
  v: ResultsView & { againLabel?: string },
  handlers: { onAgain(): void; onTitle(): void; onResearch?(): void },
): { setSave(text: string): void; dispose(): void } {
  const el = document.createElement('section');
  el.className = 'results';
  el.setAttribute('aria-label', 'Match results');
  el.innerHTML = `
    ${resultsHtml(r, v)}
    <div class="results__actions">
      <button type="button" class="btn btn--primary" data-act="again">${esc(v.againLabel ?? 'Play again')}</button>
      ${handlers.onResearch ? '<button type="button" class="btn btn--secondary" data-act="research">Research</button>' : ''}
      <button type="button" class="btn btn--secondary" data-act="title">Title screen</button>
    </div>
  `;
  parent.appendChild(el);
  el.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-act]') : null;
    if (t?.dataset['act'] === 'again') handlers.onAgain();
    if (t?.dataset['act'] === 'title') handlers.onTitle();
    if (t?.dataset['act'] === 'research') handlers.onResearch?.();
  });
  return {
    setSave(text) {
      const p = el.querySelector('.results__save');
      if (p) p.textContent = text;
    },
    dispose: () => el.remove(),
  };
}
