// Graphics presets and the 5-second automatic picker.
import type { GraphicsLevel } from './settings';

export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualityPreset {
  /** Upper bound on devicePixelRatio. */
  maxPixelRatio: number;
  shadows: boolean;
  clouds: number;
  /** Camera far plane and fog end, metres. */
  drawDistance: number;
  /** Multiplier on terrain level-of-detail switch distances. */
  lodScale: number;
}

export const QUALITY: Record<QualityLevel, QualityPreset> = {
  low: { maxPixelRatio: 1, shadows: false, clouds: 35, drawDistance: 7000, lodScale: 0.6 },
  medium: { maxPixelRatio: 1.5, shadows: false, clouds: 90, drawDistance: 10500, lodScale: 1 },
  high: { maxPixelRatio: 2, shadows: true, clouds: 150, drawDistance: 14000, lodScale: 1.5 },
};

/** Starting level before "auto" has measured anything. */
export function initialLevel(setting: GraphicsLevel, isTouch: boolean): QualityLevel {
  if (setting !== 'auto') return setting;
  return isTouch ? 'low' : 'medium';
}

/** Level for a measured average frame rate. */
export function levelForFps(fps: number): QualityLevel {
  if (fps >= 55) return 'high';
  if (fps >= 40) return 'medium';
  return 'low';
}

const WARMUP_S = 0.75;
const MEASURE_S = 5;

/** Feeds frame times for 5 seconds (after a short warm-up) and then reports a level once. */
export function createAutoQuality(onPick: (level: QualityLevel, fps: number) => void): { frame(dt: number): void } {
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
        onPick(levelForFps(fps), fps);
      }
    },
  };
}
