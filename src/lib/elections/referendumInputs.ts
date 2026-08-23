/**
 * National macro inputs for the economic referendum vote channel.
 *
 * Sourcing decisions (verified against the PRODUCERS, not the field names):
 *   • unemploymentRate / povertyRate / wageGrowth — the national-scope
 *     `macroMetrics` document (`getNationalDocId`), written by the metric
 *     engine phase (`src/lib/metricEngine/registry/economic.ts`). This is the
 *     same document `bargainingMacroInputs` reads for labour tightness.
 *   • inflationRate — `federalBudget.economicFactors.inflationRate`, written by
 *     the fiscal-year rollover (`src/lib/budget/fiscalYear.ts`) from the
 *     inflation model in `src/lib/budget/inflation.ts`. This is a RATE. A
 *     commodity price over its base price is a LEVEL and must never be used as
 *     an inflation proxy.
 *   • realIncomeTrendPct — `wageGrowth` (annual %) minus inflation, i.e. the
 *     real component of income growth. `wageGrowth` already carries a nominal
 *     inflation passthrough term, so subtracting inflation is what makes it a
 *     real trend.
 */

import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { StateMetrics } from "@/lib/db/types/stateMetrics";
import type { FederalBudget } from "@/lib/db/types";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import type { MiseryInputs } from "@/lib/electionEngine/economicReferendum";

/** Fallbacks when a country has no national metrics doc yet (neutral-ish). */
const FALLBACK_UNEMPLOYMENT = 6;
const FALLBACK_POVERTY = 20;
const FALLBACK_INFLATION = 2;

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Read the national misery inputs for `countryId`. Never throws; a country with
 * no national metrics document degrades to the neutral anchors, which price the
 * referendum at 0 rather than inventing a swing.
 */
export async function loadReferendumInputs(db: Db, countryId: CountryId): Promise<MiseryInputs> {
  const nationalDocId = getNationalDocId(countryId);
  const [metrics, budget] = await Promise.all([
    nationalDocId
      ? db.collection<StateMetrics>("macroMetrics").findOne(
          { _id: nationalDocId },
          {
            projection: {
              "economic.unemploymentRate": 1,
              "economic.povertyRate": 1,
              "economic.wageGrowth": 1,
            },
          }
        )
      : null,
    db
      .collection<FederalBudget>("federalBudget")
      .findOne(
        { _id: getNationalBudgetId(countryId) as FederalBudget["_id"] },
        { projection: { economicFactors: 1 } }
      ),
  ]);

  const inflationRate = num(budget?.economicFactors?.inflationRate, FALLBACK_INFLATION);
  const wageGrowth = metrics?.economic?.wageGrowth?.value;
  const realIncomeTrendPct =
    typeof wageGrowth === "number" && Number.isFinite(wageGrowth)
      ? wageGrowth - inflationRate
      : undefined;

  return {
    unemploymentRate: num(metrics?.economic?.unemploymentRate?.value, FALLBACK_UNEMPLOYMENT),
    povertyRate: num(metrics?.economic?.povertyRate?.value, FALLBACK_POVERTY),
    inflationRate,
    ...(realIncomeTrendPct !== undefined && { realIncomeTrendPct }),
  };
}
