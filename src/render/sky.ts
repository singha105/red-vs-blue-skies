// Sky dome: horizon-to-zenith gradient with a sun disc and glow. Follows the camera so it never clips.
import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import type { GameMap } from '../data/types';

export function createSky(map: GameMap, sunDir: Vector3): Mesh {
  const material = new ShaderMaterial({
    uniforms: {
      top: { value: new Color(map.colors.skyTop) },
      horizon: { value: new Color(map.colors.skyHorizon) },
      sunDir: { value: sunDir.clone().normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 horizon;
      uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        float h = clamp(dir.y, 0.0, 1.0);
        vec3 col = mix(horizon, top, pow(h, 0.5));
        float s = max(dot(dir, sunDir), 0.0);
        col += vec3(1.0, 0.92, 0.75) * (pow(s, 900.0) * 1.6 + pow(s, 12.0) * 0.18);
        // Below the horizon fade to the horizon colour so the fogged ocean edge blends in.
        col = mix(col, horizon, smoothstep(0.0, -0.05, dir.y));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
    side: BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new Mesh(new SphereGeometry(1000, 32, 16), material);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  sky.onBeforeRender = (_r, _s, camera) => {
    sky.position.copy(camera.position);
    // Scale inside the far plane whatever the draw distance.
    const far = (camera as { far?: number }).far ?? 10000;
    sky.scale.setScalar(far * 0.9 / 1000);
    sky.updateMatrixWorld();
  };
  return sky;
}
