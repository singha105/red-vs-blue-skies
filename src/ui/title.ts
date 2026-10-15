// Title screen: Play Solo, Host / Join, Research, Leaderboard, Settings, and your callsign and RP.

export interface TitleHandlers {
  onSolo(): void;
  onHostJoin(): void;
  onSettings(): void;
  onResearch(): void;
  onLeaderboard(): void;
}

export interface TitleScreen {
  readonly el: HTMLElement;
  setNote(text: string): void;
  /** Callsign, RP and sync state under the buttons. */
  setProfile(html: string): void;
  dispose(): void;
}

export function createTitleScreen(parent: HTMLElement, version: string, handlers: TitleHandlers): TitleScreen {
  const el = document.createElement('section');
  el.className = 'title';
  el.setAttribute('aria-label', 'Title screen');
  el.innerHTML = `
    <header>
      <h1 class="title__logo">
        <span class="title__red">Red</span>
        <span class="title__vs">vs</span>
        <span class="title__blue">Blue</span>
        <span class="title__skies">Skies</span>
      </h1>
      <p class="title__tagline">Dogfight your friends, up to 20 at once, from WW1 biplanes to modern jets.</p>
    </header>
    <div class="title__actions">
      <div class="title__buttons">
        <button type="button" class="btn btn--primary" data-action="solo">Play Solo</button>
        <button type="button" class="btn btn--secondary" data-action="host">Host / Join</button>
      </div>
      <div class="title__buttons title__buttons--small">
        <button type="button" class="btn btn--secondary btn--small" data-action="research">Research</button>
        <button type="button" class="btn btn--secondary btn--small" data-action="leaderboard">Leaderboard</button>
        <button type="button" class="btn btn--secondary btn--small" data-action="settings">Settings</button>
      </div>
      <p class="title__profile" data-testid="title-profile"></p>
      <p class="title__note" role="status" aria-live="polite"></p>
    </div>
    <span class="version">v${version}</span>
  `;
  parent.appendChild(el);

  const note = el.querySelector<HTMLParagraphElement>('.title__note');
  const onClick = (e: Event): void => {
    const target = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('[data-action]') : null;
    if (!target) return;
    const action = target.dataset['action'];
    if (action === 'solo') handlers.onSolo();
    else if (action === 'settings') handlers.onSettings();
    else if (action === 'research') handlers.onResearch();
    else if (action === 'leaderboard') handlers.onLeaderboard();
    else handlers.onHostJoin();
  };
  el.addEventListener('click', onClick);

  return {
    el,
    setNote(text) {
      if (note) note.textContent = text;
    },
    setProfile(html) {
      const p = el.querySelector('.title__profile');
      if (p) p.innerHTML = html;
    },
    dispose() {
      el.removeEventListener('click', onClick);
      el.remove();
    },
  };
}
