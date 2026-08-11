/**
 * Projects the country's next-quarter sovereign bond issuance need.
 *
 * Issuance = rollover (maturing bonds in the next interval) + deficit financing
 * (quarter-slice of the annual deficit). Mirrors the pipeline in
 * `bonds/sovereign.ts::issueScheduledSovereignBondSeries`.
 *
 * Returns 0 if the country has no federalBudget — caller treats 0 as "no
 * issuance need" which makes the entity-contribution ratio undefined; the
 * caller (snapshotLoader / marketDemand) handles divide-by-zero by returning
 * 0 contribution.
 */

import type { Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { FederalBudget } from "@/lib/db/types/budget";
import {
  calculateQuarterlyIssuanceAmount,
  calculateSovereignRolloverAmount,
  getNationalBudgetId,
} from "@/lib/bonds/sovereign";

export async function computeRequiredIssuance(
  db: Db,
  countryCode: string,
  turn: number
): Promise<number> {
  // Reject country codes not in COUNTRY_CONFIGS so getNationalBudgetId
  // doesn't crash on an unknown id. Treats unknown codes as zero issuance.
  if (!COUNTRY_CONFIGS[countryCode as CountryId]) return 0;

  const budgetId = getNationalBudgetId(countryCode as CountryId);
  const budget = await db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId });
  if (!budget) return 0;

  const annualDeficit = Math.max(0, -(budget.surplus ?? 0));
  const deficitAmount = calculateQuarterlyIssuanceAmount(annualDeficit);
  const rolloverAmount = await calculateSovereignRolloverAmount(db, countryCode as CountryId, turn);
  return deficitAmount + rolloverAmount;
}
