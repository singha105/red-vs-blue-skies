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
