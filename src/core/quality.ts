// Graphics presets and the 5-second automatic picker.
import type { GraphicsLevel } from './settings';

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';
export const QUALITY_LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high', 'ultra'];

/**
 * Every visual feature has a switch here (Day 11; Day 12 made the game desktop-only and added Ultra):
 * Low (older laptops with integrated graphics): tone mapping, haze, impostor trees only, palette-coloured terrain, simple water, no shadows,
 * no bloom, no image-based light. Medium: textured terrain, near 3D trees, bloom, sky light (IBL).
 * High: everything, plus detail normals, reflective water, player-following shadows, denser forests, more clouds.
 * Ultra: High plus LOD0 planes at longer range, 4K hangar textures and sharper shadows. The auto picker never
 * chooses Ultra; players pick it in Settings.
 */
export interface QualityPreset {
  /** Upper bound on devicePixelRatio. */
  maxPixelRatio: number;
  shadows: boolean;
  clouds: number;
  /** Camera far plane, metres; the haze is tuned to it. */
  drawDistance: number;
  /** Multiplier on terrain level-of-detail switch distances. */
  lodScale: number;
  /** Poly Haven textures on the terrain (else palette colours with noise). */
  terrainTextures: boolean;
  detailNormals: boolean;
  /** Tree density and distances (forest.ts FOREST_TIERS). */
  forest: 'low' | 'medium' | 'high';
  /** Image-based light from the HDRI. */
  ibl: boolean;
  reflectiveWater: boolean;
  bloom: boolean;
  /** Distant mountain ranges on the horizon. */
  horizon: boolean;
  /** Shadow map size (pixels per side) when shadows are on. */
  shadowMapSize: number;
  /** Multiplier on the plane model LOD switch distances (LOD0 drawn further out). */
  planeLodScale: number;
  /** The hangar shows the 4K texture set where a plane has one. */
  hangar4k: boolean;
}

export const QUALITY: Record<QualityLevel, QualityPreset> = {
  low: { maxPixelRatio: 1, shadows: false, clouds: 35, drawDistance: 7000, lodScale: 0.6, terrainTextures: false, detailNormals: false, forest: 'low', ibl: false, reflectiveWater: false, bloom: false, horizon: true, shadowMapSize: 1024, planeLodScale: 0.6, hangar4k: false },
  medium: { maxPixelRatio: 1.5, shadows: false, clouds: 90, drawDistance: 10500, lodScale: 1, terrainTextures: true, detailNormals: false, forest: 'medium', ibl: true, reflectiveWater: false, bloom: true, horizon: true, shadowMapSize: 1024, planeLodScale: 1, hangar4k: false },
  high: { maxPixelRatio: 2, shadows: true, clouds: 150, drawDistance: 14000, lodScale: 1.5, terrainTextures: true, detailNormals: true, forest: 'high', ibl: true, reflectiveWater: true, bloom: true, horizon: true, shadowMapSize: 2048, planeLodScale: 1.4, hangar4k: false },
  ultra: { maxPixelRatio: 2, shadows: true, clouds: 180, drawDistance: 16000, lodScale: 1.8, terrainTextures: true, detailNormals: true, forest: 'high', ibl: true, reflectiveWater: true, bloom: true, horizon: true, shadowMapSize: 4096, planeLodScale: 2.5, hangar4k: true },
};

export const isQualityLevel = (v: unknown): v is QualityLevel => typeof v === 'string' && (QUALITY_LEVELS as readonly string[]).includes(v);

/** Starting level before "auto" has measured anything. */
export function initialLevel(setting: GraphicsLevel, _isTouch: boolean, automated = false): QualityLevel {
  if (setting !== 'auto') return setting;
  // Automated test browsers render in software: start them on Low (tests that need a tier pass ?gfx=).
  if (automated) return 'low';
  return 'medium';
}

/** Level for a measured average frame rate. */
export function levelForFps(fps: number): QualityLevel {
  if (fps >= 55) return 'high';
  if (fps >= 40) return 'medium';
  return 'low';
}

const WARMUP_S = 0.75;
const MEASURE_S = 5;

/**
 * Level for a frame rate measured under the 30 fps cap: holding the cap only proves medium is affordable
 * (high could still drop below it), so never pick high.
 */
export function levelForCappedFps(fps: number): QualityLevel {
  return fps >= 28 ? 'medium' : 'low';
}

/** Feeds frame times for 5 seconds (after a short warm-up) and then reports a level once. */
export function createAutoQuality(onPick: (level: QualityLevel, fps: number) => void, capped: () => boolean = () => false): { frame(dt: number): void } {
  let warm = 0;
  let elapsed = 0;
  let frames = 0;
  let done = false;
  return {
    frame(dt) {
      if (done) return;
      if (warm < WARMUP_S) {
        warm += dt;
        return;
      }
      elapsed += dt;
      frames++;
      if (elapsed >= MEASURE_S) {
        done = true;
        const fps = frames / elapsed;
        onPick(capped() ? levelForCappedFps(fps) : levelForFps(fps), fps);
      }
    },
  };
}
