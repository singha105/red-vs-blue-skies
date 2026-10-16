// The terrain's Poly Haven CC0 textures, KTX2 (Basis Universal) so the GPU keeps them compressed. Loaded only on
// Medium and High, after the match has started: the terrain shows its palette colours until they arrive.
// The Basis transcoder (public/basis/, copied from three's examples) downloads once, on first use.
import { RepeatWrapping, SRGBColorSpace, NoColorSpace, type Texture, type WebGLRenderer } from 'three';
import { ktx2Loader } from './ktx2';
import type { TerrainTextures } from './terrainMaterial';

let pending: Promise<TerrainTextures | null> | null = null;

export function loadTerrainTextures(renderer: WebGLRenderer): Promise<TerrainTextures | null> {
  if (pending) return pending;
  const base = `${import.meta.env.BASE_URL}`;
  const loader = ktx2Loader(renderer);
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const get = async (name: string, colour: boolean): Promise<Texture> => {
    const t = await loader.loadAsync(`${base}textures/${name}.ktx2`);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.anisotropy = anisotropy;
    t.colorSpace = colour ? SRGBColorSpace : NoColorSpace;
    t.needsUpdate = true;
    return t;
  };
  pending = (async () => {
    try {
      const [grass, forest, rock, snow, sand, grassNormal, rockNormal] = await Promise.all([
        get('grass', true),
        get('forest', true),
        get('rock', true),
        get('snow', true),
        get('sand', true),
        get('grass_normal', false),
        get('rock_normal', false),
      ]);
      return { grass, forest, rock, snow, sand, grassNormal, rockNormal };
    } catch {
      return null; // the palette colours stay
    }
  })();
  return pending;
}
