// WebGL renderer setup: full-window canvas, capped pixel ratio, resize handling.
import { PCFSoftShadowMap, PerspectiveCamera, SRGBColorSpace, WebGLRenderer } from 'three';

export const MAX_PIXEL_RATIO = 2;

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
  renderer.shadowMap.type = PCFSoftShadowMap;

  const camera = new PerspectiveCamera(62, 1, 1, 10000);

  let maxRatio = 1.5;
  const resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxRatio, MAX_PIXEL_RATIO));
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
