// Ocean: one big quad that follows the camera. Low and Medium: a cheap shader with drifting ripples, sun glints
// and fresnel to the horizon. High (Day 11): a glossy PBR surface that reflects the sky (the scene's image-based
// light) through an animated normal map, with the sun's highlight dancing on the waves.
import {
  Color,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  RGBAFormat,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
} from 'three';
import type { GameMap } from '../data/types';
import { SEA_LEVEL } from '../game/terrain';

export interface Ocean {
  mesh: Mesh;
  update(timeS: number, cameraPos: Vector3): void;
}

/** A tileable wave normal map from a few sine waves at whole-number frequencies (so it repeats seamlessly). */
function waveNormals(): DataTexture {
  const n = 256;
  const data = new Uint8Array(n * n * 4);
  const waves = [[3, 1, 1], [-2, 4, 0.7], [7, -3, 0.35], [-9, -8, 0.22], [13, 5, 0.12]] as const;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let dx = 0, dy = 0;
      for (const [kx, ky, a] of waves) {
        const ph = ((kx * x + ky * y) / n) * Math.PI * 2;
        dx += Math.cos(ph) * kx * a;
        dy += Math.cos(ph) * ky * a;
      }
      const nx = -dx * 0.06, ny = -dy * 0.06;
      const l = Math.hypot(nx, ny, 1);
      const i = (y * n + x) * 4;
      data[i] = ((nx / l) * 0.5 + 0.5) * 255;
      data[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const t = new DataTexture(data, n, n, RGBAFormat);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** High: reflective water (needs scene.environment for the sky reflection). */
export function createReflectiveOcean(map: GameMap): Ocean {
  // The map plus a margin; beyond it the backdrop's sea and distant ranges take over (mapScene.ts).
  const size = map.sizeM * 1.6;
  const geometry = new PlaneGeometry(size, size, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const normalMap = waveNormals();
  normalMap.repeat.set(size / 90, size / 90);
  const material = new MeshStandardMaterial({
    color: new Color(map.colors.water).multiplyScalar(0.55),
    roughness: 0.12,
    metalness: 0,
    normalMap,
    normalScale: new Vector2(0.55, 0.55),
    envMapIntensity: 1.1,
  });
  const mesh = new Mesh(geometry, material);
  mesh.position.y = SEA_LEVEL;
  mesh.frustumCulled = false;
  return {
    mesh,
    update(timeS, cameraPos) {
      // Snap to the texture's repeat so the waves stay put as the quad follows the camera; drift them in time.
      mesh.position.x = Math.round(cameraPos.x / 90) * 90;
      mesh.position.z = Math.round(cameraPos.z / 90) * 90;
      normalMap.offset.set((timeS * 0.004) % 1, (timeS * 0.0027) % 1);
    },
  };
}

export function createOcean(map: GameMap, sunDir: Vector3): Ocean {
  const size = map.sizeM * 1.6;
  const geometry = new PlaneGeometry(size, size, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const material = new ShaderMaterial({
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        time: { value: 0 },
        water: { value: new Color(map.colors.water) },
        horizon: { value: new Color(map.colors.skyHorizon) },
        sunDir: { value: sunDir.clone().normalize() },
      },
    ]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform float time;
      uniform vec3 water;
      uniform vec3 horizon;
      uniform vec3 sunDir;
      varying vec3 vWorld;
      void main() {
        vec2 p = vWorld.xz;
        // Two drifting ripple layers make a cheap fake normal.
        float a = sin(p.x * 0.021 + time * 0.9) * cos(p.y * 0.017 - time * 0.7);
        float b = sin((p.x + p.y) * 0.047 - time * 1.3) * 0.5;
        vec3 n = normalize(vec3(a * 0.05 + b * 0.03, 1.0, b * 0.05 - a * 0.03));
        vec3 view = normalize(cameraPosition - vWorld);
        float fresnel = pow(1.0 - max(dot(n, view), 0.0), 5.0);
        vec3 col = mix(water * (0.92 + a * 0.05), horizon, fresnel * 0.3);
        float glint = pow(max(dot(reflect(-sunDir, n), view), 0.0), 120.0);
        col += vec3(1.0, 0.95, 0.85) * glint * 0.6;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
    fog: true,
  });
  const mesh = new Mesh(geometry, material);
  mesh.position.y = SEA_LEVEL;
  mesh.frustumCulled = false;
  const time = material.uniforms['time']!;
  return {
    mesh,
    update(timeS, cameraPos) {
      time.value = timeS;
      // Snap to a 100 m grid so the ripples don't swim as the camera moves.
      mesh.position.x = Math.round(cameraPos.x / 100) * 100;
      mesh.position.z = Math.round(cameraPos.z / 100) * 100;
    },
  };
}

/** The sea beyond the map, in the backdrop pass: flat colour, fogged, out to the backdrop's far plane. */
export function createBackdropSea(map: GameMap): Mesh {
  const geometry = new PlaneGeometry(120_000, 120_000, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geometry, new MeshLambertMaterial({ color: new Color(map.colors.water).multiplyScalar(0.7) }));
  mesh.position.y = SEA_LEVEL - 2;
  mesh.frustumCulled = false;
  return mesh;
}
