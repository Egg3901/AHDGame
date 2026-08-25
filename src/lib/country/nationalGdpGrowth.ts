import type { Db } from "mongodb";
import type { State } from "@/lib/db/types";
import type { StateMetrics } from "@/lib/db/types/stateMetrics";
import type { CountryId } from "@/lib/constants/countries";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import { getEraTrendGdpGrowth } from "@/lib/constants/monetaryEra";

/**
 * GDP-weighted mean of regional growth rates. Null when nothing is weightable.
 *
 * GDP is the correct weight, not population: `metricEngine/phase.ts` compounds
 * each region's `state.gdp` by that region's OWN rate, so the growth of the
 * national total is the GDP-weighted mean by construction. Weighting by
 * population answers a different question and gives a different number (RU read
 * 6.56% population-weighted against 5.14% canonical at turn 364).
 */
export function gdpWeightedGrowth(rows: Array<{ growth?: number; gdp: number }>): number | null {
  let weighted = 0;
  let totalGdp = 0;

  for (const row of rows) {
    if (typeof row.growth !== "number" || !Number.isFinite(row.growth)) continue;
    if (!Number.isFinite(row.gdp) || row.gdp <= 0) continue;
    weighted += row.growth * row.gdp;
    totalGdp += row.gdp;
  }

  return totalGdp > 0 ? weighted / totalGdp : null;
}

/**
 * Default when a country has neither a national metrics doc nor a single
 * weightable region. Matches the long-standing `fiscalYear.ts` constant.
 */
const NEUTRAL_PIPELINE_GDP_GROWTH = 2.5;

/**
 * Resolve the growth rate the annual fiscal pass records on the budget, from
 * data the caller has already loaded. Pure, so the selection rule is testable
 * without standing up a whole fiscal-year pass.
 *
 * Same order as {@link loadNationalGdpGrowth}: national doc, then the
 * GDP-weighted regional mean, then a neutral default. The middle step is the
 * one that matters - without it the 17 countries with no national doc recorded
 * a flat +2.5% while several were contracting 6-9%.
 */
export function resolvePipelineGdpGrowth(input: {
  nationalDocGrowth?: number;
  regions: Array<{ growth?: number; gdp: number }>;
}): number {
  const national = input.nationalDocGrowth;
  // `typeof`, not `??` or truthiness: a negative rate is real and so is 0.
  if (typeof national === "number" && Number.isFinite(national)) return national;
  return gdpWeightedGrowth(input.regions) ?? NEUTRAL_PIPELINE_GDP_GROWTH;
}

/**
 * The country's national GDP growth rate, in percent.
 *
 * Resolution order, all three producing the same quantity:
 *
 *   1. The national `macroMetrics` document. Verified at turn 369 to reproduce
 *      the GDP-weighted regional mean to three decimals for all ten countries
 *      that have one, so this is a cache of step 2 rather than a rival figure.
 *   2. The GDP-weighted mean of the country's own regions, for the 17 countries
 *      that have no national document.
 *   3. The authored era trend, only when no region carries a growth metric at
 *      all (an unseeded or pre-reconciliation world).
 *
 * Step 2 is load-bearing and was NOT in the original plan. Falling straight from
 * step 1 to step 3 looked reasonable but is badly wrong on the live world: those
 * 17 economies are mostly contracting (CS -8.9%, HU -7.4%, RO -6.9%) while their
 * era trends read +3.5% to +6.5%. The era trend is an authored starting
 * assumption, not a live measurement, so it must never stand in for regions that
 * are right there and can be measured.
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
    // -4.867) and so is an exact 0.
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }

  const states = await db
    .collection<State>("states")
    .find({ countryId })
    .project<{ _id: string; gdp?: number }>({ gdp: 1 })
    .toArray();

  if (states.length > 0) {
    const metrics = await db
      .collection<StateMetrics>("macroMetrics")
      .find({ _id: { $in: states.map((s) => s._id) } })
      .project<{ _id: string; economic?: { gdpGrowth?: { value?: number } } }>({
        "economic.gdpGrowth.value": 1,
      })
      .toArray();

    const gdpByStateId = new Map(states.map((s) => [s._id, s.gdp ?? 0]));
    const derived = gdpWeightedGrowth(
      metrics.map((m) => ({
        growth: m.economic?.gdpGrowth?.value,
        gdp: gdpByStateId.get(m._id) ?? 0,
      }))
    );
    if (derived !== null) return derived;
  }

  return getEraTrendGdpGrowth(countryId, currentYear) ?? null;
}
