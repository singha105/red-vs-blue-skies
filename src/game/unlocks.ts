// Unlock stub until Day 8 brings research points: tiers 1–3 of every era are open (everything with ?debug=1).
import type { Plane } from '../data/types';

export const OPEN_TIERS = 3;

export const isUnlocked = (plane: Plane, allUnlocked: boolean): boolean => allUnlocked || plane.tier <= OPEN_TIERS;

/** What unlocking a tier will cost once RP exists (GAME_DESIGN: 200 × tier, tier 1 free). */
export const unlockCost = (tier: number): number => (tier <= 1 ? 0 : 200 * tier);

/** Spawn points: the first spawn is free, later ones cost 100 + 50 × tier. */
export const spawnCost = (tier: number): number => 100 + 50 * tier;
export const SP_KILL = 100;
export const SP_ASSIST = 40;
export const SP_CAPTURE = 50;
