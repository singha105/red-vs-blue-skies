// Terrain shading (Day 11): MeshStandardMaterial (PBR, shadows, fog, tone mapping, IBL) with the base colour and
// normal replaced per pixel:
// * Five surfaces blended per pixel, never per texel of a coarse splat map: sand near the water, grass, forest
//   floor under the trees, rock on steep slopes (triplanar, so cliffs don't stretch), and snow above a snow line,
//   mostly on flatter ground. Every threshold is pushed around by value noise so the edges are ragged and
//   organic, not blocky (docs/ART_DIRECTION.md, "Avoid").
// * Medium/High sample the Poly Haven CC0 textures (KTX2) with a macro tint against tiling; High adds detail
//   normal maps near the camera. Low uses the same blend with flat palette colours and noise (no textures).
// * Geomorphing: each vertex also carries the height of the next coarser level (`morphY`); `uMorph` (per chunk)
//   slides between them, so LOD changes glide instead of popping.
import { Color, MeshStandardMaterial, Vector3, type Texture } from 'three';
import averages from '../data/textureAverages.json';

export interface TerrainTextures {
  grass: Texture;
  forest: Texture;
  rock: Texture;
  snow: Texture;
  sand: Texture;
  grassNormal: Texture | null;
  rockNormal: Texture | null;
}

export interface TerrainLook {
  snowLineM: number;
  /** Below this the ground is beach sand (metres). */
  sandLineM: number;
  grass: Color;
  forest: Color;
  rock: Color;
  snow: Color;
  sand: Color;
}

/** Forest density map (R) for the whole map, the same one the tree placer uses, so the floor matches the trees. */
export interface TerrainMaps {
  forest: Texture;
  sizeM: number;
}

const NOISE_GLSL = /* glsl */ `
  float tHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float tNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), u.x), mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float tFbm(vec2 p) { return tNoise(p) * 0.5 + tNoise(p * 2.03 + 17.1) * 0.3 + tNoise(p * 4.1 - 9.7) * 0.2; }
`;

/** Uniforms and switches shared by every chunk's material (one compiled program); textures arrive later. */
export interface TerrainShading {
  uniforms: Record<string, { value: unknown }>;
  textured: boolean;
  detailNormals: boolean;
  materials: Set<MeshStandardMaterial>;
}

export function createTerrainShading(look: TerrainLook, maps: TerrainMaps): TerrainShading {
  const uniforms = {
    uSnowLine: { value: look.snowLineM },
    uSandLine: { value: look.sandLineM },
    uMapSize: { value: maps.sizeM },
    uForestMap: { value: maps.forest },
    cGrass: { value: look.grass },
    cForest: { value: look.forest },
    cRock: { value: look.rock },
    cSnow: { value: look.snow },
    cSand: { value: look.sand },
    // Each texture's average linear colour (tools/fetch-textures.mjs), so detail = texel ÷ average.
    aGrass: { value: new Vector3(...averages.grass) },
    aForest: { value: new Vector3(...averages.forest) },
    aRock: { value: new Vector3(...averages.rock) },
    aSnow: { value: new Vector3(...averages.snow) },
    aSand: { value: new Vector3(...averages.sand) },
    tGrass: { value: null as unknown },
    tForest: { value: null as unknown },
    tRock: { value: null as unknown },
    tSnow: { value: null as unknown },
    tSand: { value: null as unknown },
    tGrassN: { value: null as unknown },
    tRockN: { value: null as unknown },
  };
  return { uniforms, textured: false, detailNormals: false, materials: new Set() };
}

/** Switch every chunk to the textured shader (Medium, High) or back to palette colours (Low, or no textures). */
export function setTerrainTextures(shading: TerrainShading, tex: TerrainTextures | null, detailNormals: boolean): void {
  const u = shading.uniforms;
  u['tGrass']!.value = tex?.grass ?? null;
  u['tForest']!.value = tex?.forest ?? null;
  u['tRock']!.value = tex?.rock ?? null;
  u['tSnow']!.value = tex?.snow ?? null;
  u['tSand']!.value = tex?.sand ?? null;
  u['tGrassN']!.value = tex?.grassNormal ?? null;
  u['tRockN']!.value = tex?.rockNormal ?? null;
  shading.textured = tex !== null;
  shading.detailNormals = shading.textured && detailNormals && Boolean(tex?.grassNormal && tex.rockNormal);
  for (const m of shading.materials) applyDefines(shading, m);
}

