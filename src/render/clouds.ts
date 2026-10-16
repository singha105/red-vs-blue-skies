// Cumulus (Day 11): soft camera-facing puffs grouped into seeded clusters, one instanced draw. You can fly
// through them: puffs thin out to mist within a few hundred metres of the camera instead of filling the screen.
// Lit from above (flat grey bases, bright tops) and faded with the fog. The puff texture is drawn on a canvas.
import {
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  Sphere,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from 'three';
import type { GameMap } from '../data/types';
import { createRng, range } from '../game/rng';

const MAX_CLUSTERS = 150;
const PUFFS_PER_CLUSTER = 9;

export interface Clouds {
  mesh: Mesh;
  setCount(clusters: number): void;
}

function puffTexture(): CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  // A few overlapping soft blobs make a lumpy, not perfectly round, puff.
  for (const [x, y, r, a] of [[64, 70, 54, 0.9], [44, 62, 34, 0.7], [84, 58, 36, 0.7], [64, 46, 30, 0.6]] as const) {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(255,255,255,${a})`);
    grad.addColorStop(0.6, `rgba(255,255,255,${a * 0.55})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  const t = new CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

export function createClouds(map: GameMap, sunDir: Vector3): Clouds {
  const rng = createRng(map.seed ^ 0x51ed);
  const n = MAX_CLUSTERS * PUFFS_PER_CLUSTER;
  const data = new Float32Array(n * 4);
  const shade = new Float32Array(n);
  const reach = map.sizeM * 0.7;
  for (let c = 0; c < MAX_CLUSTERS; c++) {
    const cx = range(rng, -reach, reach);
    const cz = range(rng, -reach, reach);
    const cy = range(rng, 1500, 2900);
    const size = range(rng, 140, 340);
    for (let k = 0; k < PUFFS_PER_CLUSTER; k++) {
      const i = c * PUFFS_PER_CLUSTER + k;
      // Flat-bottomed heaps: puffs spread wide, bigger and higher toward the middle.
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * size * 1.4;
      const centre = 1 - r / (size * 1.4);
      data[i * 4] = cx + Math.cos(a) * r;
      data[i * 4 + 1] = cy + centre * size * 0.55 + range(rng, 0, 0.15) * size;
      data[i * 4 + 2] = cz + Math.sin(a) * r * 0.8;
      data[i * 4 + 3] = size * (0.55 + 0.6 * centre) * range(rng, 0.8, 1.2);
      shade[i] = 0.55 + 0.45 * centre;
    }
  }
  const quad = new BufferGeometry();
  quad.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  quad.setIndex([0, 1, 2, 0, 2, 3]);
  const geometry = new InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.getAttribute('position'));
  geometry.setAttribute('iPuff', new InstancedBufferAttribute(data, 4));
  geometry.setAttribute('iShade', new InstancedBufferAttribute(shade, 1));
  geometry.boundingSphere = new Sphere(new Vector3(0, 2200, 0), map.sizeM * 1.2);
  const material = new ShaderMaterial({
    uniforms: UniformsUtils.merge([UniformsLib.fog, { map: { value: null }, sunDir: { value: sunDir.clone() }, lit: { value: new Color(2.3, 2.27, 2.2) }, dark: { value: new Color(0.85, 0.92, 1.02) } }]),
    vertexShader: /* glsl */ `
      attribute vec4 iPuff;
      attribute float iShade;
      varying vec2 vUv;
      varying float vLight;
      varying float vAlpha;
      #include <fog_pars_vertex>
      void main() {
        vec4 mvPosition = viewMatrix * vec4(iPuff.xyz, 1.0);
        mvPosition.xy += position.xy * iPuff.w;
        vUv = position.xy * 0.5 + 0.5;
        // Brighter on top and toward the sun.
        vLight = clamp(iShade * 0.8 + position.y * 0.18 + 0.1, 0.0, 1.0);
        float dist = length(iPuff.xyz - cameraPosition);
        // Inside the cloud: thin mist, not a white screen.
        vAlpha = mix(0.12, 1.0, smoothstep(iPuff.w * 0.4, iPuff.w * 2.2, dist));
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec3 lit, dark;
      varying vec2 vUv;
      varying float vLight;
      varying float vAlpha;
      #include <fog_pars_fragment>
      void main() {
        float a = texture2D(map, vUv).a * vAlpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(mix(dark, lit, vLight), a * 0.9);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  material.uniforms['map']!.value = puffTexture();
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return {
    mesh,
    setCount(clusters) {
      geometry.instanceCount = Math.max(0, Math.min(MAX_CLUSTERS, clusters)) * PUFFS_PER_CLUSTER;
    },
  };
}
