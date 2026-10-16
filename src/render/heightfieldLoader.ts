// Downloads and decodes a map's baked 16-bit heightmap PNG (public/terrain/), then registers it for the
// simulation and the renderer. Browsers' image decoders only give 8 bits per channel, so the PNG is inflated with
// DecompressionStream and unfiltered by hand (heightfield.ts). Without DecompressionStream (very old browsers)
// the map keeps its procedural base terrain.
import { HEIGHTFIELDS, heightfieldFor, pngZlib, registerHeightfield, unfilter16 } from '../game/heightfield';

const pending = new Map<string, Promise<boolean>>();

async function inflate(zlib: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([zlib as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Resolves true once the map's baked terrain is registered (false: no baked file, or it couldn't load). */
export function loadHeightfield(mapId: string): Promise<boolean> {
  const meta = HEIGHTFIELDS[mapId];
  if (!meta) return Promise.resolve(false);
  if (heightfieldFor(mapId)) return Promise.resolve(true);
  let p = pending.get(mapId);
  if (!p) {
    p = (async () => {
      if (typeof DecompressionStream === 'undefined') return false;
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}${meta.file}`);
        if (!res.ok) return false;
        const png = pngZlib(new Uint8Array(await res.arrayBuffer()));
        const data = unfilter16(await inflate(png.zlib), png.width, png.height);
        registerHeightfield(mapId, { ...meta, data });
        return true;
      } catch {
        return false;
      }
    })();
    pending.set(mapId, p);
  }
  return p;
}
