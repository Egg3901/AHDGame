/**
 * National-turn phase: recompute each country's State Ownership Concentration
 * Index (SOCI) from live corporate-sector revenue and persist it to the
 * federalBudget doc (rebalance 2026-06-24). Runs every turn for every country
 * (a country with no state-owned corp recomputes to 0), so SOCI tracks both
 * nationalizations and private-economy growth without artificial decay.
 */
import type { FederalBudget } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { getDb } from "@/lib/mongodb";
import { loadFxRatesByCurrency } from "@/lib/currency/corporationCapital";
import {
  computeCountryStateOwnershipConcentration,
  writeStateOwnershipConcentration,
} from "@/lib/nationalization/concentration";
import { logger } from "../observability/logger";

export async function processStateOwnershipConcentration(
  turn: number
): Promise<{ countriesUpdated: number }> {
  const db = await getDb();
  const budgets = await db
    .collection<FederalBudget>("federalBudget")
    .find({}, { projection: { countryId: 1 } })
    .toArray();

  const fx = await loadFxRatesByCurrency(db);
  // Each country's SOCI is independent — compute + write them concurrently
  // (bounded by the driver pool) instead of one country at a time. Per-country
  // isolation is preserved: a failure is caught and logged, never aborting the
  // others (each recomputes fresh next turn regardless). Scales with country
  // count toward the 30-50-country target.
  const outcomes = await Promise.all(
    budgets.map(async (b) => {
      const countryId = b.countryId as CountryId;
      try {
        const soci = await computeCountryStateOwnershipConcentration(db, countryId, fx);
        await writeStateOwnershipConcentration(db, countryId, soci, turn);
        return true;
      } catch (err) {
        logger.error("SOCI", `failed to recompute concentration for ${countryId}`, err);
        return false;
      }
    })
  );
  const countriesUpdated = outcomes.filter(Boolean).length;
  return { countriesUpdated };
}
