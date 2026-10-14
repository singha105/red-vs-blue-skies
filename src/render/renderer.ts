// WebGL renderer setup: full-window canvas, capped pixel ratio, resize handling.
import { PerspectiveCamera, SRGBColorSpace, WebGLRenderer } from 'three';
import type { GraphicsLevel } from '../core/settings';

export const MAX_PIXEL_RATIO = 2;

export function pixelRatioFor(level: GraphicsLevel, devicePixelRatio: number): number {
  if (level === 'low') return 1;
  if (level === 'high') return Math.min(devicePixelRatio, MAX_PIXEL_RATIO);
  // auto: Day 2 measures fps and may drop this. Start at up to 1.5 so phones with DPR 3 stay fast.
  return Math.min(devicePixelRatio, 1.5);
}

export interface View {
  renderer: WebGLRenderer;
  camera: PerspectiveCamera;
  setGraphics(level: GraphicsLevel): void;
  dispose(): void;
}

export function createView(canvas: HTMLCanvasElement, level: GraphicsLevel): View {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: level !== 'low',
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = SRGBColorSpace;

  const camera = new PerspectiveCamera(60, 1, 1, 14000);

  let currentLevel = level;
  const resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setPixelRatio(pixelRatioFor(currentLevel, window.devicePixelRatio || 1));
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    // Keep the horizontal view similar on tall and wide screens.
    camera.fov = camera.aspect < 1 ? 75 : 60;
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
    setGraphics(next) {
      currentLevel = next;
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
