// Sky (Day 11): three.js's physically based Sky (Preetham scattering) with the map's sun, its own distant cloud
// deck, plus two additions in its shader:
// * a high, streaky cirrus layer (stretched noise, brush strokes along the wind), and
// * a haze band at the horizon in the scene's fog colour, so the fogged edge of the world and the distant
//   ranges melt into the sky instead of meeting it at a line.
// It follows the camera and sits just inside the far plane, whatever the draw distance.
import { Color, Vector3 } from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

export interface SkyDome {
  mesh: Sky;
  update(timeS: number): void;
  /** The dome's own cloud deck and cirrus (off on Low: they're the costliest part of the sky shader). */
  setDetail(on: boolean): void;
}

export function createSky(sunDir: Vector3, haze: Color, opts: { cloudCoverage: number }): SkyDome {
  const sky = new Sky();
  const u = sky.material.uniforms;
  u['turbidity']!.value = 2.2;
  u['rayleigh']!.value = 1.15;
  u['mieCoefficient']!.value = 0.004;
  u['mieDirectionalG']!.value = 0.82;
  u['sunPosition']!.value.copy(sunDir).multiplyScalar(450000);
  u['cloudCoverage']!.value = opts.cloudCoverage;
  u['cloudDensity']!.value = 0.35;
  u['cloudElevation']!.value = 0.6;
  u['uHaze'] = { value: haze };
  u['uCirrus'] = { value: 0.55 };
  sky.material.fragmentShader = sky.material.fragmentShader
    .replace(
      'void main() {',
      `uniform vec3 uHaze;
      uniform float uCirrus;
      float cHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
      float cNoise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); vec2 w = f * f * (3.0 - 2.0 * f);
        return mix(mix(cHash(i), cHash(i + vec2(1.0, 0.0)), w.x), mix(cHash(i + vec2(0.0, 1.0)), cHash(i + vec2(1.0, 1.0)), w.x), w.y);
      }
      void main() {`,
    )
    .replace(
      'gl_FragColor = vec4( texColor, 1.0 );',
      `// Cirrus: noise stretched about 7:1 along one wind direction, thinning toward the horizon.
      if ( direction.y > 0.0 && uCirrus > 0.0 ) {
        vec2 p = direction.xz / ( direction.y + 0.12 ) * 2.2;
        vec2 q = vec2( p.x * 0.8 + p.y * 0.6, -p.x * 0.6 + p.y * 0.8 ) * vec2( 0.35, 2.6 ) + time * 0.002;
        float n = cNoise( q ) * 0.55 + cNoise( q * 2.3 + 4.1 ) * 0.3 + cNoise( q * 5.1 - 2.7 ) * 0.15;
        float patchy = smoothstep( 0.35, 0.75, cNoise( p * 0.25 + 9.0 ) );
        float c = smoothstep( 0.55, 0.85, n ) * patchy * smoothstep( 0.02, 0.25, direction.y ) * uCirrus;
        texColor = mix( texColor, vec3( 0.08 ) + texColor * 0.6, c * 0.55 );
      }
      gl_FragColor = vec4( texColor, 1.0 );`,
    )
    .replace(
      '#include <colorspace_fragment>',
      `#include <colorspace_fragment>
      // Same mix as the fog applies to the terrain at its far edge.
      gl_FragColor.rgb = mix( gl_FragColor.rgb, uHaze, smoothstep( 0.14, -0.02, direction.y ) );`,
    );
  sky.material.fog = false;
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  sky.onBeforeRender = (_r, _s, camera) => {
    sky.position.copy(camera.position);
    // A unit box: its corners are 0.87 × scale away, so this keeps them inside the far plane.
    const far = (camera as { far?: number }).far ?? 10000;
    sky.scale.setScalar(far * 1.1);
    sky.updateMatrixWorld();
  };
  return {
    mesh: sky,
    update(timeS) {
      u['time']!.value = timeS;
    },
    setDetail(on) {
      u['cloudCoverage']!.value = on ? opts.cloudCoverage : 0;
      u['uCirrus']!.value = on ? 0.55 : 0;
    },
  };
}
