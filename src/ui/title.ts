// Title screen. Play Solo and Host / Join are stubs until Day 3 and Day 5.

export interface TitleHandlers {
  onSolo(): void;
  onHostJoin(): void;
}

export interface TitleScreen {
  readonly el: HTMLElement;
  setNote(text: string): void;
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
      <p class="title__note" role="status" aria-live="polite"></p>
    </div>
    <span class="version">v${version}</span>
  `;
  parent.appendChild(el);

  const note = el.querySelector<HTMLParagraphElement>('.title__note');
  const onClick = (e: Event): void => {
    const target = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('[data-action]') : null;
    if (!target) return;
    if (target.dataset['action'] === 'solo') handlers.onSolo();
    else handlers.onHostJoin();
  };
  el.addEventListener('click', onClick);

  return {
    el,
    setNote(text) {
      if (note) note.textContent = text;
    },
    dispose() {
      el.removeEventListener('click', onClick);
      el.remove();
    },
  };
}
