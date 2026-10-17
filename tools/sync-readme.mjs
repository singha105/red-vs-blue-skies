// Copies the player-facing sections of docs/HOW_TO_PLAY.md into README.md between the
// <!-- how-to-play:start --> and <!-- how-to-play:end --> markers, one heading level down.
// The in-game How to play renders HOW_TO_PLAY.md itself, so after this all three say the same thing.
// `npm run docs:readme` writes README.md; tests/unit/docs.test.ts fails if they've drifted.
import { readFileSync, writeFileSync } from 'node:fs';

export const README_SECTIONS = ['Keyboard and mouse', 'Gamepad', 'Reading the HUD', 'Radar step by step', 'Missiles: firing and dodging'];

export function readmeBlock(howToPlay) {
  const parts = howToPlay.split(/^## /m).slice(1);
  const picked = README_SECTIONS.map((title) => {
    const chunk = parts.find((p) => p.startsWith(`${title}\n`));
    if (!chunk) throw new Error(`HOW_TO_PLAY.md has no "## ${title}" section`);
    return `### ${chunk.replace(/^### /gm, '#### ').trimEnd()}\n`;
  });
  return `<!-- how-to-play:start (generated from docs/HOW_TO_PLAY.md by npm run docs:readme; edit that file) -->\n${picked.join('\n')}<!-- how-to-play:end -->`;
}

export function syncedReadme(readme, howToPlay) {
  const re = /<!-- how-to-play:start[\s\S]*?<!-- how-to-play:end -->/;
  if (!re.test(readme)) throw new Error('README.md has no how-to-play markers');
  return readme.replace(re, readmeBlock(howToPlay));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const readme = readFileSync('README.md', 'utf8');
  const out = syncedReadme(readme, readFileSync('docs/HOW_TO_PLAY.md', 'utf8'));
  writeFileSync('README.md', out);
  console.log(out === readme ? 'README.md already in sync' : 'README.md updated from docs/HOW_TO_PLAY.md');
}
