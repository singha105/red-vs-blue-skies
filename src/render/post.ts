// Post-processing (Day 11, Medium and High): bloom on everything brighter than white (afterburners, muzzle
// flashes, tracers, explosions, flares). The scene renders into a half-float target (so those values survive),
// UnrealBloomPass adds the glow, and OutputPass applies the tone mapping and sRGB output that a direct render does
// itself. Low draws straight to the screen with no composer at all.
import { HalfFloatType, Vector2, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/** Runs a draw callback (the map's backdrop + scene passes) into the composer's buffer. */
class DrawPass extends Pass {
  constructor(private readonly draw: () => void) {
    super();
    this.needsSwap = false;
  }

  override render(renderer: WebGLRenderer, _write: unknown, readBuffer: import('three').WebGLRenderTarget): void {
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    this.draw();
  }
}

export interface Post {
  /** Draw a frame: through bloom when enabled, else straight to the screen. */
  render(draw: () => void): void;
  setBloom(on: boolean): void;
  readonly bloom: boolean;
}

export function createPost(renderer: WebGLRenderer): Post {
  let composer: EffectComposer | null = null;
  let current: () => void = () => undefined;
  let enabled = false;
  const size = new Vector2();
  const last = new Vector2();
  let lastRatio = 0;

  const build = (): EffectComposer => {
    const c = new EffectComposer(renderer);
    // Half floats keep the above-white highlights for the bloom threshold.
    c.renderTarget1.texture.type = HalfFloatType;
    c.renderTarget2.texture.type = HalfFloatType;
    c.addPass(new DrawPass(() => current()));
    renderer.getSize(size);
    // Threshold 3: the physically based sky and sunlit clouds already go past 1 before tone mapping, so only
    // real light sources (burners, flashes, tracers, flares: 4–8× white) bloom.
    c.addPass(new UnrealBloomPass(new Vector2(size.x, size.y), 0.6, 0.4, 3.0));
    c.addPass(new OutputPass());
    return c;
  };

  return {
    get bloom() {
      return enabled;
    },
    setBloom(on) {
      enabled = on;
      if (on && !composer) composer = build();
    },
    render(draw) {
      if (!enabled || !composer) {
        renderer.setRenderTarget(null);
        draw();
        return;
      }
      renderer.getSize(size);
      const ratio = renderer.getPixelRatio();
      if (!size.equals(last) || ratio !== lastRatio) {
        last.copy(size);
        lastRatio = ratio;
        composer.setPixelRatio(ratio);
        composer.setSize(size.x, size.y);
      }
      current = draw;
      composer.render();
    },
  };
}
