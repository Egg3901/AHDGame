/**
 * Mirror trade growth from FederalBudget to CentralBank.
 *
 * The forex phase reads all macro indicators from centralBanks to avoid
 * multi-collection reads during rate computation. This mirror copies
 * FederalBudget.economicFactors.tradeGrowth -> CentralBank.tradeGrowth
 * once per turn during national aggregation (Group 12).
 *
 * **Currency (v0.2.6):** `tradeGrowth` is a percentage -- unit-agnostic -- so the
 * per-country mirror copies the value verbatim. Both sides of the copy live in
 * the same country's namespace (federal budget <-> central bank), so no FX
 * conversion is required even though the budget is denominated in country
 * currency.
 *
 * See docs/design/currency-exchange.md "CentralBank Schema Addition".
 */

import type { Db } from "mongodb";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { CentralBank } from "@/lib/db/types/centralBank";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { FOREX_ACTIVE_COUNTRIES } from "@/lib/constants/currencies";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";

export interface TradeGrowthMirrorResult {
  countriesUpdated: number;
}

/**
 * For each forex-active country, read tradeGrowth from the federal budget
 * and write it to the central bank document.
 *
 * If no budget is found for a country, tradeGrowth defaults to 0 (neutral).
 */
export async function mirrorTradeGrowth(db: Db): Promise<TradeGrowthMirrorResult> {
  // Build budget IDs for all forex-active countries
  const budgetIdSet = new Set<string>();
  for (const countryId of FOREX_ACTIVE_COUNTRIES) {
    const config = COUNTRY_CONFIGS[countryId];
    if (!config) continue;
    const budgetId = getNationalBudgetId(countryId);
    budgetIdSet.add(budgetId);
  }

  // Batch-fetch all relevant budgets
  const budgets =
    budgetIdSet.size > 0
      ? await db
          .collection<FederalBudget>("federalBudget")
          .find(
            { _id: { $in: Array.from(budgetIdSet) } },
            { projection: { "economicFactors.tradeGrowth": 1 } }
          )
          .toArray()
      : [];
  const budgetById = new Map(budgets.map((b) => [b._id.toString(), b]));

  const bulkOps: Array<{
    updateOne: {
      filter: { _id: string };
      update: { $set: { tradeGrowth: number; updatedAt: Date } };
    };
  }> = [];

  for (const countryId of FOREX_ACTIVE_COUNTRIES) {
    const config = COUNTRY_CONFIGS[countryId];
    if (!config) continue;

    const budgetId = getNationalBudgetId(countryId);
    const budget = budgetById.get(budgetId);
    const tradeGrowth = budget?.economicFactors?.tradeGrowth ?? 0;

    bulkOps.push({
      updateOne: {
        filter: { _id: countryId },
        update: { $set: { tradeGrowth, updatedAt: new Date() } },
      },
    });
  }

  if (bulkOps.length > 0) {
    await db.collection<CentralBank>("centralBanks").bulkWrite(bulkOps as never);
  }

  return { countriesUpdated: bulkOps.length };
}
