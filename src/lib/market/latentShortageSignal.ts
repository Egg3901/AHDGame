/**
 * Hidden market shortages. latentAwarePriceRatio restores demand omitted by
 * the ledger cap when bots and players judge whether more capacity can sell.
 * It does not alter prices, clearing, margins, or existing plants.
 */

import {
  COMMODITY_BASE_PRICES,
  computeMarketPrice,
  getPriceSoftKnee,
  type CommodityType,
} from "@/lib/constants/commodities";
import type { CommodityPrice } from "@/lib/db/types/commodityPrice";

const finitePositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/**
 * Share of globally-truncated demand attributable to one scope, pro-rata by
 * capped demand share. The cap pass scales every state's demand by one
 * per-commodity factor, so capped shares equal true shares and the truncated
 * units split the same way. Returns 0 unless there is something to attribute.
 */
export function latentDemandTopUp(
  scopeCappedDemand: number,
  globalCappedDemand: number,
  truncatedUnits: number | null | undefined
): number {
  if (!finitePositive(truncatedUnits)) return 0;
  if (!finitePositive(scopeCappedDemand) || !finitePositive(globalCappedDemand)) return 0;
  return truncatedUnits * (scopeCappedDemand / globalCappedDemand);
}

export interface LatentLiftInput {
  /** The signal value today (a price-over-base ratio); returned as-is when there is no lift. */
  storedRatio: number | null;
  commodity: CommodityType;
  /** Supply at the scope the stored ratio describes. */
  supply: number;
  /** Capped demand at that scope. */
  cappedDemand: number;
  /** Global capped demand, for pro-rata attribution. */
  globalCappedDemand: number;
  /** Global truncated units for the commodity. */
  truncatedUnits: number | null | undefined;
}

/**
 * Latent-aware price-over-base ratio for BUILD signals only.
 *
 * Recomputes the market price from uncapped demand
 * (`cappedDemand + pro-rata truncated share`) through the same
 * `computeMarketPrice` curve the turn uses, and returns the stronger of the
 * stored and recomputed ratios. `max` (never min) is the whole contract:
 * drift, scarcity memory, pegs and nudges baked into the stored price are
 * preserved, and the hidden shortage can only strengthen the signal, never
 * weaken it. Returns `storedRatio` untouched when there is nothing to lift.
 */
export function latentAwarePriceRatio(input: LatentLiftInput): number | null {
  const topUp = latentDemandTopUp(
    input.cappedDemand,
    input.globalCappedDemand,
    input.truncatedUnits
  );
  if (!(topUp > 0)) return input.storedRatio;
  if (!finitePositive(input.supply)) return input.storedRatio;
  const basePrice = COMMODITY_BASE_PRICES[input.commodity];
  if (!finitePositive(basePrice)) return input.storedRatio;
  const recomputed =
    computeMarketPrice(
      basePrice,
      input.supply,
      input.cappedDemand + topUp,
      getPriceSoftKnee(input.commodity)
    ) / basePrice;
  if (!Number.isFinite(recomputed)) return input.storedRatio;
  if (typeof input.storedRatio !== "number" || !Number.isFinite(input.storedRatio)) {
    return recomputed;
  }
  return Math.max(input.storedRatio, recomputed);
}

const storedRatioOf = (price: number | null | undefined, basePrice: number): number | null =>
  finitePositive(price) ? price / basePrice : null;

/**
 * Country-scope latent-aware ratio for one price doc. Supply/demand read the
 * persisted national aggregates (falling back to the global book when a
 * country has no row); the reachable-market price has no persisted S/D on the
 * doc, so callers evaluating a reachable price pass it as `storedOverride`
 * and the national book still supplies the lift basis.
 */
export function latentAwareNationalRatio(
  doc: CommodityPrice,
  countryId: string,
  storedOverride?: number | null
): number | null {
  const basePrice = doc.basePrice;
  if (!finitePositive(basePrice)) return storedOverride ?? null;
  const stored =
    storedOverride ?? storedRatioOf(doc.nationalPrices?.[countryId] ?? doc.globalPrice, basePrice);
  return latentAwarePriceRatio({
    storedRatio: stored,
    commodity: doc.commodity,
    supply: doc.nationalSupply?.[countryId] ?? doc.globalSupply,
    cappedDemand: doc.nationalDemand?.[countryId] ?? doc.globalDemand,
    globalCappedDemand: doc.globalDemand,
    truncatedUnits: doc.demandTruncatedUnits,
  });
}

/** Global-scope latent-aware ratio (the worldwide book needs no attribution). */
export function latentAwareGlobalRatio(doc: CommodityPrice): number | null {
  if (!finitePositive(doc.basePrice)) return null;
  return latentAwarePriceRatio({
    storedRatio: storedRatioOf(doc.globalPrice, doc.basePrice),
    commodity: doc.commodity,
    supply: doc.globalSupply,
    cappedDemand: doc.globalDemand,
    globalCappedDemand: doc.globalDemand,
    truncatedUnits: doc.demandTruncatedUnits,
  });
}

/** State-scope latent-aware ratio from the persisted state books. */
export function latentAwareStateRatio(
  doc: CommodityPrice,
  stateId: string,
  storedOverride?: number | null
): number | null {
  const basePrice = doc.basePrice;
  if (!finitePositive(basePrice)) return storedOverride ?? null;
  const stored = storedOverride ?? storedRatioOf(doc.statePrices?.[stateId], basePrice);
  return latentAwarePriceRatio({
    storedRatio: stored,
    commodity: doc.commodity,
    supply: doc.stateSupply?.[stateId] ?? 0,
    cappedDemand: doc.stateDemand?.[stateId] ?? 0,
    globalCappedDemand: doc.globalDemand,
    truncatedUnits: doc.demandTruncatedUnits,
  });
}

/** Demand top-up for a country's reachable/global advisor gap leg. */
export function latentTopUpForCountry(
  doc: Pick<CommodityPrice, "globalDemand" | "nationalDemand" | "demandTruncatedUnits">,
  countryId: string
): number {
  return latentDemandTopUp(
    doc.nationalDemand?.[countryId] ?? doc.globalDemand,
    doc.globalDemand,
    doc.demandTruncatedUnits
  );
}

/** Demand top-up for a state's advisor gap leg. */
export function latentTopUpForState(
  doc: Pick<CommodityPrice, "globalDemand" | "stateDemand" | "demandTruncatedUnits">,
  stateId: string
): number {
  return latentDemandTopUp(
    doc.stateDemand?.[stateId] ?? 0,
    doc.globalDemand,
    doc.demandTruncatedUnits
  );
}
