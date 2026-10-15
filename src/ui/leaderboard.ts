// Friends leaderboard: you and everyone you've flown with, by RP earned, kills and K/D. Read from Firestore at
// most every 5 minutes (the store caches it) to keep reads low.
import { earnedRp } from '../game/unlocks';
import { kd, rankBoard, type Board, type LeaderRow } from '../profile/model';
import { BOARD_TTL_MS, type ProfileStore } from '../profile/store';
import { escapeHtml as esc } from './hud';

const COLUMN: Record<Board, string> = { rp: 'RP', kills: 'Kills', kd: 'K/D' };
const BOARDS: [Board, string][] = [
  ['rp', 'Top RP'],
  ['kills', 'Most kills'],
  ['kd', 'Best K/D'],
];

export function openLeaderboard(parent: HTMLElement, store: ProfileStore, onClose?: () => void): { dispose(): void } {
  let board: Board = 'rp';
  let rows: LeaderRow[] | null = null;
  let at = 0;
  let loading = true;
  const el = document.createElement('div');
  el.className = 'modal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Leaderboard');
  parent.appendChild(el);
  const me = (): string | null => store.account?.uid ?? null;

  const value = (r: LeaderRow): string =>
    board === 'rp' ? earnedRp(r.rp, r.unlocked).toLocaleString('en') : board === 'kills' ? r.stats.kills.toLocaleString('en') : kd(r.stats).toFixed(2);

  const body = (): string => {
    if (loading) return '<p class="board__empty">Loading…</p>';
    if (!rows) return `<p class="board__empty">${store.status === 'off' ? 'The leaderboard needs the online profile.' : "Can't reach the server right now. Try again when you're online."}</p>`;
    const ranked = rankBoard(rows, board);
    const list = ranked
      .map(
        (r, i) =>
          `<tr class="${r.uid === me() ? 'row--you' : ''}"><td>${i + 1}</td><td>${esc(r.callsign)}${r.uid === me() ? ' <small>you</small>' : ''}</td><td>${value(r)}</td><td>${r.stats.matches}</td></tr>`,
      )
      .join('');
    const lonely = ranked.length <= 1 ? '<p class="board__empty">Fly a match with friends and they show up here.</p>' : '';
    return `<table class="board__table"><thead><tr><th>#</th><th>Pilot</th><th>${COLUMN[board]}</th><th>Matches</th></tr></thead><tbody>${list}</tbody></table>${lonely}`;
  };

  const render = (): void => {
    const age = at ? Math.round((Date.now() - at) / 60000) : 0;
    const fresh = at > 0 && Date.now() - at < BOARD_TTL_MS;
    el.innerHTML = `
      <div class="modal__card board">
        <h2>Leaderboard</h2>
        <div class="seg" role="radiogroup" aria-label="Board">${BOARDS.map(([b, l]) => `<button type="button" role="radio" aria-checked="${b === board}" data-board="${b}">${l}</button>`).join('')}</div>
        <div class="board__body">${body()}</div>
        <p class="board__foot">${at ? `Updated ${age < 1 ? 'just now' : `${age} min ago`}` : ''} · You and the pilots you've flown with.</p>
        <div class="board__go">
          <button type="button" class="btn btn--secondary btn--small" data-act="refresh" ${loading || fresh ? 'disabled' : ''}>Refresh</button>
          <button type="button" class="btn btn--primary" data-act="close">Done</button>
        </div>
      </div>`;
  };

  const load = (force: boolean): void => {
    loading = true;
    render();
    void store.leaderboard(force).then((res) => {
      loading = false;
      rows = res?.rows ?? null;
      at = res?.at ?? 0;
      render();
    });
  };

  const close = (): void => {
    el.remove();
    window.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  window.addEventListener('keydown', onKey);
  el.addEventListener('click', (e) => {
    if (e.target === el) return close();
    const t = e.target instanceof Element ? e.target.closest<HTMLElement>('button') : null;
    if (!t || t.hasAttribute('disabled')) return;
    if (t.dataset['act'] === 'close') return close();
    if (t.dataset['act'] === 'refresh') return load(true);
    if (t.dataset['board']) {
      board = t.dataset['board'] as Board;
      render();
    }
  });
  load(false);
  return { dispose: close };
}
