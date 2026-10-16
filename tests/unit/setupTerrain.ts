// Unit tests run on the same baked heightmaps the game ships (public/terrain/*.png).
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { HEIGHTFIELDS, pngZlib, registerHeightfield, unfilter16 } from '../../src/game/heightfield';

for (const [id, meta] of Object.entries(HEIGHTFIELDS)) {
  const png = pngZlib(new Uint8Array(readFileSync(`public/${meta.file}`)));
  registerHeightfield(id, { ...meta, data: unfilter16(new Uint8Array(inflateSync(png.zlib)), png.width, png.height) });
}
