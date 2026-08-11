import type { CommodityType } from "@/lib/constants/commodities";
import type { Db } from "mongodb";
import { getMacroCountriesCollection } from "@/lib/db/collections/macroCountries";
import type { MacroMarketContribution } from "./types";

/**
 * Load the held market contributions for every seeded macro country.
 * These remain active between six-turn kernel refreshes.
 */
export async function loadActiveMacroContributions(db: Db): Promise<MacroMarketContribution[]> {
  const docs = await (
    await getMacroCountriesCollection(db)
  )
    .find({}, { projection: { contribution: 1 } })
    .toArray();
  return docs.map((doc) => doc.contribution).filter(Boolean);
}

/**
 * Apply held macro contributions into the shared global commodity balances.
 * Mutates `global` in place — the same map commodityPriceTurn prices from.
 */
export function applyMacroContributionsToGlobal(
  global: Map<CommodityType, { supply: number; demand: number }>,
  contributions: readonly MacroMarketContribution[]
): void {
  for (const contribution of contributions) {
    for (const [commodity, bal] of Object.entries(contribution.byCommodity) as [
      CommodityType,
      { supply: number; demand: number },
    ][]) {
      const target = global.get(commodity);
      if (!target) continue;
      target.supply += bal.supply;
      target.demand += bal.demand;
    }
  }
}
