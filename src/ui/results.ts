// End-of-match screen: winner, both teams' scoreboards, play again.
import type { Team } from '../game/flight';
import { escapeHtml as esc, type ScoreRow } from './hud';

export function showResults(
  parent: HTMLElement,
  r: { winner: Team | 'draw' | null; score: Record<Team, number>; rows: ScoreRow[]; yourTeam: Team },
  handlers: { onAgain(): void; onTitle(): void },
): { dispose(): void } {
  const el = document.createElement('section');
  el.className = 'results';
  el.setAttribute('aria-label', 'Match results');
  const headline =
    r.winner === 'draw' ? 'Draw' : r.winner === r.yourTeam ? 'Victory' : r.winner ? `${r.winner === 'red' ? 'Red' : 'Blue'} team wins` : 'Match over';
  const table = (team: Team): string => `
    <table class="results__table results__table--${team}">
      <caption>${team === 'blue' ? 'Blue' : 'Red'} · ${r.score[team]}</caption>
      <thead><tr><th>Pilot</th><th>K</th><th>D</th><th>A</th><th>Dmg</th></tr></thead>
      <tbody>${r.rows
        .filter((x) => x.team === team)
        .sort((a, b) => b.kills - a.kills || b.damage - a.damage)
        .map((x) => `<tr class="${x.you ? 'row--you' : ''}"><td>${esc(x.name)}<small>${esc(x.plane)}</small></td><td>${x.kills}</td><td>${x.deaths}</td><td>${x.assists}</td><td>${Math.round(x.damage)}</td></tr>`)
        .join('')}</tbody>
    </table>`;
  el.innerHTML = `
    <h2 class="results__title results__title--${r.winner === r.yourTeam ? 'win' : 'loss'}">${headline}</h2>
    <p class="results__score"><span class="t-blue">${r.score.blue}</span> – <span class="t-red">${r.score.red}</span></p>
    <div class="results__tables">${table('blue')}${table('red')}</div>
    <div class="results__actions">
      <button type="button" class="btn btn--primary" data-act="again">Play again</button>
      <button type="button" class="btn btn--secondary" data-act="title">Title screen</button>
    </div>
  `;
  parent.appendChild(el);
  el.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-act]') : null;
    if (t?.dataset['act'] === 'again') handlers.onAgain();
    if (t?.dataset['act'] === 'title') handlers.onTitle();
  });
  return { dispose: () => el.remove() };
}
