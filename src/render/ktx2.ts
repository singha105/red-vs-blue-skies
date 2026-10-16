// One shared KTX2 loader (Basis transcoder workers are per loader): terrain textures and plane detail textures.
import type { WebGLRenderer } from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

let loader: KTX2Loader | null = null;

export function ktx2Loader(renderer: WebGLRenderer): KTX2Loader {
  if (!loader) loader = new KTX2Loader().setTranscoderPath(`${import.meta.env.BASE_URL}basis/`).detectSupport(renderer);
  return loader;
}
