// WebGL renderer setup: full-window canvas, capped pixel ratio, resize handling.
import { ACESFilmicToneMapping, PCFSoftShadowMap, PerspectiveCamera, SRGBColorSpace, WebGLRenderer } from 'three';

export const MAX_PIXEL_RATIO = 2;

/** Debug only (?debug=1&renderscale=0.5): draw fewer pixels. The multiplayer tests run three software-rendered
 *  pages in one browser and need it; players never do. */
const renderScale = ((): number => {
  const q = new URLSearchParams(window.location.search);
  const v = Number(q.get('renderscale'));
  return q.get('debug') === '1' && v >= 0.25 && v <= 1 ? v : 1;
})();

export interface View {
  renderer: WebGLRenderer;
  camera: PerspectiveCamera;
  /** Cap devicePixelRatio (quality presets use 1, 1.5 or 2). */
  setMaxPixelRatio(max: number): void;
  dispose(): void;
}

export function createView(canvas: HTMLCanvasElement, opts: { antialias: boolean }): View {
  const renderer = new WebGLRenderer({ canvas, antialias: opts.antialias, powerPreference: 'high-performance' });
  renderer.outputColorSpace = SRGBColorSpace;
  // ACES filmic (Day 11, every tier): the physically based sky, the HDRI light and bright effects roll off
  // gently instead of clipping to white. (AgX was tried first: it greyed the forests and snow too much.)
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.type = PCFSoftShadowMap;
  // The frame is several render() calls (backdrop, scene, bloom passes): main resets the counters once a frame.
  renderer.info.autoReset = false;

  const camera = new PerspectiveCamera(62, 1, 1, 10000);

  let maxRatio = 1.5;
  const resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxRatio, MAX_PIXEL_RATIO) * renderScale);
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };

  resize();
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  // iOS reports the new size a moment after the orientation event.
  const onOrientation = (): void => {
    window.setTimeout(resize, 150);
  };
  window.addEventListener('orientationchange', onOrientation);

  return {
    renderer,
    camera,
    setMaxPixelRatio(max) {
      maxRatio = max;
      resize();
    },
    dispose() {
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
      window.removeEventListener('orientationchange', onOrientation);
      renderer.dispose();
    },
  };
}
