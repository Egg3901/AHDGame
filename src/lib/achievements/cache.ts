/**
 * Limited in-memory cache for achievement definitions and rarity stats.
 * TTL: 5 min for definitions, 2 min for rarity.
 * Invalidated on grant, revoke, bulk-grant, create, update.
 */
import type { Achievement } from "@/lib/db/types";

const DEFS_TTL_MS = 5 * 60 * 1000;
const RARITY_TTL_MS = 2 * 60 * 1000;

let definitionsCache: { data: Achievement[]; expiresAt: number } | null = null;
let rarityCache: { data: Map<string, number>; expiresAt: number } | null = null;

/** Get cached achievement definitions, or null if expired/missing. */
export function getCachedDefinitions(): Achievement[] | null {
  if (!definitionsCache || Date.now() > definitionsCache.expiresAt) return null;
  return definitionsCache.data;
}

/** Set cached achievement definitions. */
export function setCachedDefinitions(data: Achievement[]): void {
  definitionsCache = { data, expiresAt: Date.now() + DEFS_TTL_MS };
}

/** Invalidate definitions cache (call on create/update). */
export function invalidateDefinitionsCache(): void {
  definitionsCache = null;
}

/** Get cached rarity map (achievementId -> %), or null if expired/missing. */
export function getCachedRarity(): Map<string, number> | null {
  if (!rarityCache || Date.now() > rarityCache.expiresAt) return null;
  return rarityCache.data;
}

/** Set cached rarity map. */
export function setCachedRarity(data: Map<string, number>): void {
  rarityCache = { data, expiresAt: Date.now() + RARITY_TTL_MS };
}

/** Invalidate rarity cache (call on grant/revoke/bulk-grant). */
export function invalidateRarityCache(): void {
  rarityCache = null;
}

/** Invalidate all achievement caches. */
export function invalidateAllAchievementCaches(): void {
  invalidateDefinitionsCache();
  invalidateRarityCache();
}
