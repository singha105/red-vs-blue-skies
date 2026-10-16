// The README's controls and the in-game How to play both come from docs/HOW_TO_PLAY.md.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs tool without types
import { syncedReadme } from '../../tools/sync-readme.mjs';
import { helpSections } from '../../src/ui/howToPlay';
import { ACTIONS, codesFor, codeLabel } from '../../src/core/keybinds';

const howTo = readFileSync('docs/HOW_TO_PLAY.md', 'utf8');

describe('How to play', () => {
  it('README.md matches docs/HOW_TO_PLAY.md (run npm run docs:readme)', () => {
    const readme = readFileSync('README.md', 'utf8');
    expect((syncedReadme as (a: string, b: string) => string)(readme, howTo)).toBe(readme);
  });

  it('the in-game screen has every section of the doc', () => {
    const titles = helpSections(howTo).map((s) => s.title);
    expect(titles).toEqual([...howTo.matchAll(/^## (.+)$/gm)].map((m) => m[1]));
    expect(helpSections(howTo).every((s) => s.html.length > 50)).toBe(true);
  });

  it('every default key is in the keyboard section', () => {
    const kb = howTo.split(/^## /m).find((s) => s.startsWith('Keyboard and mouse'))!;
    for (const a of ACTIONS) for (const code of codesFor('keyboard', a)) {
      if (code.startsWith('Arrow')) continue;
      const label = codeLabel(code).replace(' mouse', '');
      expect(kb.toLowerCase(), `${a}: ${code}`).toContain(label.toLowerCase());
    }
  });
});
