import type { Db } from "mongodb";
import type { StateMetrics } from "@/lib/db/types/stateMetrics";
import type { CountryId } from "@/lib/constants/countries";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import { getEraTrendGdpGrowth } from "@/lib/constants/monetaryEra";

/**
 * The country's national GDP growth rate.
 *
 * Source of truth is the national `macroMetrics` document. Measured at turn 364,
 * its value reproduces the GDP-WEIGHTED mean of regional `gdpGrowth` to three
 * significant figures for nine of ten countries (US 4.448 vs 4.45, BR 7.113 vs
 * 7.11, CN -4.498 vs -4.50). GDP-weighting is the only basis consistent with
 * metricEngine/phase.ts compounding each region's `state.gdp` by that region's
 * own rate, which is also what makes `state.gdp` the level SSOT.
 *
 * A POPULATION-weighted mean of the regions is a different, wrong number: the
 * region economy page used one and reported 6.56% for RU against the canonical
 * 5.14%, and 4.94% for BR against 7.11%.
 *
 * Countries with no national document fall back to the authored era trend, the
 * same fallback `interestRateSnapshot.ts` uses when it writes the central bank's
 * growth history, so the two agree instead of one landing on a flat 2.5.
 */
export async function loadNationalGdpGrowth(
  db: Db,
  countryId: CountryId,
  currentYear?: number
): Promise<number | null> {
  const nationalDocId = getNationalDocId(countryId);

  if (nationalDocId) {
    const doc = await db
      .collection<StateMetrics>("macroMetrics")
      .findOne({ _id: nationalDocId }, { projection: { "economic.gdpGrowth.value": 1 } });
    const value = doc?.economic?.gdpGrowth?.value;
    // `typeof`, not `??` or truthiness: a negative rate is real (CN reads
    // -5.382) and so is an exact 0.
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }

  return getEraTrendGdpGrowth(countryId, currentYear) ?? null;
}
