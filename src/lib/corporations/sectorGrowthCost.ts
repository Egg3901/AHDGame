import type { Db } from "mongodb";
import type { CentralBank } from "@/lib/db/types";
import { calculateDailyGrowthCost, GROWTH_RATE_TURNS_PER_YEAR } from "@/lib/constants/corporations";
import { getCountryConfig } from "@/lib/constants/countries";
import { getBankId } from "@/lib/centralBank/helpers";
import type { CountryId } from "@/lib/constants/countries";
import { NEUTRAL_STAT } from "@/lib/stats/statsConstants";

/**
 * Pure growth-cost calculation for a sector. `growthRatePct` is the growth rate
 * **per game year** (48 turns); the return value is the *daily* (24-turn) cost of
 * holding that rate, which is what callers divide by `TURNS_PER_DAY` to charge
 * per turn. Mirrors the inline math previously in setSectorGrowth.ts.
 * `acumen` is the CEO's Business Acumen stat (defaults to neutral): a skilled CEO
 * grows more cheaply and absorbs less of a high prime rate.
 */
export function growthCostFor(
  revenue: number,
  growthRatePct: number,
  primeRate: number,
  marketSharePercent: number,
  acumen: number = NEUTRAL_STAT,
  /** Sector tech-tree growth-cost multiplier (1 = none); keeps preview == turn. */
  techGrowthCostMultiplier: number = 1
): number {
  const perTurnGrowthRate = growthRatePct / GROWTH_RATE_TURNS_PER_YEAR;
  return (
    calculateDailyGrowthCost(revenue, perTurnGrowthRate, primeRate, marketSharePercent, acumen) *
    techGrowthCostMultiplier
  );
}

/**
 * Resolve a country's prime rate, falling back to its configured default. Used
 * once per bulk action so a whole sector type shares a single lookup.
 */
export async function resolveCountryPrimeRate(db: Db, countryId: CountryId): Promise<number> {
  // getBankId: shared-bank members (IE → ECB) have no doc under their own id.
  const centralBank = await db
    .collection<CentralBank>("centralBanks")
    .findOne({ _id: getBankId(countryId) });
  return centralBank?.primeRate ?? getCountryConfig(countryId).centralBank.defaultPrimeRate;
}
