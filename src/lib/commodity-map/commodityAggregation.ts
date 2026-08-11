/**
 * Aggregation logic for rolling state-level commodity data up to country level.
 *
 * Prices are aggregated as a simple average (since different states have
 * different economic profiles, and commodity supply/demand-weighted average
 * would require additional context). Supply and demand sum directly.
 *
 * Country avg price uses the same three-leg blend as state prices but collapses
 * the regional leg into national (50% global + 50% national), since at the
 * country-aggregate scale state-level conditions have already been rolled up.
 */

import type { CountryId } from "@/lib/constants/countries";
import { blendPrice, computeMarketPrice } from "@/lib/constants/commodities";

export interface CountryCommodityData {
  countryId: CountryId;
  supply: number;
  demand: number;
  balance: number;
  /** Simple average of state-level prices. Null if no state prices exist. */
  avgPrice: number | null;
  /** Number of states with data in this country */
  stateCount: number;
}

/**
 * Aggregate state-level supply, demand, and prices into country-level totals.
 *
 * When `nationalSupply` / `nationalDemand` are passed, they are treated as
 * authoritative (they come from cp.nationalSupply / cp.nationalDemand on the
 * CommodityPrice doc, which includes federal demand injected after the
 * state→country rollup — e.g. govt healthcare). The state-sum path remains as
 * a fallback for countries missing from the authoritative maps.
 */
export function aggregateByCountry(
  stateSupply: Record<string, number>,
  stateDemand: Record<string, number>,
  _statePrices: Record<string, number>,
  stateCountryMap: Map<string, CountryId>,
  basePrice: number,
  globalPrice: number,
  nationalSupply?: Record<string, number>,
  nationalDemand?: Record<string, number>
): Record<CountryId, CountryCommodityData> {
  const acc: Record<string, { supply: number; demand: number; count: number }> = {};

  for (const [stateId, country] of stateCountryMap) {
    if (!country) continue;
    if (!acc[country]) {
      acc[country] = { supply: 0, demand: 0, count: 0 };
    }
    acc[country].supply += stateSupply[stateId] ?? 0;
    acc[country].demand += stateDemand[stateId] ?? 0;
    acc[country].count++;
  }

  const result: Record<string, CountryCommodityData> = {};
  for (const [countryId, data] of Object.entries(acc)) {
    const authSupply = nationalSupply?.[countryId];
    const authDemand = nationalDemand?.[countryId];
    const useAuthoritative = authSupply !== undefined || authDemand !== undefined;
    const supply = useAuthoritative ? (authSupply ?? 0) : data.supply;
    const demand = useAuthoritative ? (authDemand ?? 0) : data.demand;
    const countryRawPrice = computeMarketPrice(basePrice, supply, demand);
    // Country-level rollup: collapse the regional leg into national so the blend
    // becomes 50% global + 50% national (state detail is already aggregated).
    const avgPrice = blendPrice(globalPrice, countryRawPrice, countryRawPrice);
    result[countryId] = {
      countryId: countryId as CountryId,
      supply,
      demand,
      balance: supply - demand,
      avgPrice,
      stateCount: data.count,
    };
  }

  return result as Record<CountryId, CountryCommodityData>;
}

/**
 * Find the maximum absolute value for a given metric across all countries.
 * Used for normalizing color scale.
 */
export function getMaxValue(
  countryData: Record<string, CountryCommodityData>,
  mode: "supply" | "demand"
): number {
  let max = 0;
  for (const data of Object.values(countryData)) {
    const val = mode === "supply" ? data.supply : data.demand;
    if (val > max) max = val;
  }
  return max;
}

/**
 * Find the maximum absolute percentage deviation from base price across countries.
 * Used for normalizing price color scales.
 */
export function getMaxPriceDeviation(
  countryData: Record<string, CountryCommodityData>,
  basePrice: number
): number {
  if (basePrice <= 0) return 0;
  const deviations: number[] = [];
  for (const data of Object.values(countryData)) {
    if (data.avgPrice == null) continue;
    deviations.push(Math.abs(((data.avgPrice - basePrice) / basePrice) * 100));
  }
  if (deviations.length === 0) return 0;

  deviations.sort((a, b) => a - b);
  // Use a high percentile rather than the absolute max so one or two extreme
  // markets do not flatten the rest of the map into the neutral band.
  const percentileIndex = Math.min(
    deviations.length - 1,
    Math.max(0, Math.ceil(deviations.length * 0.9) - 1)
  );
  return deviations[percentileIndex];
}
