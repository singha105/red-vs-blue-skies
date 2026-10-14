// Everything static about a map: sky, sun, ocean, terrain, clouds, fog. Quality changes apply here.
import { Color, DirectionalLight, Fog, HemisphereLight, Object3D, PerspectiveCamera, Scene, Vector3, type WebGLRenderer } from 'three';
import { QUALITY, type QualityLevel } from '../core/quality';
import type { GameMap } from '../data/types';
import type { Terrain } from '../game/terrain';
import { createClouds } from './clouds';
import { createOcean } from './ocean';
import { createSky } from './sky';
import { createTerrainMesh } from './terrainMesh';

export interface MapScene {
  scene: Scene;
  /** Point the sun's shadow camera at this object (the player's plane) each frame. */
  shadowTarget: Object3D | null;
  setQuality(level: QualityLevel, renderer: WebGLRenderer, camera: PerspectiveCamera): void;
  update(timeS: number, camera: PerspectiveCamera): void;
  stats: { terrainChunks: number };
}

export function createMapScene(map: GameMap, terrain: Terrain): MapScene {
  const scene = new Scene();
  const horizon = new Color(map.colors.skyHorizon);
  scene.background = horizon;
  const fog = new Fog(horizon, 3000, 10000);
  scene.fog = fog;

  const sunDir = new Vector3(-0.45, 0.75, 0.48).normalize();
  scene.add(createSky(map, sunDir));
  const ocean = createOcean(map, sunDir);
  scene.add(ocean.mesh);
  const terrainMesh = createTerrainMesh(map, terrain, true);
  scene.add(terrainMesh.group);
  const clouds = createClouds(map);
  scene.add(clouds.mesh);

  scene.add(new HemisphereLight(0xdaf0ff, 0x3d5a66, 1.35));
  const sun = new DirectionalLight(0xfff1d6, 2.3);
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

  const api: MapScene = {
    scene,
    shadowTarget: null,
    stats: { terrainChunks: terrainMesh.chunkCount },
    setQuality(level, renderer, camera) {
      const q = QUALITY[level];
      renderer.shadowMap.enabled = q.shadows;
      sun.castShadow = q.shadows;
      clouds.setCount(q.clouds);
      terrainMesh.setLodScale(q.lodScale);
      camera.far = q.drawDistance;
      camera.updateProjectionMatrix();
      fog.near = q.drawDistance * 0.3;
      fog.far = q.drawDistance * 0.92;
      // Materials must recompile when shadows toggle.
      scene.traverse((o) => {
        const m = (o as { material?: { needsUpdate: boolean } }).material;
        if (m) m.needsUpdate = true;
      });
    },
    update(timeS, camera) {
      ocean.update(timeS, camera.position);
      // Sun (and its small shadow box) rides along with the shadow target, or the camera.
      const anchor = api.shadowTarget?.position ?? camera.position;
      sun.target.position.copy(anchor);
      sun.position.copy(anchor).addScaledVector(sunDir, 600);
      sun.target.updateMatrixWorld();
    },
  };
  return api;
}
