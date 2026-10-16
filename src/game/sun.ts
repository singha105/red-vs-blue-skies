// The sun's direction (toward the sun), shared by the sky renderer and the IR seekers it can blind. Each map has
// its own sun (maps.json); SUN_DIR is Island Chain's, the default for code that has no map.
import type { GameMap } from '../data/types';
import { normalize, type Vec3 } from './math';

export const SUN_DIR: Vec3 = normalize([-0.45, 0.75, 0.48]);

/** Toward the sun for a map: azimuth clockwise from north (+Z, with +X to the west), elevation above the horizon. */
export function sunDirFor(map: Pick<GameMap, 'sun'>): Vec3 {
  const az = (map.sun.azimuthDeg * Math.PI) / 180;
  const el = (map.sun.elevationDeg * Math.PI) / 180;
  return normalize([-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)]);
}
