// Ocean: one big quad that follows the camera, shaded with drifting ripples, sun glints and fresnel to the horizon.
import { Color, Mesh, PlaneGeometry, ShaderMaterial, UniformsLib, UniformsUtils, Vector3 } from 'three';
import type { GameMap } from '../data/types';
import { SEA_LEVEL } from '../game/terrain';

export interface Ocean {
  mesh: Mesh;
  update(timeS: number, cameraPos: Vector3): void;
}

export function createOcean(map: GameMap, sunDir: Vector3): Ocean {
  const size = map.sizeM * 4;
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
