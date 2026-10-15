// The sun's direction (toward the sun), shared by the sky renderer and the IR seekers it can blind.
import { normalize, type Vec3 } from './math';

export const SUN_DIR: Vec3 = normalize([-0.45, 0.75, 0.48]);
