import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Union } from "@/lib/db/types";
import { UNIONIZATION_BAN_DECAY_STEP_PER_TURN } from "@/lib/labour/unionization";
import { undergroundStrength } from "./underground";

/** Cells cannot create more than low, informal workplace density under a ban. */
export const UNDERGROUND_DENSITY_CAP = 35;
/** A legal sector can move 1.5 density points per turn; cells can move at most 0.6. */
export const UNDERGROUND_DENSITY_GAIN_PER_TURN = 0.6;
/** Above this shadow strength, coordinated absenteeism starts reducing output. */
export const UNDERGROUND_SLOWDOWN_THRESHOLD = 15;
/** The strongest cell can remove at most 8% of output, far below a legal strike. */
export const UNDERGROUND_SLOWDOWN_MAX = 0.08;

export function undergroundSectorKey(countryId: string, sectorType: string): string {
  return `${countryId}:${sectorType}`;
}

/** Use the strongest cell, rather than summing rivals, so founding more unions cannot multiply unrest. */
export async function loadUndergroundStrengthByCountrySector(
  db: Db,
  bannedCountryIds: ReadonlySet<string>
): Promise<Map<string, number>> {
  if (bannedCountryIds.size === 0) return new Map();
  const unions = await db
    .collection<Union>("unions")
    .find(
      {
        countryId: { $in: Array.from(bannedCountryIds) as CountryId[] },
        undergroundStrength: { $gt: 0 },
      },
      { projection: { countryId: 1, sectorType: 1, undergroundStrength: 1 } }
    )
    .toArray();
  const result = new Map<string, number>();
  for (const union of unions) {
    if (!bannedCountryIds.has(union.countryId)) continue;
    const key = undergroundSectorKey(union.countryId, union.sectorType);
    result.set(key, Math.max(result.get(key) ?? 0, undergroundStrength(union)));
  }
  return result;
}

/** Shadow organization keeps informal sentiment alive but cannot hold a shop openly. */
export function undergroundDensityAfterBanTurn(current: number, strength: number): number {
  const density = Math.max(0, Math.min(100, Number.isFinite(current) ? current : 0));
  const safeStrength = Number.isFinite(strength) ? Math.max(0, strength) : 0;
  const target = Math.min(UNDERGROUND_DENSITY_CAP, safeStrength * 0.7);
  if (density > target)
    return Math.round(Math.max(target, density - UNIONIZATION_BAN_DECAY_STEP_PER_TURN) * 10) / 10;
  return Math.round(Math.min(target, density + UNDERGROUND_DENSITY_GAIN_PER_TURN) * 10) / 10;
}

/** A capped, passive slowdown. Never enters the legal strike state machine. */
export function undergroundOutputFactor(strength: number): number {
  const safe = Number.isFinite(strength) ? Math.max(0, strength) : 0;
  const excess = Math.max(0, safe - UNDERGROUND_SLOWDOWN_THRESHOLD);
  return 1 - Math.min(UNDERGROUND_SLOWDOWN_MAX, excess * 0.004);
}

/** Country-level resistance for a general strike, bounded against one extreme cell. */
export async function countryUndergroundIntensity(db: Db, countryId: CountryId): Promise<number> {
  const strength = await loadUndergroundStrengthByCountrySector(db, new Set([countryId]));
  return Math.min(1, Math.max(0, ...strength.values()) / UNDERGROUND_DENSITY_CAP);
}