function applyDefines(shading: TerrainShading, m: MeshStandardMaterial): void {
  const d: Record<string, string> = {};
  if (shading.textured) d['TERRAIN_TEXTURED'] = '';
  if (shading.detailNormals) d['TERRAIN_DETAIL_NORMALS'] = '';
  m.defines = d;
  m.needsUpdate = true;
}

/** One chunk's material: the shared shading plus its own morph factor (built-in materials only re-upload
 *  uniforms when the material changes between draws, so each chunk gets an instance; they share a program). */
export function createTerrainMaterial(shading: TerrainShading, uMorph: { value: number }): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ roughness: 0.94, metalness: 0, envMapIntensity: 0.5 });
  const uniforms = shading.uniforms;
  applyDefines(shading, material);
  material.customProgramCacheKey = () => `terrain-${shading.textured}-${shading.detailNormals}`;
  shading.materials.add(material);

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, { uMorph });
    const useNormals = shading.detailNormals;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float morphY;
        uniform float uMorph;
        varying vec3 vTerrainPos;
        varying vec3 vTerrainNormal;`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position.x, mix(position.y, morphY, uMorph), position.z);
        vTerrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTerrainNormal = normal;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        ${NOISE_GLSL}
        varying vec3 vTerrainPos;
        varying vec3 vTerrainNormal;
        uniform float uSnowLine;
        uniform float uSandLine;
        uniform float uMapSize;
        uniform sampler2D uForestMap;
        uniform vec3 cGrass, cForest, cRock, cSnow, cSand;
        #ifdef TERRAIN_TEXTURED
          uniform sampler2D tGrass, tForest, tRock, tSnow, tSand;
          uniform vec3 aGrass, aForest, aRock, aSnow, aSand;
        #endif
        #ifdef TERRAIN_DETAIL_NORMALS
          uniform sampler2D tGrassN, tRockN;
        #endif
        vec4 terrainW;
        float terrainRock;
        // Texel ÷ texture average, kept in a sane range; fades to 1 (the plain palette colour) far away, where
        // textures would only shimmer and repeat.
        vec3 terrainDetail(vec3 texel, vec3 avg, float far) {
          vec3 r3 = clamp(texel / max(avg, vec3(0.02)), 0.55, 1.6);
          // Mostly brightness detail: a little of the texture's own hue, the palette's colour.
          vec3 r = mix(vec3(dot(r3, vec3(0.3333))), r3, 0.3);
          return mix(r, vec3(1.0), far);
        }
        vec3 terrainTri(sampler2D t, vec3 p, vec3 w, float s) {
          return texture2D(t, p.zy * s).rgb * w.x + texture2D(t, p.xz * s).rgb * w.y + texture2D(t, p.xy * s).rgb * w.z;
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `{
          vec3 p = vTerrainPos;
          vec3 n = normalize(vTerrainNormal);
          #ifdef TERRAIN_TEXTURED
            float n1 = tFbm(p.xz / 90.0);
            float n2 = tFbm(p.xz / 23.0 + 5.3);
            float macro = tFbm(p.xz / 700.0 - 3.1);
          #else
            // Low (phones): one octave each is plenty without textures, and much cheaper per pixel.
            float n1 = tNoise(p.xz / 90.0);
            float n2 = tNoise(p.xz / 23.0 + 5.3);
            float macro = tNoise(p.xz / 700.0 - 3.1);
          #endif
          // Forest floor follows the tree density map, sampled with a noisy offset so its edge is ragged.
          vec2 fuv = (p.xz + (vec2(n1, n2) - 0.5) * 70.0) / uMapSize + 0.5;
          float forest = smoothstep(0.25, 0.6, texture2D(uForestMap, fuv).r + (n2 - 0.5) * 0.35);
          float slope = 1.0 - n.y;
          float rock = smoothstep(0.34, 0.48, slope + (n1 - 0.5) * 0.22);
          // Snow lies on flatter high ground and thins out on steep rock.
          float snowLine = uSnowLine + (n1 - 0.5) * 260.0 + (macro - 0.5) * 200.0;
          float snow = smoothstep(snowLine - 60.0, snowLine + 60.0, p.y) * (1.0 - smoothstep(0.35, 0.62, slope + (n2 - 0.5) * 0.25));
          float sand = 1.0 - smoothstep(uSandLine - 3.0, uSandLine + 6.0, p.y + (n2 - 0.5) * 7.0);
          vec4 w = vec4(1.0 - forest, forest, 0.0, 0.0); // grass, forest
          terrainRock = rock * (1.0 - snow);
          w *= (1.0 - terrainRock) * (1.0 - snow) * (1.0 - sand);
          terrainW = w;
          #ifdef TERRAIN_TEXTURED
            // Each texture is detail on top of the map's palette colour: its texel divided by its own average
            // (measured when the textures were encoded), so the alpine valley and the desert keep their own colours.
            vec3 tw = pow(abs(n), vec3(4.0));
            tw /= (tw.x + tw.y + tw.z);
            float far = smoothstep(900.0, 3500.0, length(p - cameraPosition));
            vec3 grassC = cGrass * terrainDetail(texture2D(tGrass, p.xz / 40.0).rgb, aGrass, far);
            vec3 forestC = cForest * terrainDetail(texture2D(tForest, p.xz / 20.0).rgb, aForest, far);
            // Rock at two scales so the triplanar pattern never reads as tiles.
            vec3 rockAvg = aRock;
            vec3 rockC = cRock * terrainDetail(terrainTri(tRock, p, tw, 1.0 / 90.0), rockAvg, far * 0.6) * terrainDetail(terrainTri(tRock, p, tw, 1.0 / 21.0), rockAvg, far);
            vec3 snowC = cSnow * terrainDetail(texture2D(tSnow, p.xz / 60.0).rgb, aSnow, far * 0.5);
            vec3 sandC = cSand * terrainDetail(texture2D(tSand, p.xz / 22.0).rgb, aSand, far);
          #else
            vec3 grassC = cGrass * (0.85 + 0.3 * n2);
            vec3 forestC = cForest * (0.85 + 0.3 * n1);
            vec3 rockC = cRock * (0.8 + 0.4 * n2);
            vec3 snowC = cSnow * (0.94 + 0.06 * n1);
            vec3 sandC = cSand * (0.9 + 0.2 * n2);
          #endif
          vec3 col = grassC * w.x + forestC * w.y + rockC * terrainRock + snowC * snow + sandC * sand * (1.0 - snow);
          // Large-scale tint breaks up any remaining repetition (meadows, darker patches).
          col *= 0.86 + 0.28 * macro;
          diffuseColor.rgb *= col;
        }`,
      );
    if (useNormals) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          // World-space detail normals near the camera (UDN blend on the ground plane, triplanar-ish on rock).
          vec3 p = vTerrainPos;
          float near = 1.0 - smoothstep(600.0, 1800.0, length(p - cameraPosition));
          if (near > 0.0) {
            vec3 nW = normalize(vTerrainNormal);
            vec3 g = texture2D(tGrassN, p.xz / 35.0).xyz * 2.0 - 1.0;
            vec3 r = texture2D(tRockN, p.xz / 30.0).xyz * 2.0 - 1.0;
            vec3 d = mix(g, r, terrainRock) * near * 0.9;
            vec3 nP = normalize(vec3(nW.x + d.x, nW.y, nW.z - d.y));
            normal = normalize((viewMatrix * vec4(nP, 0.0)).xyz);
          }
        }`,
      );
    }
  };
  return material;
}
