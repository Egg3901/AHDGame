import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { GameState, NppAutonomyLevel } from "@/lib/db/types/gameState";
import { isCountryEnabledForPlayers } from "@/lib/countryAccess";

export type { NppAutonomyLevel };

/**
 * Canonical ordering of the autonomy levels. Exported so callers never hand-roll
 * a local copy (nppActionProcessing used to) and never compare with strict
 * equality — `level === "v3"` silently turns a v3+ feature OFF at v4, which is
 * exactly the bug class this export exists to prevent.
 */
export const NPP_AUTONOMY_LEVEL_RANK: Record<NppAutonomyLevel, number> = {
  off: 0,
  v0: 1,
  v1: 2,
  v2: 3,
  v3: 4,
  v4: 5,
};

const LEVEL_RANK = NPP_AUTONOMY_LEVEL_RANK;

/**
 * Pure rank comparison on an already-read level. Use this instead of `===`
 * whenever a feature means "at this tier and above".
 */
export function nppAutonomyLevelAtLeast(level: NppAutonomyLevel, min: NppAutonomyLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[min];
}

/**
 * Read the configured global NPP-autonomy level. Back-compat: a pre-level row
 * with the legacy boolean `nppAutonomyEnabled === true` reads as "v0".
 */
export async function getNppAutonomyLevel(db: Db): Promise<NppAutonomyLevel> {
  const doc = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { nppAutonomyLevel: 1, nppAutonomyEnabled: 1 } });
  if (doc?.nppAutonomyLevel) return doc.nppAutonomyLevel;
  return doc?.nppAutonomyEnabled === true ? "v0" : "off";
}

/** Global gate: is the smarter-NPP autonomy system switched on at all (any level)? */
export async function isNppAutonomyEnabled(db: Db): Promise<boolean> {
  return (await getNppAutonomyLevel(db)) !== "off";
}

/**
 * Effective autonomy level for a specific country, after applying the
 * player-enablement rail:
 *   - non-player countries: the configured level applies as-is (v0/v1/v2).
 *   - player-enabled countries: autonomy acts ONLY at the comingle tiers
 *     (v2 and above); below v2 it resolves to "off".
 *
 * New V1/V2 code should branch on this (or `nppAutonomyAtLeast`) rather than the
 * coarse `isNppAutonomyActive` boolean.
 */
export async function getNppAutonomyLevelForCountry(
  db: Db,
  countryId: CountryId
): Promise<NppAutonomyLevel> {
  const level = await getNppAutonomyLevel(db);
  if (level === "off") return "off";
  const enabledForPlayers = await isCountryEnabledForPlayers(db, countryId);
  if (!enabledForPlayers) return level;
  // Player-enabled country: only the comingle tiers (v2 and above) act here.
  return LEVEL_RANK[level] >= LEVEL_RANK.v2 ? level : "off";
}

/** Does the country's effective autonomy level meet `min`? (level-gated features) */
export async function nppAutonomyAtLeast(
  db: Db,
  countryId: CountryId,
  min: NppAutonomyLevel
): Promise<boolean> {
  const level = await getNppAutonomyLevelForCountry(db, countryId);
  return LEVEL_RANK[level] >= LEVEL_RANK[min];
}

/**
 * Legacy strict rail used by the v0 seating paths (central-bank chair, stalled
 * PM): true only when autonomy is enabled AND the country is NOT player-enabled.
 *
 * Deliberately does NOT extend into player countries at v2 — the v0 seating
 * logic predates the comingle design, so V2 behavior in player countries must be
 * driven by new code that opts in via `getNppAutonomyLevelForCountry`, not by
 * silently re-pointing these old call sites.
 */
export async function isNppAutonomyActive(db: Db, countryId: CountryId): Promise<boolean> {
  if (!(await isNppAutonomyEnabled(db))) return false;
  const enabledForPlayers = await isCountryEnabledForPlayers(db, countryId);
  return !enabledForPlayers;
}
