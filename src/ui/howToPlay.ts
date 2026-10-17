// "How to play" (title screen and the in-match menu). The text is docs/HOW_TO_PLAY.md itself, bundled at build
// time and shown one "##" section per tab, so the game, the README and the doc can't drift apart. The device
// you're on opens first.
import source from '../../docs/HOW_TO_PLAY.md?raw';

export type HelpTab = 'touch' | 'desktop' | 'gamepad';

interface Section {
  id: string;
  title: string;
  html: string;
}

/** Short tab names for the doc's "##" headings (anything else keeps its heading). */
const TAB_NAMES: Record<string, string> = {
  'Joining a match': 'Join',
  'Keyboard and mouse': 'Keyboard + mouse',
  'Phones and tablets': 'Phones',
  Gamepad: 'Gamepad',
  'Reading the HUD': 'HUD',
  'Radar step by step': 'Radar',
  'Missiles: firing and dodging': 'Missiles',
  'Points and unlocks': 'Unlocks',
  'Tips for new pilots': 'Tips',
  Hosting: 'Hosting',
  Credits: 'Credits',
};
const START: Record<HelpTab, string> = { touch: 'Phones and tablets', desktop: 'Keyboard and mouse', gamepad: 'Gamepad' };

const esc = (s: string): string => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
/** **bold** and `code`, after escaping. */
const inline = (s: string): string => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');

/** The small subset of Markdown the doc uses: ### headings, paragraphs, - and 1. lists, and tables. */
export function renderMarkdown(md: string): string {
  const out: string[] = [];
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i++;
      continue;
    }
    if (line.startsWith('### ')) {
      out.push(`<h3>${inline(line.slice(4))}</h3>`);
      i++;
    } else if (line.startsWith('|')) {
      const rows: string[][] = [];
      for (; i < lines.length && lines[i]!.startsWith('|'); i++) {
        const cells = lines[i]!.split('|').slice(1, -1).map((c) => c.trim());
        if (cells.every((c) => /^-+$/.test(c))) continue;
        rows.push(cells);
      }
      const [head, ...body] = rows;
      out.push(
        `<table class="help__keys"><thead><tr>${(head ?? []).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body
          .map((r) => `<tr>${r.map((c, k) => (k === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join('')}</tr>`)
          .join('')}</tbody></table>`,
      );
    } else if (/^(- |\d+\. )/.test(line)) {
      const ordered = /^\d+\. /.test(line);
      const items: string[] = [];
      for (; i < lines.length && /^(- |\d+\. )/.test(lines[i]!); i++) items.push(`<li>${inline(lines[i]!.replace(/^(- |\d+\. )/, ''))}</li>`);
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
    } else {
      const para: string[] = [];
      for (; i < lines.length && lines[i]!.trim() !== '' && !/^(\||- |\d+\. |#)/.test(lines[i]!); i++) para.push(lines[i]!);
      out.push(`<p>${inline(para.join(' '))}</p>`);
    }
  }
  return out.join('');
}

/** The doc split at its "##" headings (the title and intro before the first one are left out). */
export function helpSections(md = source): Section[] {
  return md
    .split(/^## /m)
    .slice(1)
    .map((chunk, i) => {
      const nl = chunk.indexOf('\n');
      const title = chunk.slice(0, nl).trim();
      return { id: `s${i}`, title, html: renderMarkdown(chunk.slice(nl + 1)) };
    });
}

export function openHowToPlay(parent: HTMLElement, opts: { start: HelpTab; version: string; onClose?: () => void }): { dispose(): void } {
  const sections = helpSections();
  const el = document.createElement('div');
  el.className = 'modal help';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'How to play');
  el.innerHTML = `
    <div class="modal__card help__card">
      <h2>How to play</h2>
      <div class="help__tabs" role="tablist">${sections.map((s) => `<button type="button" role="tab" class="chip" data-tab="${s.id}">${esc(TAB_NAMES[s.title] ?? s.title)}</button>`).join('')}</div>
      <div class="help__body" role="tabpanel"></div>
      <small class="help__version">Version ${esc(opts.version)}</small>
      <button type="button" class="btn btn--primary btn--small" data-act="close">Done</button>
    </div>`;
  parent.appendChild(el);
  const body = el.querySelector<HTMLElement>('.help__body')!;
  const show = (id: string): void => {
    const s = sections.find((x) => x.id === id) ?? sections[0];
    if (!s) return;
    body.innerHTML = s.html;
    body.scrollTop = 0;
    for (const b of el.querySelectorAll<HTMLElement>('[data-tab]')) {
      const on = b.dataset['tab'] === s.id;
      b.setAttribute('aria-selected', String(on));
      if (on) b.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
  };
  show(sections.find((s) => s.title === START[opts.start])?.id ?? 's0');
  el.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-tab]') : null;
    if (t) show(t.dataset['tab']!);
  });
  const dispose = (): void => {
    el.remove();
  };
  el.querySelector('[data-act="close"]')!.addEventListener('click', () => {
    dispose();
    opts.onClose?.();
  });
  return { dispose };
}
