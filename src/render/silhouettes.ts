// Top-view plane silhouettes for the plane-select and respawn cards, rendered from the same models the hangar
// shows (or the placeholder until a model loads). One small render target, drawn on demand and cached as a
// data URL, so the cards are plain <img>s and cost nothing per frame.
import { Box3, Color, MeshBasicMaterial, OrthographicCamera, Scene, Vector3, WebGLRenderTarget, type WebGLRenderer } from 'three';
import { createPlaneVisual, isModelReady } from './models';

const W = 160;
const H = 160;

export interface Silhouettes {
  /** A PNG data URL of the plane seen from above, nose up. */
  get(planeId: string): string;
}

export function createSilhouettes(renderer: WebGLRenderer): Silhouettes {
  const cache = new Map<string, { url: string; real: boolean }>();
  const target = new WebGLRenderTarget(W, H);
  const scene = new Scene();
  scene.overrideMaterial = new MeshBasicMaterial({ color: 0xf4f7fb });
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  const pixels = new Uint8Array(W * H * 4);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c2d = canvas.getContext('2d');
  const box = new Box3();
  const centre = new Vector3();
  const size = new Vector3();
  const prevClear = new Color();

  const draw = (planeId: string): string => {
    const visual = createPlaneVisual(planeId, 'blue');
    scene.add(visual.root);
    visual.root.updateMatrixWorld(true);
    box.setFromObject(visual.root);
    box.getCenter(centre);
    box.getSize(size);
    // Looking straight down; the model's nose (+Z) points up the image.
    const half = Math.max(size.x, size.z) * 0.55;
    camera.left = -half;
    camera.right = half;
    camera.top = half;
    camera.bottom = -half;
    camera.position.set(centre.x, centre.y + 100, centre.z);
    camera.up.set(0, 0, 1);
    camera.lookAt(centre);
    camera.updateProjectionMatrix();

    renderer.getClearColor(prevClear);
    const prevAlpha = renderer.getClearAlpha();
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, W, H, pixels);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    scene.remove(visual.root);

    if (!c2d) return '';
    const img = c2d.createImageData(W, H);
    // WebGL rows run bottom-up. (From above with the nose up, the left wing, +X, is already on the left.)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const src = ((H - 1 - y) * W + x) * 4;
        const dst = (y * W + x) * 4;
        img.data[dst] = pixels[src]!;
        img.data[dst + 1] = pixels[src + 1]!;
        img.data[dst + 2] = pixels[src + 2]!;
        img.data[dst + 3] = pixels[src + 3]!;
      }
    }
    c2d.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  };

  return {
    get(planeId) {
      const real = isModelReady(planeId);
      const hit = cache.get(planeId);
      if (hit && (hit.real || !real)) return hit.url;
      const url = draw(planeId);
      cache.set(planeId, { url, real });
      return url;
    },
  };
}
