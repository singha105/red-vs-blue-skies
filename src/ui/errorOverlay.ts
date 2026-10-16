// Full-screen report shown when a data file fails validation, so a bad edit is obvious instead of a silent crash.
import type { DataError } from '../data/validate';

const escape = (s: string): string =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);

export function showDataErrors(parent: HTMLElement, errors: DataError[]): void {
  const files = [...new Set(errors.map((e) => e.file))];
  const shown = errors.slice(0, 50);
  const el = document.createElement('section');
  el.className = 'data-error';
  el.setAttribute('role', 'alert');
  el.innerHTML = `
    <h1>Game data has errors</h1>
    <p>${errors.length} problem${errors.length === 1 ? '' : 's'} in ${files.map((f) => `src/data/${escape(f)}`).join(', ')}.
      Fix the file${files.length === 1 ? '' : 's'} and reload.</p>
    <ul>
      ${shown.map((e) => `<li><code>${escape(e.file)} › ${escape(e.path)}</code>: ${escape(e.message)}</li>`).join('')}
    </ul>
    ${errors.length > shown.length ? `<p>…and ${errors.length - shown.length} more.</p>` : ''}
  `;
  parent.appendChild(el);
  console.error('Game data failed validation:\n' + errors.map((e) => `${e.file} ${e.path}: ${e.message}`).join('\n'));
}

/** Errors that come from the browser or extensions, not from the game, and don't break anything. */
const IGNORED = [/ResizeObserver loop/i, /^Script error\.?$/i, /extension:\/\//i, /AbortError/i];

export interface CrashInfo {
  message: string;
  stack: string;
}

/** The text "Copy error" puts on the clipboard: what broke, where, and on which build and device. */
export function crashReport(info: CrashInfo, version: string, where: string, count: number): string {
  return [
    `Red vs Blue Skies v${version}`,
    `Error: ${info.message}`,
    count > 1 ? `(${count} errors; this is the first)` : '',
    `Screen: ${where}`,
    `Page: ${location.pathname}${location.search}`,
    `Browser: ${navigator.userAgent}`,
    `Window: ${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`,
    `Time: ${new Date().toISOString()}`,
    '',
    info.stack,
  ]
    .filter((l, i) => l !== '' || i > 3)
    .join('\n')
    .slice(0, 6000);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older Safari or no permission: select a hidden textarea and use the old copy command.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/**
 * Catches uncaught errors and promise rejections and shows one friendly card (later errors only bump a count):
 * "Copy error" puts a report on the clipboard to send to whoever runs the game; "Keep playing" closes it.
 */
export function installErrorOverlay(parent: HTMLElement, version: string, where: () => string): void {
  let el: HTMLElement | null = null;
  let first: CrashInfo | null = null;
  let count = 0;
  const show = (info: CrashInfo): void => {
    if (IGNORED.some((re) => re.test(info.message))) return;
    count++;
    if (el) {
      const n = el.querySelector('[data-k="count"]');
      if (n) n.textContent = `${count} errors so far.`;
      return;
    }
    first = info;
    el = document.createElement('div');
    el.className = 'modal crash';
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Something went wrong');
    el.innerHTML = `
      <div class="modal__card">
        <h2>Something went wrong</h2>
        <p>The game hit a bug. You can try to keep playing; if things look broken, reload the page (your research points are safe).</p>
        <p>Please tap <b>Copy error</b> and send it to whoever runs the game, with what you were doing.</p>
        <pre class="crash__msg">${escape(info.message)}</pre>
        <small data-k="count" role="status"></small>
        <div class="crash__actions">
          <button type="button" class="btn btn--primary btn--small" data-act="copy">Copy error</button>
          <button type="button" class="btn btn--secondary btn--small" data-act="reload">Reload</button>
          <button type="button" class="btn btn--secondary btn--small" data-act="close">Keep playing</button>
        </div>
      </div>`;
    parent.appendChild(el);
    const card = el;
    card.querySelector('[data-act="copy"]')!.addEventListener('click', () => {
      const btn = card.querySelector<HTMLButtonElement>('[data-act="copy"]')!;
      void copyText(crashReport(first!, version, where(), count)).then((ok) => {
        btn.textContent = ok ? 'Copied' : 'Copy failed: take a screenshot';
      });
    });
    card.querySelector('[data-act="reload"]')!.addEventListener('click', () => window.location.reload());
    card.querySelector('[data-act="close"]')!.addEventListener('click', () => {
      card.remove();
      el = null;
    });
  };
  window.addEventListener('error', (e) => {
    // Failed <img>/<script> loads also fire "error" on window (capture phase only); those aren't crashes.
    if (!(e instanceof ErrorEvent)) return;
    const err: unknown = e.error;
    show({ message: e.message || String(err), stack: err instanceof Error && err.stack ? err.stack : `${e.filename}:${e.lineno}:${e.colno}` });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r: unknown = e.reason;
    show({ message: r instanceof Error ? r.message : String(r), stack: r instanceof Error && r.stack ? r.stack : '' });
  });
}

/** Shows the crash card for an error caught by the game itself (boot failures). */
export function reportError(err: unknown): void {
  window.dispatchEvent(new ErrorEvent('error', { error: err, message: err instanceof Error ? err.message : String(err) }));
}
