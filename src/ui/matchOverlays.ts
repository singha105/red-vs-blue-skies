// In-match overlays: the menu (Esc, the Menu button, or the browser releasing the mouse), the chat line
// (Enter), quick chat (J: pick a phrase with 1–4 or a tap) and the solo pause banner (P).
import { QUICK_CHAT } from '../net/protocol';
import { escapeHtml as esc } from './hud';

export interface MatchMenu {
  readonly open: boolean;
  show(): void;
  hide(): void;
  dispose(): void;
}

export function createMatchMenu(
  parent: HTMLElement,
  h: { solo: boolean; onResume(): void; onControls(): void; onSettings(): void; onHelp(): void; onLeave(): void },
): MatchMenu {
  const el = document.createElement('div');
  el.className = 'modal mmenu';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Menu');
  el.dataset['testid'] = 'match-menu';
  el.hidden = true;
  el.innerHTML = `
    <div class="modal__card mmenu__card">
      <h2>${h.solo ? 'Paused' : 'Menu'}</h2>
      ${h.solo ? '' : '<p class="mmenu__note">The match keeps going while this is open.</p>'}
      <button type="button" class="btn btn--primary" data-act="resume">Resume</button>
      <button type="button" class="btn btn--secondary" data-act="controls">Controls</button>
      <button type="button" class="btn btn--secondary" data-act="settings">Settings</button>
      <button type="button" class="btn btn--secondary" data-act="help">How to play</button>
      <button type="button" class="btn btn--secondary" data-act="leave">Leave match</button>
    </div>
  `;
  parent.appendChild(el);
  el.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset['act'];
    if (e.target === el || act === 'resume') return h.onResume();
    if (act === 'controls') h.onControls();
    else if (act === 'settings') h.onSettings();
    else if (act === 'help') h.onHelp();
    else if (act === 'leave') h.onLeave();
  });
  return {
    get open() {
      return !el.hidden;
    },
    show() {
      el.hidden = false;
      el.querySelector<HTMLButtonElement>('[data-act="resume"]')?.focus();
    },
    hide() {
      el.hidden = true;
    },
    dispose() {
      el.remove();
    },
  };
}

export interface MatchChat {
  readonly typing: boolean;
  readonly quickOpen: boolean;
  openInput(): void;
  toggleQuick(): void;
  /** A digit while quick chat is open picks a phrase; returns true if it was used. */
  quickKey(code: string): boolean;
  dispose(): void;
}

export function createMatchChat(parent: HTMLElement, send: (text: string) => void, onTyping: (typing: boolean) => void): MatchChat {
  const el = document.createElement('div');
  el.className = 'mchat';
  el.innerHTML = `
    <form class="mchat__form" hidden><input type="text" maxlength="80" autocomplete="off" enterkeyhint="send" placeholder="Say something (Enter sends, Esc closes)" aria-label="Chat message" /></form>
    <div class="mchat__quick" hidden role="group" aria-label="Quick chat">${QUICK_CHAT.map((q, i) => `<button type="button" class="chip chip--small" data-q="${i}">${i + 1} ${esc(q)}</button>`).join('')}</div>
  `;
  parent.appendChild(el);
  const form = el.querySelector<HTMLFormElement>('.mchat__form')!;
  const input = el.querySelector<HTMLInputElement>('input')!;
  const quick = el.querySelector<HTMLElement>('.mchat__quick')!;
  let quickTimer = 0;
  const closeInput = (): void => {
    form.hidden = true;
    input.value = '';
    input.blur();
    onTyping(false);
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (text) send(text);
    closeInput();
  });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') closeInput();
  });
  input.addEventListener('blur', () => {
    if (!form.hidden) closeInput();
  });
  const pick = (i: number): void => {
    const q = QUICK_CHAT[i];
    if (q) send(q);
    quick.hidden = true;
  };
  quick.addEventListener('click', (e) => {
    const q = (e.target as HTMLElement).closest<HTMLElement>('[data-q]')?.dataset['q'];
    if (q !== undefined) pick(Number(q));
  });
  return {
    get typing() {
      return !form.hidden;
    },
    get quickOpen() {
      return !quick.hidden;
    },
    openInput() {
      quick.hidden = true;
      form.hidden = false;
      onTyping(true);
      input.focus();
    },
    toggleQuick() {
      quick.hidden = !quick.hidden;
      window.clearTimeout(quickTimer);
      if (!quick.hidden) quickTimer = window.setTimeout(() => (quick.hidden = true), 5000);
    },
    quickKey(code) {
      if (quick.hidden || !code.startsWith('Digit')) return false;
      const i = Number(code.slice(5)) - 1;
      if (i < 0 || i >= QUICK_CHAT.length) return false;
      pick(i);
      return true;
    },
    dispose() {
      window.clearTimeout(quickTimer);
      el.remove();
    },
  };
}
