// Multiplayer screens: the Host / Join menu, and the lobby (host and joiners see the same room).
import qrcode from 'qrcode-generator';
import { readStorage, writeStorage } from '../core/storage';
import { adviseHost } from '../net/hostAdvice';
import { cleanCallsign, type LobbyPlayer } from '../net/protocol';
import { parseRoomCode } from '../net/roomCode';
import { escapeHtml as esc } from './hud';

const CALLSIGN_KEY = 'rvbs.callsign.v1';

export const savedCallsign = (): string => readStorage(CALLSIGN_KEY) ?? '';

export function createNetMenu(
  parent: HTMLElement,
  opts: { room: string | null; turn: boolean },
  handlers: { onHost(callsign: string): void; onJoin(code: string, callsign: string): void; onBack(): void },
): { setStatus(text: string, error?: boolean): void; setBusy(busy: boolean): void; dispose(): void } {
  const el = document.createElement('section');
  el.className = 'netmenu';
  el.setAttribute('aria-label', 'Host or join a match');
  el.innerHTML = `
    <header class="netmenu__head">
      <button type="button" class="btn btn--secondary btn--small" data-act="back">Back</button>
      <h2>Play with friends</h2>
    </header>
    <label class="field netmenu__callsign"><span>Your callsign</span>
      <input type="text" name="callsign" maxlength="16" autocomplete="nickname" autocapitalize="words" spellcheck="false" placeholder="Maverick" value="${esc(savedCallsign())}" />
    </label>
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
  const callsign = el.querySelector<HTMLInputElement>('input[name="callsign"]')!;
  const code = el.querySelector<HTMLInputElement>('input[name="code"]')!;
  const status = el.querySelector<HTMLElement>('.netmenu__status')!;
  const buttons = [...el.querySelectorAll<HTMLButtonElement>('button')];
  (opts.room ? callsign.value ? code : callsign : callsign).focus();

  const readCallsign = (): string | null => {
    const raw = callsign.value.trim();
    if (raw.length < 2) {
      status.textContent = 'Pick a callsign of at least 2 letters.';
      status.classList.add('is-error');
      callsign.focus();
      return null;
    }
    const clean = cleanCallsign(raw);
    writeStorage(CALLSIGN_KEY, clean);
    return clean;
  };

  el.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-act]') : null;
    const act = t?.dataset['act'];
    if (act === 'back') handlers.onBack();
    if (act === 'host') {
      const cs = readCallsign();
      if (cs) handlers.onHost(cs);
    }
    if (act === 'join') {
      const cs = readCallsign();
      if (!cs) return;
      const c = parseRoomCode(code.value);
      if (!c) {
        status.textContent = 'Room codes are 4 letters, like XQZK.';
        status.classList.add('is-error');
        code.focus();
        return;
      }
      handlers.onJoin(c, cs);
    }
  });
  code.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el.querySelector<HTMLButtonElement>('[data-act="join"]')!.click();
  });

  return {
    setStatus(text, error = false) {
      status.textContent = text;
      status.classList.toggle('is-error', error);
    },
    setBusy(busy) {
      for (const b of buttons) b.disabled = busy && b.dataset['act'] !== 'back';
    },
    dispose: () => el.remove(),
  };
}

export interface LobbyView {
  update(players: LobbyPlayer[], eraName: string): void;
  setStatus(text: string): void;
  dispose(): void;
}

export function createLobby(
  parent: HTMLElement,
  opts: { isHost: boolean; code: string; link: string },
  handlers: { onStart(): void; onLeave(): void },
): LobbyView {
  const el = document.createElement('section');
  el.className = 'lobby';
  el.setAttribute('aria-label', `Room ${opts.code}`);
  const qr = qrcode(0, 'M');
  qr.addData(opts.link);
  qr.make();
  el.innerHTML = `
    <div class="lobby__room">
      <p class="lobby__label">Room</p>
      <p class="lobby__code" data-testid="room-code">${esc(opts.code)}</p>
      <div class="lobby__qr" aria-label="QR code for the join link">${qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true })}</div>
      <div class="lobby__link">
        <input type="text" readonly value="${esc(opts.link)}" aria-label="Join link" />
        <button type="button" class="btn btn--secondary btn--small" data-act="copy">Copy link</button>
      </div>
    </div>
    <div class="lobby__main">
      <h2>${opts.isHost ? 'Your room' : 'Waiting for the host to start'}</h2>
      <p class="lobby__era"></p>
      <ul class="lobby__players" aria-label="Players"></ul>
      <p class="lobby__advice" role="status"></p>
      <p class="lobby__status" role="status" aria-live="polite"></p>
      <div class="lobby__actions">
        <button type="button" class="btn btn--secondary" data-act="leave">Leave</button>
        ${opts.isHost ? '<button type="button" class="btn btn--primary" data-act="start">Start match</button>' : ''}
      </div>
    </div>
  `;
  parent.appendChild(el);
  const list = el.querySelector<HTMLElement>('.lobby__players')!;
  const advice = el.querySelector<HTMLElement>('.lobby__advice')!;
  const status = el.querySelector<HTMLElement>('.lobby__status')!;
  const era = el.querySelector<HTMLElement>('.lobby__era')!;

  el.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-act]') : null;
    const act = t?.dataset['act'];
    if (act === 'leave') handlers.onLeave();
    if (act === 'start') handlers.onStart();
    if (act === 'copy') {
      const input = el.querySelector<HTMLInputElement>('.lobby__link input')!;
      const done = (ok: boolean): void => {
        status.textContent = ok ? 'Link copied. Paste it in your group chat.' : 'Select the link and copy it.';
      };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(opts.link).then(() => done(true), () => done(false));
      else {
        input.select();
        done(document.execCommand?.('copy') ?? false);
      }
    }
  });

  return {
    update(players, eraName) {
      era.textContent = `${eraName} · Island Chain · Team Deathmatch, 10 v 10 (bots fill the empty seats)`;
      list.innerHTML = players
        .map((p) => {
          const device = p.device.touch ? 'phone / tablet' : 'computer';
          const conn = p.device.connection ? ` · ${esc(p.device.connection)}` : '';
          const ping = p.host ? 'host' : p.pingMs === null ? '…' : `${Math.round(p.pingMs)} ms`;
          return `<li><span class="lobby__name">${esc(p.name)}</span><span class="lobby__meta">${device}${conn}</span><span class="lobby__ping">${ping}</span></li>`;
        })
        .join('');
      const a = adviseHost(players);
      advice.textContent = a.hostOnPhone
        ? 'The host is on a phone: if its screen locks, the match ends for everyone. A laptop on Wi-Fi is the best host.'
        : a.message;
    },
    setStatus(text) {
      status.textContent = text;
    },
    dispose: () => el.remove(),
  };
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
