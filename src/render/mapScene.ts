// Everything static about a map: sky, sun, haze, water, terrain, forests, clouds and the distant ranges.
// Drawn in two passes (render()): a backdrop (sky and the distant ranges, with a far plane at 60 km) and then,
// after clearing depth, the map itself with the quality tier's draw distance. Quality changes apply here;
// every Day 11 visual has a switch in core/quality.ts.
import {
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Object3D,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  Texture,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { QUALITY, type QualityLevel } from '../core/quality';
import type { GameMap } from '../data/types';
import { sunDirFor } from '../game/sun';
import type { Terrain } from '../game/terrain';
import { createClouds } from './clouds';
import { createForest, FOREST_TIERS } from './forest';
import { createFarTerrain, createHorizon } from './horizon';
import { createBackdropSea, createOcean, createReflectiveOcean } from './ocean';
import { createSky } from './sky';
import { createTerrainMaterial, createTerrainShading, setTerrainTextures } from './terrainMaterial';
import { createTerrainMesh } from './terrainMesh';
import { loadTerrainTextures } from './terrainTextures';

export interface MapScene {
  scene: Scene;
  /** Point the sun's shadow camera at this object (the player's plane) each frame. */
  shadowTarget: Object3D | null;
  setQuality(level: QualityLevel, renderer: WebGLRenderer, camera: PerspectiveCamera): void;
  update(timeS: number, camera: PerspectiveCamera): void;
  /** Draw the backdrop, then the map. */
  render(renderer: WebGLRenderer, camera: PerspectiveCamera): void;
  stats: { terrainChunks: number; trees: () => number; nearTrees: () => number; terrainTriangles: () => number };
  /** Debug: the scene's parts by name, to switch them off one at a time when profiling. */
  parts: Record<string, Object3D>;
  dispose(): void;
}

let environment: Promise<Texture | null> | null = null;
/** The Poly Haven sky HDRI as a prefiltered environment map (Medium and High), loaded once for every map. */
function loadEnvironment(renderer: WebGLRenderer): Promise<Texture | null> {
  if (!environment) {
    environment = new HDRLoader()
      .loadAsync(`${import.meta.env.BASE_URL}textures/sky.hdr`)
      .then((hdr) => {
        const pmrem = new PMREMGenerator(renderer);
        const env = pmrem.fromEquirectangular(hdr).texture;
        hdr.dispose();
        pmrem.dispose();
        return env;
      })
      .catch(() => null);
  }
  return environment;
}

export function createMapScene(map: GameMap, terrain: Terrain, renderer: WebGLRenderer): MapScene {
  const scene = new Scene();
  const backdrop = new Scene();
  const backCam = new PerspectiveCamera(60, 1, 50, 60_000);
  const sunDir = new Vector3(...sunDirFor(map));
  // Haze: the horizon colour pulled a little toward blue, so far ridges go lighter and bluer.
  const haze = new Color(map.colors.skyHorizon).lerp(new Color('#9cc2e8'), 0.35);
  const fog = new FogExp2(haze.getHex(), 1e-4);
  scene.fog = fog;
  scene.background = null;
  const backFog = new FogExp2(haze.getHex(), 6.5e-5);
  backdrop.fog = backFog;
  backdrop.background = haze.clone();

  const sky = createSky(sunDir, fog.color, { cloudCoverage: map.terrain === 'mesas' ? 0.12 : 0.28 });
  backdrop.add(sky.mesh);
  const horizon = createHorizon(map, haze);
  if (horizon) backdrop.add(horizon);
  backdrop.add(createBackdropSea(map));
  const farTerrain = createFarTerrain(map, terrain);
  if (farTerrain) backdrop.add(farTerrain);

  let ocean = createOcean(map, sunDir);
  let reflective = false;
  scene.add(ocean.mesh);

  const forest = map.terrain === 'ocean' ? null : createForest(map, terrain, renderer);
  const shading = createTerrainShading(
    {
      snowLineM: map.snowLineM,
      sandLineM: 12,
      grass: new Color(map.colors.grass),
      forest: new Color(map.forestColor),
      rock: new Color(map.colors.rock),
      snow: new Color('#eef3f7'),
      sand: new Color(map.colors.sand),
    },
    { forest: forest?.densityTexture ?? new Texture(), sizeM: map.sizeM },
  );
  const terrainMesh = createTerrainMesh(map, terrain, (uMorph) => createTerrainMaterial(shading, uMorph), true);
  scene.add(terrainMesh.group);
  if (forest) scene.add(forest.group);
  const clouds = createClouds(map, sunDir);
  scene.add(clouds.mesh);

  const hemi = new HemisphereLight(0xdaf0ff, 0x3d5a66, 1.2);
  scene.add(hemi);
  const backHemi = new HemisphereLight(0xdaf0ff, 0x3d5a66, 1.2);
  backdrop.add(backHemi);
  const sun = new DirectionalLight(0xfff1d6, 2.6);
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = -60;
  sc.right = 60;
  sc.top = 60;
  sc.bottom = -60;
  sc.near = 1;
  sc.far = 1200;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const backSun = new DirectionalLight(0xfff1d6, 2.2);
  backSun.position.copy(sunDir);
  backdrop.add(backSun);

  let level: QualityLevel | null = null;
  let disposed = false;

  const parts: Record<string, Object3D> = { sky: sky.mesh, terrain: terrainMesh.group, clouds: clouds.mesh, ocean: ocean.mesh };
  if (forest) parts['forest'] = forest.group;
  if (horizon) parts['horizon'] = horizon;
  if (farTerrain) parts['far'] = farTerrain;
  const api: MapScene = {
    scene,
    parts,
    shadowTarget: null,
    stats: {
      terrainChunks: terrainMesh.chunkCount,
      trees: () => forest?.stats.trees ?? 0,
      nearTrees: () => forest?.stats.near ?? 0,
      terrainTriangles: () => terrainMesh.triangles,
    },
    setQuality(next, r, camera) {
      const q = QUALITY[next];
      const first = level === null;
      const forestChanged = first || QUALITY[level!].forest !== q.forest;
      level = next;
      r.shadowMap.enabled = q.shadows;
      sun.castShadow = q.shadows;
      clouds.setCount(q.clouds);
      sky.setDetail(next !== 'low');
      terrainMesh.setLodScale(q.lodScale);
      camera.far = q.drawDistance;
      camera.updateProjectionMatrix();
      if (farTerrain) (farTerrain.userData['uNear'] as { value: number }).value = q.drawDistance * 0.9;
      // Haze tuned to the draw distance: about 60% at the far plane (the terrain shader fades the last bit).
      fog.density = 0.96 / q.drawDistance;
      if (horizon) horizon.visible = q.horizon;
      if (forest && forestChanged) forest.setTier(FOREST_TIERS[q.forest]);
      // Water: reflective on High, the cheap shader below that.
      if (q.reflectiveWater !== reflective) {
        scene.remove(ocean.mesh);
        ocean = q.reflectiveWater ? createReflectiveOcean(map) : createOcean(map, sunDir);
        reflective = q.reflectiveWater;
        scene.add(ocean.mesh);
      }
      // Terrain textures and sky light stream in after the match is up; until then palette colours and the
      // hemisphere light carry the scene.
      if (q.terrainTextures) {
        void loadTerrainTextures(r).then((tex) => {
          if (!disposed && level !== null && QUALITY[level].terrainTextures) setTerrainTextures(shading, tex, QUALITY[level].detailNormals);
        });
      } else setTerrainTextures(shading, null, false);
      if (q.ibl) {
        void loadEnvironment(r).then((env) => {
          if (disposed || level === null || !QUALITY[level].ibl || !env) return;
          // The HDRI's sky (and its sun) is bright: it fills the shadows and adds reflections, the sun light
          // still does the main lighting.
          scene.environment = env;
          scene.environmentIntensity = 0.35;
          backdrop.environment = env;
          backdrop.environmentIntensity = 0.35;
          hemi.intensity = 0.55;
          backHemi.intensity = 0.55;
        });
      } else {
        scene.environment = null;
        backdrop.environment = null;
        hemi.intensity = 1.2;
        backHemi.intensity = 1.2;
      }
      // Materials must recompile when shadows toggle.
      scene.traverse((o) => {
        const m = (o as { material?: { needsUpdate: boolean } }).material;
        if (m) m.needsUpdate = true;
      });
    },
    update(timeS, camera) {
      ocean.update(timeS, camera.position);
      sky.update(timeS);
      forest?.update(camera.position);
      terrainMesh.update(camera.position, frameDt(timeS));
      // Sun (and its small shadow box) rides along with the shadow target, or the camera.
      const anchor = api.shadowTarget?.position ?? camera.position;
      sun.target.position.copy(anchor);
      sun.position.copy(anchor).addScaledVector(sunDir, 600);
      sun.target.updateMatrixWorld();
    },
    render(r, camera) {
      backCam.position.copy(camera.position);
      backCam.quaternion.copy(camera.quaternion);
      if (backCam.fov !== camera.fov || backCam.aspect !== camera.aspect) {
        backCam.fov = camera.fov;
        backCam.aspect = camera.aspect;
        backCam.updateProjectionMatrix();
      }
      backCam.updateMatrixWorld();
      const auto = r.autoClear;
      r.autoClear = false;
      r.clear();
      r.render(backdrop, backCam);
      r.clearDepth();
      r.render(scene, camera);
      r.autoClear = auto;
    },
    dispose() {
      disposed = true;
      forest?.dispose();
      scene.traverse((o) => {
        const g = (o as { geometry?: { dispose(): void } }).geometry;
        g?.dispose();
      });
    },
  };
  let lastT = -1;
  const frameDt = (t: number): number => {
    const dt = lastT < 0 ? 0 : Math.min(0.1, Math.max(0, t - lastT));
    lastT = t;
    return dt;
  };
  return api;
}
