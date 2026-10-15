// Unlock trees and spawn costs. Research points (RP) are spent per era, tiers in order; tier 1 is free.
// The profile (src/profile) stores the highest unlocked tier per era; the Firestore rules check the same rules.
import { ERA_IDS, type EraId, type Plane } from '../data/types';

export const MAX_TIER = 10;

/** Highest unlocked tier per era. */
export type UnlockMap = Record<EraId, number>;

/** Everything open: only the debug build on localhost (env.allUnlocked). */
export type Unlocks = UnlockMap | 'all';

export const freshUnlocks = (): UnlockMap => Object.fromEntries(ERA_IDS.map((e) => [e, 1])) as UnlockMap;

/** Untrusted input (network, storage, Firestore) → a valid map: whole tiers 1–10, missing eras at 1. */
export function cleanUnlocks(raw: unknown): UnlockMap {
  const out = freshUnlocks();
  if (raw && typeof raw === 'object') {
    for (const era of ERA_IDS) {
      const v = (raw as Record<string, unknown>)[era];
      if (typeof v === 'number' && Number.isFinite(v)) out[era] = Math.max(1, Math.min(MAX_TIER, Math.floor(v)));
    }
  }
  return out;
}

export const tierOpen = (unlocks: Unlocks, era: EraId, tier: number): boolean => unlocks === 'all' || tier <= unlocks[era];

export const isUnlocked = (plane: Plane, unlocks: Unlocks): boolean => tierOpen(unlocks, plane.era, plane.tier);

/** GAME_DESIGN: unlocking tier N costs 200 × N RP; tier 1 is free. */
export const unlockCost = (tier: number): number => (tier <= 1 ? 0 : 200 * tier);

export type UnlockCheck = 'ok' | 'owned' | 'order' | 'rp';

/** Can a player with `rp` and `unlocked` buy this tier now? Only the next tier in an era, with enough RP. */
export function canUnlock(rp: number, unlocked: UnlockMap, era: EraId, tier: number): UnlockCheck {
  if (tier <= unlocked[era]) return 'owned';
  if (tier !== unlocked[era] + 1) return 'order';
  return rp >= unlockCost(tier) ? 'ok' : 'rp';
}

/** RP already spent on unlocks. */
export const spentRp = (unlocked: UnlockMap): number =>
  ERA_IDS.reduce((sum, era) => {
    let s = 0;
    for (let t = 2; t <= unlocked[era]; t++) s += unlockCost(t);
    return sum + s;
  }, 0);

/** Everything a player has earned (balance + spent): what team balancing compares, so buying a plane doesn't
 * make a veteran look like a beginner. */
export const earnedRp = (rp: number, unlocked: UnlockMap): number => rp + spentRp(unlocked);

/** Spawn points: the first spawn is free, later ones cost 100 + 50 × tier. */
export const spawnCost = (tier: number): number => 100 + 50 * tier;
export const SP_KILL = 100;
export const SP_ASSIST = 40;
export const SP_CAPTURE = 50;
