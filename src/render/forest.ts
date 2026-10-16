// Forests (Day 11): low-poly pines and broadleaf trees, GPU-instanced, placed by rules (slope, altitude, moisture)
// from a forest density map that the terrain shader also reads (so the forest floor sits under the trees).
// * Near the camera: real 3D trees (two instanced draws), rebuilt from the per-tile lists as the camera moves.
// * Middle distance: impostors, camera-facing sprites of the same trees rendered once into a texture.
// * The two crossfade with an ordered dither (no popping), and the impostors dither out into the haze.
// Tree counts and distances come from the quality tier (forestTier); Low draws impostors only.
import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Sphere,
  UniformsLib,
  UniformsUtils,
  Vector3,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GameMap } from '../data/types';
import type { Terrain } from '../game/terrain';

export interface ForestTier {
  /** Average distance between candidate tree spots (m); denser forest = smaller. */
  spacingM: number;
  /** 3D trees out to this distance (0 = impostors only), crossfading over BAND_M. */
  near3dM: number;
  /** Impostors fade out into the haze by this distance. */
  farM: number;
}

export const FOREST_TIERS: Record<'low' | 'medium' | 'high', ForestTier> = {
  low: { spacingM: 66, near3dM: 0, farM: 3600 },
  medium: { spacingM: 32, near3dM: 700, farM: 6500 },
  high: { spacingM: 22, near3dM: 1300, farM: 9000 },
};

const BAND_M = 250;
const DENSITY_RES = 256;
const TILE_M = 4000;
/** Rebuild the near 3D set after the camera moves this far. */
const REBUILD_M = 120;

/** Where trees grow, per map kind: altitude band, how much of it is forest, and how far up broadleaf goes. */
const RULES: Record<GameMap['terrain'], { minM: number; treeLineM: number; cover: number; broadleafToM: number }> = {
  canyon: { minM: 18, treeLineM: 1450, cover: 1, broadleafToM: 200 },
  islands: { minM: 14, treeLineM: 560, cover: 0.7, broadleafToM: 260 },
  mesas: { minM: 30, treeLineM: 2000, cover: 0.06, broadleafToM: 0 },
  ocean: { minM: 1e9, treeLineM: 0, cover: 0, broadleafToM: 0 },
};

