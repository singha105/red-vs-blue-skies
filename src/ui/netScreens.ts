// Before the room: pick a callsign, then host or join. Plus the network debug overlay.
import { readStorage, writeStorage } from '../core/storage';
import { cleanCallsign } from '../net/protocol';
import { parseRoomCode } from '../net/roomCode';
import { escapeHtml as esc } from './hud';

const CALLSIGN_KEY = 'rvbs.callsign.v1';

export const savedCallsign = (): string => readStorage(CALLSIGN_KEY) ?? '';

export interface StatusScreen {
  setStatus(text: string, error?: boolean): void;
  setBusy(busy: boolean): void;
  dispose(): void;
}

function statusOf(el: HTMLElement): Pick<StatusScreen, 'setStatus' | 'setBusy'> {
  const status = el.querySelector<HTMLElement>('.netmenu__status')!;
  return {
    setStatus(text, error = false) {
      status.textContent = text;
      status.classList.toggle('is-error', error);
    },
    setBusy(busy) {
      for (const b of el.querySelectorAll<HTMLButtonElement>('button')) b.disabled = busy && b.dataset['act'] !== 'back';
    },
  };
}

/** Step 1: your callsign. With a share link (?room=CODE) the button joins that room straight away. */
export function createCallsignScreen(
  parent: HTMLElement,
  opts: { room: string | null },
  handlers: { onContinue(callsign: string): void; onBack(): void },
): StatusScreen {
  const el = document.createElement('section');
  el.className = 'netmenu netmenu--callsign';
  el.setAttribute('aria-label', 'Pick a callsign');
  el.innerHTML = `
    <header class="netmenu__head">
      <button type="button" class="btn btn--secondary btn--small" data-act="back">Back</button>
      <h2>${opts.room ? `Join room ${esc(opts.room)}` : 'Play with friends'}</h2>
    </header>
    <form class="netmenu__callsign">
      <label class="field"><span>Your callsign</span>
        <input type="text" name="callsign" maxlength="16" autocomplete="nickname" autocapitalize="words" spellcheck="false" placeholder="Maverick" value="${esc(savedCallsign())}" />
      </label>
      <button type="submit" class="btn btn--primary" data-act="go">${opts.room ? 'Join' : 'Continue'}</button>
    </form>
    <p class="netmenu__status" role="status" aria-live="polite"></p>
  `;
  parent.appendChild(el);
  const input = el.querySelector<HTMLInputElement>('input')!;
  const s = statusOf(el);
  input.focus();
  el.querySelector('[data-act="back"]')!.addEventListener('click', handlers.onBack);
  el.querySelector('form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = input.value.trim();
    if (raw.length < 2) {
      s.setStatus('Pick a callsign of at least 2 letters.', true);
      input.focus();
      return;
    }
    const clean = cleanCallsign(raw);
    writeStorage(CALLSIGN_KEY, clean);
    handlers.onContinue(clean);
  });
  return { ...s, dispose: () => el.remove() };
}

/** Step 2: host a room or join one by code. */
export function createNetMenu(
  parent: HTMLElement,
  opts: { room: string | null; turn: boolean; callsign: string },
  handlers: { onHost(): void; onJoin(code: string): void; onBack(): void },
): StatusScreen {
  const el = document.createElement('section');
  el.className = 'netmenu';
  el.setAttribute('aria-label', 'Host or join a match');
  el.innerHTML = `
    <header class="netmenu__head">
      <button type="button" class="btn btn--secondary btn--small" data-act="back">Back</button>
      <h2>Host or join</h2>
      <p class="netmenu__as">Flying as <b>${esc(opts.callsign)}</b></p>
    </header>
    <div class="netmenu__cols">
      <div class="netmenu__card">
        <h3>Host a match</h3>
        <p>Your browser runs the match. Best on a laptop on Wi-Fi, plugged in.</p>
        <button type="button" class="btn btn--primary" data-act="host">Host</button>
      </div>
      <div class="netmenu__card">
        <h3>Join a match</h3>
        <label class="field"><span>Room code</span>
          <input type="text" name="code" maxlength="5" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XQZK" value="${esc(opts.room ?? '')}" />
        </label>
        <button type="button" class="btn btn--primary" data-act="join">Join</button>
      </div>
    </div>
    <p class="netmenu__status" role="status" aria-live="polite"></p>
    ${opts.turn ? '' : '<p class="netmenu__note">Phones on mobile data may not connect yet (no relay server configured). Wi-Fi works.</p>'}
  `;
  parent.appendChild(el);
  const code = el.querySelector<HTMLInputElement>('input[name="code"]')!;
  const s = statusOf(el);
  el.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-act]') : null;
    const act = t?.dataset['act'];
    if (act === 'back') handlers.onBack();
    if (act === 'host') handlers.onHost();
    if (act === 'join') {
      const c = parseRoomCode(code.value);
      if (!c) {
        s.setStatus('Room codes are 4 letters, like XQZK.', true);
        code.focus();
        return;
      }
      handlers.onJoin(c);
    }
  });
  code.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el.querySelector<HTMLButtonElement>('[data-act="join"]')!.click();
  });
  return { ...s, dispose: () => el.remove() };
}

/** Joining a room: a plain status screen while connecting, with errors and a Back button. */
export function createConnecting(parent: HTMLElement, text: string, onBack: () => void): StatusScreen {
  const el = document.createElement('section');
  el.className = 'netmenu';
  el.setAttribute('aria-label', 'Connecting');
  el.innerHTML = `
    <header class="netmenu__head">
      <button type="button" class="btn btn--secondary btn--small" data-act="back">Back</button>
      <h2>Connecting</h2>
    </header>
    <p class="netmenu__status" role="status" aria-live="polite"></p>`;
  parent.appendChild(el);
  el.querySelector('[data-act="back"]')!.addEventListener('click', onBack);
  const s = statusOf(el);
  s.setStatus(text);
  return { ...s, dispose: () => el.remove() };
}

export function createNetOverlay(parent: HTMLElement): { update(lines: string[]): void; dispose(): void } {
  const el = document.createElement('div');
  el.className = 'netstats';
  el.dataset['testid'] = 'netstats';
  parent.appendChild(el);
  let last = '';
  return {
    update(lines) {
      const text = lines.join('\n');
      if (text !== last) {
        last = text;
        el.textContent = text;
      }
    },
    dispose: () => el.remove(),
  };
}
