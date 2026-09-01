/**
 * Writes the annualized sector-subsidy cost line into the budget spending.byCategory
 * every turn. This keeps the figure current between fiscal-year resets.
 *
 * Cost formula: sum of (qualifying sector.revenue × TURNS_PER_YEAR) for each active subsidy,
 * grouped by the budget that owns the subsidy (national → federalBudget, state → stateBudgets).
 *
 * Currency semantics (v0.2.6):
 *   - Per-sector revenue is normalized to ₳ via the owning corp's FX before
 *     summation so corps in different home currencies weight consistently.
 *   - Budget money fields (`spending.*`, `revenue.*`, `surplus`) are stored in
 *     the owning country's currency, so `loadAnnualSubsidyCostMaps` re-denominates
 *     each subsidy's ₳ total to its country's currency before returning (#2825).
 *     The costs written here are therefore same-unit with the budget doc — no
 *     conversion happens in this file, and none may be added without removing
 *     the one in the loader (that WOULD double-convert).
 */

import type { Db } from "mongodb";
import type { FederalBudget, StateBudget } from "@/lib/db/types";
import {
  normalizeFederalSpending,
  normalizeStateSpending,
  SECTOR_SUBSIDIES_SPENDING_KEY,
} from "@/lib/budget/spending";
import { loadAnnualSubsidyCostMaps } from "@/lib/subsidies/subsidyBudgetCosts";
import { getRegisteredCountryIdSet } from "@/lib/country/registeredCountries";

export { SUBSIDY_COST_MULTIPLIER } from "@/lib/subsidies/subsidyBudgetCosts";

/**
 * Compute per-turn subsidy costs and write them to the budget documents.
 * Returns the number of budget documents updated.
 */
export async function processSubsidyBudget(db: Db): Promise<number> {
  const [{ nationalCostByBudgetId, stateCostByStateId }, allFederalBudgets, stateBudgets] =
    await Promise.all([
      loadAnnualSubsidyCostMaps(db),
      db.collection<FederalBudget>("federalBudget").find({}).toArray(),
      db.collection<StateBudget>("stateBudgets").find({}).toArray(),
    ]);

  // Dissolved countries keep their budget doc but must not be simulated against
  // it; see `getRegisteredCountryIdSet`.
  const liveCountries = await getRegisteredCountryIdSet(db);
  const federalBudgets = allFederalBudgets.filter((b) =>
    liveCountries.has(String(b.countryId ?? b._id))
  );

  const now = new Date();
  let updatedCount = 0;
  const writes: Promise<unknown>[] = [];

  for (const budget of federalBudgets) {
    const cost = nationalCostByBudgetId.get(budget._id) ?? 0;
    const spending = normalizeFederalSpending({
      ...budget.spending,
      byCategory: {
        ...(budget.spending?.byCategory ?? {}),
        [SECTOR_SUBSIDIES_SPENDING_KEY]: cost,
      },
    });
    const surplus = budget.revenue.total - spending.total;
    const currentCost = budget.spending?.byCategory?.[SECTOR_SUBSIDIES_SPENDING_KEY] ?? 0;
    if (
      currentCost === spending.byCategory[SECTOR_SUBSIDIES_SPENDING_KEY] &&
      budget.spending?.total === spending.total &&
      budget.surplus === surplus
    ) {
      continue;
    }

    writes.push(
      db
        .collection<FederalBudget>("federalBudget")
        .updateOne({ _id: budget._id }, { $set: { spending, surplus, updatedAt: now } })
        .then(() => {
          updatedCount++;
        })
    );
  }

  for (const budget of stateBudgets) {
    const cost = stateCostByStateId.get(budget._id) ?? 0;
    const spending = normalizeStateSpending({
      ...budget.spending,
      byCategory: {
        ...(budget.spending?.byCategory ?? {}),
        [SECTOR_SUBSIDIES_SPENDING_KEY]: cost,
      },
    });
    const balance = budget.revenue.total - spending.total;
    const currentCost = budget.spending?.byCategory?.[SECTOR_SUBSIDIES_SPENDING_KEY] ?? 0;
    if (
      currentCost === spending.byCategory[SECTOR_SUBSIDIES_SPENDING_KEY] &&
      budget.spending?.total === spending.total &&
      budget.surplus === balance &&
      budget.balance === balance
    ) {
      continue;
    }

    writes.push(
      db
        .collection<StateBudget>("stateBudgets")
        .updateOne(
          { _id: budget._id },
          { $set: { spending, surplus: balance, balance, updatedAt: now } }
        )
        .then(() => {
          updatedCount++;
        })
    );
  }

  await Promise.all(writes);
  return updatedCount;
}
