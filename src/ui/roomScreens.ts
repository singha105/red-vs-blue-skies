// The multiplayer room once you're in: lobby → vote → teams → plane select → (match) → results → lobby.
// One persistent view redraws the part that belongs to the room's current phase. The host owns the state:
// buttons here only send requests (or, on the host, call its controls directly).
import qrcode from 'qrcode-generator';
import type { GameData, Plane } from '../data/types';
import type { Team } from '../game/flight';
import type { MatchResults } from '../game/results';
import { brGap } from '../game/teams';
import { cleanUnlocks, isUnlocked, unlockCost } from '../game/unlocks';
import type { ChatLine } from '../net/clientSession';
import { adviseHost } from '../net/hostAdvice';
import { QUICK_CHAT, VOTE_CATEGORIES, type ClientMsg, type RoomPlayer, type RoomSettings, type RoomState, type VoteCategory } from '../net/protocol';
import { MATCH_LENGTHS_S, voteCounts } from '../net/room';
import type { Silhouettes } from '../render/silhouettes';
import { escapeHtml as esc } from './hud';
import { headline, resultsHtml } from './results';
import { gunsSummary } from './soloSetup';

export interface HostControls {
  startVote(): void;
  override(cat: VoteCategory, id: string | null): void;
  setSettings(s: Partial<RoomSettings>): void;
  kick(playerId: string): void;
  playAgain(): void;
}

export interface RoomViewDeps {
  data: GameData;
  code: string;
  link: string;
  meId(): string;
  timeLeftMs(): number | null;
  request(m: ClientMsg): void;
  /** Present only on the host. */
  host: HostControls | null;
  silhouettes: Silhouettes;
  onLeave(): void;
  /** Open the research screen (lobby and results, between rounds). */
  onResearch?(): void;
  /** Whether your RP from the last match was saved. */
  saveNote?(): string;
}

export interface RoomView {
  update(room: RoomState, results: MatchResults | null): void;
  chat(lines: readonly ChatLine[]): void;
  /** Call a few times a second: timers and late-loading silhouettes. */
  tick(): void;
  dispose(): void;
}

const CAT_LABEL: Record<VoteCategory, string> = { era: 'Era', map: 'Map', mode: 'Mode' };
const TITLE: Record<RoomState['phase'], string> = {
  lobby: 'Lobby',
  vote: 'Vote',
  teams: 'Teams',
  select: 'Pick your plane',
  playing: 'Match in progress',
  results: 'Results',
};

/** Set innerHTML only when it changed, so a redraw never eats a tap that is halfway through. */
function part(el: Element | null, html: string): void {
  if (el && (el as HTMLElement & { _html?: string })._html !== html) {
    (el as HTMLElement & { _html?: string })._html = html;
    el.innerHTML = html;
  }
}