function hash2(x: number, z: number, s: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(s, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, z: number, s: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, s), b = hash2(ix + 1, iz, s), c = hash2(ix, iz + 1, s), d = hash2(ix + 1, iz + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** 0..1 forest density on a DENSITY_RES grid over the map (also the terrain shader's forest-floor map). */
export function forestDensity(map: GameMap, terrain: Terrain): { grid: Float32Array; texture: DataTexture } {
  const rule = RULES[map.terrain];
  const grid = new Float32Array(DENSITY_RES * DENSITY_RES);
  const bytes = new Uint8Array(DENSITY_RES * DENSITY_RES * 4);
  const cell = map.sizeM / (DENSITY_RES - 1);
  for (let j = 0; j < DENSITY_RES; j++) {
    for (let i = 0; i < DENSITY_RES; i++) {
      const x = -map.sizeM / 2 + i * cell;
      const z = -map.sizeM / 2 + j * cell;
      const h = terrain.heightAt(x, z);
      const sx = terrain.heightAt(x + 30, z) - terrain.heightAt(x - 30, z);
      const sz = terrain.heightAt(x, z + 30) - terrain.heightAt(x, z - 30);
      const slope = Math.hypot(sx, sz) / 60; // rise over run
      // Moisture: broad noise; lower ground is wetter. Clearings come from the finer noise.
      const moist = 0.6 * vnoise(x / 2200, z / 2200, map.seed) + 0.4 * vnoise(x / 700, z / 700, map.seed + 7) + 0.3 * (1 - Math.min(1, h / rule.treeLineM));
      const band = smoothstep(rule.minM, rule.minM + 25, h) * (1 - smoothstep(rule.treeLineM - 250, rule.treeLineM, h));
      // Conifers cling to steep slopes (up to ~45°); bare rock above that.
      const flat = 1 - smoothstep(0.85, 1.35, slope);
      const d = Math.max(0, Math.min(1, band * flat * smoothstep(0.35, 0.65, moist) * rule.cover * 1.4));
      grid[j * DENSITY_RES + i] = d;
      bytes[(j * DENSITY_RES + i) * 4] = Math.round(d * 255);
      bytes[(j * DENSITY_RES + i) * 4 + 3] = 255;
    }
  }
  const texture = new DataTexture(bytes, DENSITY_RES, DENSITY_RES, RGBAFormat);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return { grid, texture };
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Low-poly trees, 1 m tall at the origin (scaled per instance), vertex-coloured. */
function treeGeometry(kind: 'pine' | 'broad'): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const colour = (g: BufferGeometry, c: string, jitter = 0.06): BufferGeometry => {
    const base = new Color(c);
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const k = 1 + (((i * 7919) % 13) / 13 - 0.5) * jitter * 2;
      col[i * 3] = base.r * k;
      col[i * 3 + 1] = base.g * k;
      col[i * 3 + 2] = base.b * k;
    }
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    return g.index ? g.toNonIndexed() : g;
  };
  const trunk = new CylinderGeometry(0.025, 0.04, 0.22, 5, 1, true).translate(0, 0.11, 0);
  parts.push(colour(trunk, '#4a3526'));
  if (kind === 'pine') {
    // Three stacked cones, darker at the bottom.
    parts.push(colour(new ConeGeometry(0.2, 0.42, 7).translate(0, 0.38, 0), '#1f4a2c'));
    parts.push(colour(new ConeGeometry(0.16, 0.36, 7).translate(0, 0.6, 0), '#25553a'));
    parts.push(colour(new ConeGeometry(0.11, 0.3, 7).translate(0, 0.82, 0), '#2f6b3a'));
  } else {
    parts.push(colour(new IcosahedronGeometry(0.3, 0).scale(1, 0.82, 1).translate(0, 0.58, 0), '#2f5f2a', 0.1));
    parts.push(colour(new IcosahedronGeometry(0.2, 0).translate(0.12, 0.78, -0.05), '#386b31', 0.1));
  }
  for (const p of parts) p.deleteAttribute('uv');
  const merged = mergeGeometries(parts)!;
  merged.computeVertexNormals();
  return merged;
}

const DITHER_GLSL = /* glsl */ `
  float bayer4(vec2 p) {
    vec2 q = mod(floor(p), 4.0);
    float i = q.x + q.y * 4.0;
    // 4×4 Bayer matrix, normalised to (0, 1).
    return (mod(i * 5.0 + floor(i / 4.0) * 3.0, 16.0) + 0.5) / 16.0;
  }
`;

interface Tile {
  /** x, y, z, height per tree. */
  data: Float32Array;
  kind: Uint8Array;
  count: number;
  cx: number;
  cz: number;
  impostors: Mesh | null;
}

export interface Forest {
  group: Group;
  /** Forest density map for the terrain shader. */
  readonly densityTexture: DataTexture;
  setTier(tier: ForestTier): void;
  update(camera: Vector3): void;
  /** Trees on the map at the current tier, and 3D trees drawn now (for the perf overlay and tests). */
  readonly stats: { trees: number; near: number };
  dispose(): void;
}

export function createForest(map: GameMap, terrain: Terrain, renderer: WebGLRenderer): Forest {
  const group = new Group();
  const { grid, texture } = forestDensity(map, terrain);
  const rule = RULES[map.terrain];
  const half = map.sizeM / 2;
  const densityAt = (x: number, z: number): number => {
    const fx = ((x + half) / map.sizeM) * (DENSITY_RES - 1);
    const fz = ((z + half) / map.sizeM) * (DENSITY_RES - 1);
    const i = Math.max(0, Math.min(DENSITY_RES - 2, Math.floor(fx)));
    const j = Math.max(0, Math.min(DENSITY_RES - 2, Math.floor(fz)));
    const u = Math.min(1, fx - i), v = Math.min(1, fz - j);
    const g = (a: number, b: number): number => grid[b * DENSITY_RES + a]!;
    return (g(i, j) * (1 - u) + g(i + 1, j) * u) * (1 - v) + (g(i, j + 1) * (1 - u) + g(i + 1, j + 1) * u) * v;
  };

  // --- Impostor atlas: each tree type drawn once from a little above, left half pine, right half broadleaf.
  const geos = { pine: treeGeometry('pine'), broad: treeGeometry('broad') };
  const atlas = new WebGLRenderTarget(256, 256, { generateMipmaps: true, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter });
  {
    const scene = new Scene();
    scene.add(new HemisphereLight(0xdaf0ff, 0x3d5a66, 1.6));
    const sun = new DirectionalLight(0xfff1d6, 2.2);
    sun.position.set(-0.4, 0.8, 0.6);
    scene.add(sun);
    const mat = new MeshLambertMaterial({ vertexColors: true });
    const cam = new OrthographicCamera(-0.55, 0.55, 1.05, -0.05, -10, 10);
    cam.position.set(0, 0.35, 1);
    cam.lookAt(0, 0.5, 0);
    const prevTarget = renderer.getRenderTarget();
    const prevAlpha = renderer.getClearAlpha();
    const prevColour = new Color();
    renderer.getClearColor(prevColour);
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false; // one clear for the whole atlas, then both halves
    renderer.setRenderTarget(atlas);
    renderer.setClearColor(0x2c4a30, 0); // tree-ish colour, fully transparent, so mip edges don't go dark
    renderer.clear();
    for (const [i, g] of [geos.pine, geos.broad].entries()) {
      const m = new Mesh(g, mat);
      scene.add(m);
      atlas.viewport.set(i * 128, 0, 128, 256);
      renderer.setRenderTarget(atlas);
      renderer.render(scene, cam);
      scene.remove(m);
    }
    atlas.viewport.set(0, 0, 256, 256);
    renderer.autoClear = prevAuto;
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColour, prevAlpha);
    mat.dispose();
  }

  // --- Impostor material: camera-facing sprites anchored at the trunk, dithered in and out.
  // (The atlas is a render-target texture, which merge() can't clone: it's set right after.)
  const impUniforms = UniformsUtils.merge([UniformsLib.fog, { map: { value: null }, uNear: { value: 0 }, uBand: { value: BAND_M }, uFar: { value: 6000 }, uLight: { value: new Color(1, 1, 1) } }]);
  impUniforms['map']!.value = atlas.texture;
  const impMaterial = new ShaderMaterial({
    uniforms: impUniforms,
    fog: true,
    vertexShader: /* glsl */ `
      attribute vec4 iTree;
      attribute float iKind;
      varying vec2 vUv;
      varying float vFade;
      #include <fog_pars_vertex>
      uniform float uNear, uBand, uFar;
      void main() {
        float h = iTree.w;
        float wide = iKind > 0.5 ? 0.62 : 0.5;
        vec3 base = iTree.xyz;
        float dist = length(base - cameraPosition);
        vFade = smoothstep(uNear - uBand, uNear, dist) * (1.0 - smoothstep(uFar * 0.75, uFar, dist));
        vUv = vec2((position.x + 0.5) * 0.5 + iKind * 0.5, position.y);
        vec4 mvPosition = viewMatrix * vec4(base, 1.0);
        // Sprite in view space, but grown upward along the world's up as seen by the camera.
        vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        vec3 rightV = normalize(cross(upV, vec3(0.0, 0.0, 1.0)));
        mvPosition.xyz += rightV * position.x * h * wide * 2.0 + upV * position.y * h * 1.05;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec3 uLight;
      varying vec2 vUv;
      varying float vFade;
      #include <fog_pars_fragment>
      ${DITHER_GLSL}
      void main() {
        vec4 t = texture2D(map, vUv);
        if (t.a < 0.45 || vFade < bayer4(gl_FragCoord.xy)) discard;
        gl_FragColor = vec4(t.rgb * uLight, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  const quad = new BufferGeometry();
  quad.setAttribute('position', new Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  quad.setIndex([0, 1, 2, 0, 2, 3]);

  // --- Near 3D trees: standard (PBR, lit, fogged) with per-instance offset/scale and the dither fade.
  const nearMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true });
  const nearUniforms = { uNear: { value: 0 }, uBand: { value: BAND_M } };
  nearMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, nearUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 iTree;\nuniform float uNear, uBand;\nvarying float vFade;')
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = position * iTree.w + iTree.xyz;
        vFade = 1.0 - smoothstep(uNear - uBand, uNear, length(iTree.xyz - cameraPosition));`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vFade;\n${DITHER_GLSL}`)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vFade < bayer4(gl_FragCoord.xy)) discard;');
  };
  const MAX_NEAR = 24000;
  const nearSets = (['pine', 'broad'] as const).map((k) => {
    const g = new InstancedBufferGeometry();
    g.index = geos[k].index;
    for (const name of ['position', 'normal', 'color']) {
      const a = geos[k].getAttribute(name);
      if (a) g.setAttribute(name, a);
    }
    const attr = new InstancedBufferAttribute(new Float32Array(MAX_NEAR * 4), 4);
    attr.setUsage(35048); // DynamicDrawUsage
    g.setAttribute('iTree', attr);
    g.instanceCount = 0;
    const mesh = new Mesh(g, nearMaterial);
    mesh.frustumCulled = false;
    group.add(mesh);
    return { kind: k === 'pine' ? 0 : 1, geometry: g, attr };
  });

  let tiles: Tile[] = [];
  let tier = FOREST_TIERS.medium;
  let lastBuild = new Vector3(1e9, 0, 0);
  const stats = { trees: 0, near: 0 };

  const build = (t: ForestTier): void => {
    for (const tile of tiles) {
      if (tile.impostors) {
        group.remove(tile.impostors);
        tile.impostors.geometry.dispose();
      }
    }
    tiles = [];
    stats.trees = 0;
    const n = Math.ceil(map.sizeM / TILE_M);
    const s = t.spacingM;
    for (let tz = 0; tz < n; tz++) {
      for (let tx = 0; tx < n; tx++) {
        const x0 = -half + tx * TILE_M;
        const z0 = -half + tz * TILE_M;
        const xs: number[] = [];
        const kinds: number[] = [];
        for (let z = z0; z < z0 + TILE_M; z += s) {
          for (let x = x0; x < x0 + TILE_M; x += s) {
            const gx = Math.round((x + half) / s);
            const gz = Math.round((z + half) / s);
            // Jittered grid: one candidate per cell, kept with the forest's density.
            const px = x + (hash2(gx, gz, 11) - 0.5) * s * 0.9;
            const pz = z + (hash2(gx, gz, 23) - 0.5) * s * 0.9;
            if (hash2(gx, gz, 37) > densityAt(px, pz)) continue;
            const h = terrain.heightAt(px, pz);
            if (h < rule.minM) continue;
            // Never on a cliff (the density map is coarse; check the exact spot).
            const sl = Math.abs(terrain.heightAt(px + 6, pz) - terrain.heightAt(px - 6, pz)) + Math.abs(terrain.heightAt(px, pz + 6) - terrain.heightAt(px, pz - 6));
            if (sl > 22) continue;
            const r = hash2(gx, gz, 51);
            const broad = h < rule.broadleafToM * (0.7 + 0.6 * hash2(gx, gz, 63));
            const height = broad ? 12 + r * 10 : 18 + r * 16;
            xs.push(px, h - 0.6, pz, height);
            kinds.push(broad ? 1 : 0);
          }
        }
        const count = kinds.length;
        if (count === 0) continue;
        const tile: Tile = { data: new Float32Array(xs), kind: new Uint8Array(kinds), count, cx: x0 + TILE_M / 2, cz: z0 + TILE_M / 2, impostors: null };
        const g = new InstancedBufferGeometry();
        g.index = quad.index;
        g.setAttribute('position', quad.getAttribute('position'));
        g.setAttribute('iTree', new InstancedBufferAttribute(tile.data, 4));
        g.setAttribute('iKind', new InstancedBufferAttribute(new Float32Array(kinds), 1));
        g.instanceCount = count;
        // Bounds: the tile's square (plus tree height), so whole tiles off-screen are skipped. three only
        // computes bounds when they're null, so these stick.
        g.boundingSphere = new Sphere(new Vector3(tile.cx, 600, tile.cz), TILE_M * 0.75 + 600);
        const mesh = new Mesh(g, impMaterial);
        tile.impostors = mesh;
        group.add(mesh);
        tiles.push(tile);
        stats.trees += count;
      }
    }
    lastBuild.set(1e9, 0, 0);
  };

  const rebuildNear = (cam: Vector3): void => {
    const counts = [0, 0];
    const r2 = (tier.near3dM + BAND_M) ** 2;
    if (tier.near3dM > 0) {
      for (const tile of tiles) {
        if (Math.abs(tile.cx - cam.x) > TILE_M / 2 + tier.near3dM || Math.abs(tile.cz - cam.z) > TILE_M / 2 + tier.near3dM) continue;
        const d = tile.data;
        for (let i = 0; i < tile.count; i++) {
          const dx = d[i * 4]! - cam.x, dz = d[i * 4 + 2]! - cam.z;
          if (dx * dx + dz * dz > r2) continue;
          const k = tile.kind[i]!;
          const set = nearSets[k]!;
          const c = counts[k]!;
          if (c >= MAX_NEAR) continue;
          set.attr.array.set(d.subarray(i * 4, i * 4 + 4), c * 4);
          counts[k] = c + 1;
        }
      }
    }
    for (const set of nearSets) {
      set.geometry.instanceCount = counts[set.kind]!;
      set.attr.needsUpdate = true;
      set.attr.clearUpdateRanges();
      set.attr.addUpdateRange(0, counts[set.kind]! * 4);
    }
    stats.near = counts[0]! + counts[1]!;
  };

  return {
    group,
    densityTexture: texture,
    stats,
    setTier(next) {
      tier = next;
      nearUniforms.uNear.value = next.near3dM;
      impUniforms['uNear']!.value = next.near3dM;
      impUniforms['uFar']!.value = next.farM;
      build(next);
    },
    update(cam) {
      // Tiles wholly beyond the impostors' fade-out distance aren't drawn at all.
      for (const tile of tiles) {
        const dx = Math.max(0, Math.abs(cam.x - tile.cx) - TILE_M / 2);
        const dz = Math.max(0, Math.abs(cam.z - tile.cz) - TILE_M / 2);
        tile.impostors!.visible = Math.hypot(dx, dz, Math.max(0, cam.y - 1500)) < tier.farM;
      }
      if (cam.distanceToSquared(lastBuild) > REBUILD_M * REBUILD_M) {
        lastBuild.copy(cam);
        rebuildNear(cam);
      }
    },
    dispose() {
      for (const tile of tiles) tile.impostors?.geometry.dispose();
      atlas.dispose();
      texture.dispose();
      impMaterial.dispose();
      nearMaterial.dispose();
    },
  };
}