const clock = (ms: number | null): string => {
  if (ms === null) return '';
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const TIMER_LABEL: Partial<Record<RoomState['phase'], string>> = { teams: 'Planes in', results: 'Lobby in' };

export function createRoomView(parent: HTMLElement, deps: RoomViewDeps): RoomView {
  const { data, host } = deps;
  const isHost = host !== null;
  const planes = new Map(data.planes.map((p) => [p.id, p]));
  const planeName = (id: string): string => planes.get(id)?.name ?? '';
  const optionName = (cat: VoteCategory, id: string): string =>
    (cat === 'era' ? data.eras.find((e) => e.id === id)?.name : cat === 'map' ? data.maps.find((m) => m.id === id)?.name : data.modes.find((m) => m.id === id)?.name) ?? id;

  const el = document.createElement('section');
  el.className = 'room';
  el.setAttribute('aria-label', `Room ${deps.code}`);
  const qr = qrcode(0, 'M');
  qr.addData(deps.link);
  qr.make();
  el.innerHTML = `
    <header class="room__head">
      <button type="button" class="btn btn--secondary btn--small" data-act="leave">Leave</button>
      <h2 class="room__title">Lobby</h2>
      <span class="room__timer" aria-live="off"></span>
      <span class="room__code">Room <b data-testid="room-code">${esc(deps.code)}</b></span>
      <button type="button" class="btn btn--secondary btn--tiny room__copy" data-act="copy">Copy link</button>
    </header>
    <div class="room__share">
      <div class="lobby__qr" aria-label="QR code for the join link">${qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true })}</div>
      <div class="lobby__link">
        <input type="text" readonly value="${esc(deps.link)}" aria-label="Join link" />
        <button type="button" class="btn btn--secondary btn--small" data-act="copy">Copy link</button>
      </div>
    </div>
    <div class="room__body"></div>
    <aside class="room__chat" aria-label="Chat">
      <ol class="chat__lines" aria-live="polite"></ol>
      <div class="chat__quick">${QUICK_CHAT.map((q) => `<button type="button" class="chip chip--small" data-chat="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <form class="chat__form"><input type="text" name="chat" maxlength="80" autocomplete="off" placeholder="Say something" aria-label="Chat message" /><button type="submit" class="btn btn--secondary btn--small">Send</button></form>
    </aside>
    <p class="room__status" role="status"></p>
  `;
  parent.appendChild(el);
  const q = <T extends Element = HTMLElement>(s: string): T => el.querySelector<T>(s)!;
  const title = q('.room__title');
  const timer = q('.room__timer');
  const body = q('.room__body');
  const share = q('.room__share');
  const chatEl = q('.room__chat');
  const status = q('.room__status');
  const chatInput = q<HTMLInputElement>('.chat__form input');

  let room: RoomState | null = null;
  let results: MatchResults | null = null;
  let shownPhase = '';
  let shownRound = 0;
  let force = false; // host: taps in the vote set the override instead of voting
  let silhouetteCheck = 0;
  // Plane select: your latest tap, ahead of the host's confirmation, so "Fly the …" always locks what you see.
  let localPick: string | null = null;

  const me = (): RoomPlayer | undefined => room?.players.find((p) => p.id === deps.meId());

  // ---------------------------------------------------------------- phase skeletons (built once per phase)

  const skeleton = (phase: RoomState['phase']): string => {
    switch (phase) {
      case 'lobby':
        return `<div class="rlobby"><ul class="rlist" aria-label="Players"></ul><p class="lobby__advice"></p><div class="rlobby__controls"></div></div>`;
      case 'vote':
        return `<div class="rvote">${isHost ? '<div class="seg rvote__mode" role="radiogroup" aria-label="Tap to"><button type="button" role="radio" data-force="0" aria-checked="true">Vote</button><button type="button" role="radio" data-force="1" aria-checked="false">Host pick</button></div>' : ''}${VOTE_CATEGORIES.map((c) => `<div class="rvote__row" data-row="${c}"></div>`).join('')}<p class="rvote__count"></p></div>`;
      case 'teams':
        return `<div class="rteams"></div>`;
      case 'select':
        return `<div class="rselect"><div class="rselect__cards" role="radiogroup" aria-label="Plane"></div><div class="rselect__foot"><div class="rselect__team"></div><div class="rselect__go"></div></div></div>`;
      case 'playing':
        return `<p class="room__wait">The match is on. Joining…</p>`;
      case 'results':
        return `<div class="rresults"><div class="rresults__table"></div><div class="results__actions"></div></div>`;
    }
  };

  const cardsHtml = (r: RoomState): string => {
    const era = r.choice?.era;
    const list = data.planes.filter((p) => p.era === era).sort((a, b) => a.tier - b.tier);
    return list
      .map((p: Plane) => {
        const mine = r.players.find((x) => x.id === deps.meId())?.unlocked;
        const open = isUnlocked(p, r.allUnlocked ? 'all' : (mine ?? cleanUnlocks(null)));
        return `<button type="button" role="radio" class="pcard pcard--select" data-plane="${p.id}" aria-checked="false" ${open ? '' : 'disabled'}>
          <img class="pcard__img" alt="" src="${deps.silhouettes.get(p.id)}" width="80" height="80" />
          <span class="pcard__tier">Tier ${p.tier} · BR ${p.br.toFixed(1)}</span>
          <span class="pcard__name">${esc(p.name)}</span>
          <span class="pcard__stats">${p.stats.topSpeedKmh} km/h · ${p.stats.turnRateDegS}°/s turn<br />${esc(gunsSummary(p, data))}</span>
          ${open ? '' : `<span class="pcard__lock">Locked · ${unlockCost(p.tier).toLocaleString('en')} RP</span>`}
        </button>`;
      })
      .join('');
  };

  // ---------------------------------------------------------------- dynamic parts

  const deviceLabel = (p: RoomPlayer): string => (p.device.touch ? 'phone / tablet' : 'computer') + (p.device.connection ? ` · ${esc(p.device.connection)}` : '');
  const partyLabel = (r: RoomState): ((id: string | null) => string) => {
    const ids = [...new Set(r.players.map((p) => p.party).filter((x): x is string => Boolean(x)))].sort();
    return (id) => (id ? `Party ${'ABCDEFG'[ids.indexOf(id)] ?? ''}` : '');
  };

  const lobbyList = (r: RoomState): string => {
    const mine = me();
    const party = partyLabel(r);
    return r.players
      .map((p) => {
        const you = p.id === deps.meId();
        const ping = p.host ? 'host' : p.pingMs === null ? '…' : `${Math.round(p.pingMs)} ms`;
        const acts: string[] = [];
        if (you && p.party) acts.push(`<button type="button" class="btn btn--secondary btn--tiny" data-act="unparty">Leave party</button>`);
        if (!you && (!mine?.party || mine.party !== p.party)) acts.push(`<button type="button" class="btn btn--secondary btn--tiny" data-act="party" data-id="${p.id}">Party up</button>`);
        if (isHost && !p.host) acts.push(`<button type="button" class="btn btn--secondary btn--tiny" data-act="kick" data-id="${p.id}" aria-label="Remove ${esc(p.name)}">Remove</button>`);
        return `<li class="rp rp--${p.team ?? 'none'}${you ? ' rp--you' : ''}">
          <span class="rp__name">${esc(p.name)}${p.host ? ' <small>host</small>' : ''}</span>
          <span class="rp__tags">${p.party ? `<span class="tag">${party(p.party)}</span>` : ''}${p.ready && !p.host ? '<span class="tag tag--ready">Ready</span>' : ''}</span>
          <span class="rp__meta">${deviceLabel(p)} · ${ping}</span>
          <span class="rp__acts">${acts.join('')}</span>
        </li>`;
      })
      .join('');
  };

  const seg = (label: string, key: string, options: [string, string][], value: string): string =>
    `<div class="rsetting"><span>${label}</span><div class="seg" role="radiogroup" aria-label="${label}">${options
      .map(([v, l]) => `<button type="button" role="radio" data-set="${key}" data-value="${v}" aria-checked="${v === value}">${l}</button>`)
      .join('')}</div></div>`;

  const researchBtn = deps.onResearch ? '<button type="button" class="btn btn--secondary btn--small" data-act="research">Research</button>' : '';

  const lobbyControls = (r: RoomState): string => {
    const s = r.settings;
    const ready = r.players.filter((p) => p.ready && !p.host).length;
    const others = r.players.filter((p) => !p.host).length;
    if (isHost) {
      return `<div class="rsettings">
          ${seg('Bots', 'difficulty', [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']], s.difficulty)}
          ${seg('Fill with bots', 'bots', [['on', 'On'], ['off', 'Off']], s.bots ? 'on' : 'off')}
          ${seg('Length', 'length', MATCH_LENGTHS_S.map((x) => [String(x), `${x / 60} min`] as [string, string]), String(s.matchLengthS))}
        </div>
        ${researchBtn}<button type="button" class="btn btn--primary" data-act="start">Start vote${others ? ` (${ready}/${others} ready)` : ''}</button>`;
    }
    const mine = me();
    return `<p class="rsettings__info">Bots ${esc(s.difficulty)}${s.bots ? '' : ' (off)'} · ${Math.round(s.matchLengthS / 60) || 1} min · the host starts the vote</p>
      ${researchBtn}<button type="button" class="btn ${mine?.ready ? 'btn--secondary' : 'btn--primary'}" data-act="ready" aria-pressed="${Boolean(mine?.ready)}">${mine?.ready ? 'Ready ✓ (tap to undo)' : "I'm ready"}</button>`;
  };

  const voteRow = (r: RoomState, cat: VoteCategory): string => {
    const counts = voteCounts(r, cat);
    const mine = me()?.votes[cat];
    const forced = r.overrides[cat];
    const opts =
      cat === 'era'
        ? data.eras.map((e) => ({ id: e.id, name: e.name, sub: `${e.yearFrom}–${e.yearTo}`, ok: true }))
        : cat === 'map'
          ? data.maps.map((m) => ({ id: m.id, name: m.name, sub: '', ok: true }))
          : data.modes.map((m) => ({ id: m.id, name: m.name, sub: m.playable ? '' : 'coming soon', ok: m.playable }));
    return `<span class="rvote__label">${CAT_LABEL[cat]}</span><div class="rvote__chips" role="radiogroup" aria-label="${CAT_LABEL[cat]}">${opts
      .map((o) => {
        const n = counts[o.id] ?? 0;
        return `<button type="button" role="radio" class="chip vchip${forced === o.id ? ' vchip--forced' : ''}" data-cat="${cat}" data-id="${o.id}" aria-checked="${mine === o.id}" ${o.ok ? '' : 'disabled'}>
          ${esc(o.name)}<small>${forced === o.id ? 'Host pick' : o.sub ? esc(o.sub) : `${n} vote${n === 1 ? '' : 's'}`}</small>${n > 0 ? `<span class="vchip__n" aria-hidden="true">${n}</span>` : ''}
        </button>`;
      })
      .join('')}</div>`;
  };

  const teamsHtml = (r: RoomState): string => {
    const party = partyLabel(r);
    const col = (team: Team): string => {
      const ps = r.players.filter((p) => p.team === team);
      const bots = r.settings.bots ? Math.max(0, 10 - ps.length) : 0;
      return `<div class="rteam rteam--${team}"><h3>${team === 'blue' ? 'Blue' : 'Red'}</h3><ul>${ps
        .map((p) => `<li class="${p.id === deps.meId() ? 'rp--you' : ''}">${esc(p.name)}${p.party ? ` <span class="tag">${party(p.party)}</span>` : ''}</li>`)
        .join('')}</ul>${bots ? `<p class="rteam__bots">+ ${bots} bots</p>` : ''}</div>`;
    };
    const c = r.choice;
    return `${c ? `<p class="rteams__choice">${esc(optionName('era', c.era))} · ${esc(optionName('map', c.mapId))} · ${esc(optionName('mode', c.mode))}</p>` : ''}
      <div class="rteams__cols">${col('blue')}${col('red')}</div>
      <p class="rteams__note">Balanced by research points, parties kept together. Bots pick planes to even out the team BR.</p>`;
  };

  const selectTeam = (r: RoomState): string => {
    const mine = me();
    const mates = r.players.filter((p) => p.team && p.team === mine?.team);
    return `<span class="rselect__label t-${mine?.team ?? 'blue'}">${mine?.team === 'red' ? 'Red' : 'Blue'} team</span> ${mates
      .map((p) => `<span class="rselect__mate${p.locked ? ' is-locked' : ''}">${esc(p.name)}: ${esc(p.planeId ? planeName(p.planeId) : '…')}</span>`)
      .join('')}`;
  };

  const selectGo = (r: RoomState): string => {
    const mine = me();
    const locked = r.players.filter((p) => p.locked).length;
    const pick = localPick ?? mine?.planeId;
    if (!mine || !pick) return '';
    return mine.locked
      ? `<span class="rselect__wait">Locked in · waiting for others (${locked}/${r.players.length})</span><button type="button" class="btn btn--secondary" data-act="unlock">Change</button>`
      : `<button type="button" class="btn btn--primary" data-act="lock">Fly the ${esc(planeName(pick))}</button>`;
  };

  const resultsActions = (r: RoomState): string => {
    const mine = me();
    const ready = r.players.filter((p) => !p.host && p.ready).length;
    const others = r.players.filter((p) => !p.host).length;
    if (isHost) return `${researchBtn}<button type="button" class="btn btn--primary" data-act="again">Play again${others ? ` (${ready}/${others} ready)` : ''}</button>`;
    return mine?.ready
      ? `${researchBtn}<span class="rselect__wait">Waiting for the host to start the next round…</span>`
      : `${researchBtn}<button type="button" class="btn btn--primary" data-act="again">Play again</button>`;
  };

  // ---------------------------------------------------------------- render

  const render = (): void => {
    const r = room;
    if (!r) return;
    if (r.phase !== shownPhase || r.round !== shownRound) {
      shownPhase = r.phase;
      shownRound = r.round;
      localPick = null;
      body.className = `room__body room__body--${r.phase}`;
      body.innerHTML = skeleton(r.phase);
      if (r.phase === 'select') q('.rselect__cards').innerHTML = cardsHtml(r);
    }
    el.dataset['phase'] = r.phase;
    share.hidden = r.phase !== 'lobby';
    chatEl.hidden = !(r.phase === 'lobby' || r.phase === 'results' || r.phase === 'teams');
    title.textContent = r.phase === 'lobby' && isHost ? 'Your room' : r.phase === 'results' && results ? headline(results, me()?.team ?? null) : TITLE[r.phase];

    switch (r.phase) {
      case 'lobby': {
        part(body.querySelector('.rlist'), lobbyList(r));
        const a = adviseHost(r.players);
        part(
          body.querySelector('.lobby__advice'),
          esc(a.hostOnPhone ? 'The host is on a phone: if its screen locks, the match ends for everyone. A laptop on Wi-Fi is the best host.' : a.message),
        );
        part(body.querySelector('.rlobby__controls'), lobbyControls(r));
        break;
      }
      case 'vote':
        for (const c of VOTE_CATEGORIES) part(body.querySelector(`[data-row="${c}"]`), voteRow(r, c));
        part(body.querySelector('.rvote__count'), `${r.players.filter((p) => p.votes.era && p.votes.map && p.votes.mode).length} of ${r.players.length} voted. Ties are broken at random.`);
        for (const b of body.querySelectorAll<HTMLElement>('[data-force]')) b.setAttribute('aria-checked', String((b.dataset['force'] === '1') === force));
        break;
      case 'teams':
        part(body.querySelector('.rteams'), teamsHtml(r));
        break;
      case 'select': {
        const mine = me();
        const pick = localPick ?? mine?.planeId;
        for (const b of body.querySelectorAll<HTMLElement>('[data-plane]')) b.setAttribute('aria-checked', String(b.dataset['plane'] === pick));
        part(body.querySelector('.rselect__team'), selectTeam(r));
        part(body.querySelector('.rselect__go'), selectGo(r));
        break;
      }
      case 'results':
        part(
          body.querySelector('.rresults__table'),
          results
            ? resultsHtml(results, { me: deps.meId(), planeName, save: deps.saveNote?.() ?? '' }) +
                (results.br ? `<p class="rresults__br">Team BR at the start: blue ${results.br.blue.toFixed(1)}, red ${results.br.red.toFixed(1)} (${(brGap(results.br) * 100).toFixed(0)}% apart)</p>` : '')
            : '<p>Adding up the scores…</p>',
        );
        part(body.querySelector('.results__actions'), resultsActions(r));
        break;
      case 'playing':
        break;
    }
    timer.textContent = timerText();
  };

  function timerText(): string {
    const t = clock(deps.timeLeftMs());
    const label = room ? TIMER_LABEL[room.phase] : undefined;
    return t && label ? `${label} ${t}` : t;
  }

  // ---------------------------------------------------------------- input

  el.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target.closest<HTMLElement>('button') : null;
    if (!t || t.hasAttribute('disabled')) return;
    const act = t.dataset['act'];
    const r = room;
    if (act === 'leave') return deps.onLeave();
    if (act === 'copy') {
      const done = (ok: boolean): void => {
        status.textContent = ok ? 'Link copied. Paste it in your group chat.' : 'Select the link and copy it.';
      };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(deps.link).then(() => done(true), () => done(false));
      else {
        q<HTMLInputElement>('.lobby__link input').select();
        done(document.execCommand?.('copy') ?? false);
      }
      return;
    }
    if (t.dataset['chat']) return deps.request({ t: 'chat', text: t.dataset['chat'] });
    if (act === 'research') return deps.onResearch?.();
    if (!r) return;
    if (act === 'start') return host?.startVote();
    if (act === 'ready') return deps.request({ t: 'ready', ready: !me()?.ready });
    if (act === 'party') return deps.request({ t: 'party', with: t.dataset['id'] ?? null });
    if (act === 'unparty') return deps.request({ t: 'party', with: null });
    if (act === 'kick' && t.dataset['id']) return host?.kick(t.dataset['id']);
    if (act === 'again') {
      if (host) host.playAgain();
      else deps.request({ t: 'again' });
      return;
    }
    if (act === 'lock' || act === 'unlock') {
      const id = localPick ?? me()?.planeId;
      if (id) deps.request({ t: 'pick', planeId: id, lock: act === 'lock' });
      return;
    }
    if (t.dataset['set'] && host) {
      const v = t.dataset['value'] ?? '';
      if (t.dataset['set'] === 'difficulty') host.setSettings({ difficulty: v as RoomSettings['difficulty'] });
      if (t.dataset['set'] === 'bots') host.setSettings({ bots: v === 'on' });
      if (t.dataset['set'] === 'length') host.setSettings({ matchLengthS: Number(v) });
      return;
    }
    if (t.dataset['force'] !== undefined) {
      force = t.dataset['force'] === '1';
      render();
      return;
    }
    if (t.dataset['cat'] && t.dataset['id']) {
      const cat = t.dataset['cat'] as VoteCategory;
      if (force && host) host.override(cat, r.overrides[cat] === t.dataset['id'] ? null : t.dataset['id']);
      else deps.request({ t: 'vote', cat, id: t.dataset['id'] });
      return;
    }
    if (t.dataset['plane']) {
      localPick = t.dataset['plane'];
      deps.request({ t: 'pick', planeId: localPick, lock: false });
      // Show the choice straight away; the host's next room update confirms it.
      render();
    }
  });
  q('.chat__form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (text) deps.request({ t: 'chat', text });
    chatInput.value = '';
  });

  return {
    update(r, res) {
      room = r;
      results = res;
      render();
    },
    chat(lines) {
      part(
        q('.chat__lines'),
        lines
          .slice(-6)
          .map((l) => `<li><b class="t-${l.team ?? 'none'}">${esc(l.from)}</b> ${esc(l.text)}</li>`)
          .join(''),
      );
    },
    tick() {
      timer.textContent = timerText();
      // Models arrive after the cards are drawn: swap in the real silhouettes.
      if (shownPhase === 'select' && ++silhouetteCheck % 4 === 0) {
        for (const img of body.querySelectorAll<HTMLImageElement>('.pcard__img')) {
          const id = img.closest<HTMLElement>('[data-plane]')?.dataset['plane'];
          if (id) {
            const url = deps.silhouettes.get(id);
            if (img.src !== url) img.src = url;
          }
        }
      }
    },
    dispose: () => el.remove(),
  };
}
