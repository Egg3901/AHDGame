/**
 * Delivered advertising value per selling corporation, on the anchor basis.
 *
 * Marketing settlement pays advertising sellers for what they actually
 * delivered, so it needs the same units the clearing pass settled: offers
 * normalized against the lagged supply book, multiplied by the sold fraction,
 * priced at the clearing price the buyer faced.
 *
 * This lives in its own module rather than inline in the corporation turn
 * because it is the only part of that pass with real arithmetic in it, and
 * inline it was unreachable from any test: a missing import survived review
 * here and would have thrown in production on every clearing-enabled world.
 */
import type { CountryId } from "@/lib/constants/countries";
import { TURNS_PER_DAY } from "@/lib/constants/corporations";
import { priceRealizationFactor } from "@/lib/market/priceRealization";
import { qualityPremiumMultiplier } from "@/lib/market/clearing";

export interface AdvertisingOfferInput {
  sectorId: string;
  /** Supply rates for the selling sector, keyed by commodity. */
  supplyRates: Partial<Record<string, number>>;
  /** Sector revenue on its own basis, used when no measured output exists. */
  revenue: number;
  /** Measured physical output under plants, when present. */
  producedUnits?: number | null;
  outputQuality?: number | null;
}

export interface AdvertisingDeliveredValueArgs {
  inputs: readonly AdvertisingOfferInput[];
  /** Era-scaled base prices; only `advertising` is read. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clearingBasePrices: { advertising: number } & Record<string, any>;
  plantsEnabled: boolean;
  /** Clearing group (country) per sector; "" means the global book. */
  clearingGroupBySector?: Map<string, string>;
  /** Sold fraction and posture per selling sector. */
  clearingBySectorId?: ReadonlyMap<
    string,
    {
      readonly soldByCommodity?: Partial<Record<string, number>>;
      readonly effectivePosture?: number;
    }
  >;
  /** Lagged supply per country book, then the global book as fallback. */
  countryClearingBooks?: ReadonlyMap<CountryId, ReadonlyMap<string, { supply: number }>> | null;
  globalCommodityBalances: ReadonlyMap<string, { supply: number }>;
  reachablePriceRatioByCountry?: ReadonlyMap<string, ReadonlyMap<string, number>> | null;
  priceRatioByCommodity: ReadonlyMap<string, number>;
  sectorCorpId: ReadonlyMap<string, string>;
  /** Weight of advertising in a multi-commodity output mix. */
  // Typed loosely on purpose: the turn passes the engine's fully-keyed record
  // and its own mix helper, and this module only ever reads the advertising leg.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  commodityMixWeight: (rates: any, basePrices: any, commodity: "advertising") => number;
  qualityPremiumPricingEnabled: boolean;
}

export function advertisingDeliveredValueByCorp(
  args: AdvertisingDeliveredValueArgs
): Map<string, number> {
  const {
    inputs,
    clearingBasePrices,
    plantsEnabled,
    clearingGroupBySector,
    clearingBySectorId,
    countryClearingBooks,
    globalCommodityBalances,
    reachablePriceRatioByCountry,
    priceRatioByCommodity,
    sectorCorpId,
    commodityMixWeight,
    qualityPremiumPricingEnabled,
  } = args;

  const deliveredByCorpId = new Map<string, number>();

  const offers = inputs.flatMap((input) => {
    const rate = input.supplyRates.advertising ?? 0;
    if (!(rate > 0)) return [];
    const realUnits =
      plantsEnabled && typeof input.producedUnits === "number"
        ? input.producedUnits *
          commodityMixWeight(input.supplyRates, clearingBasePrices, "advertising")
        : null;
    const units = realUnits ?? (input.revenue * rate) / clearingBasePrices.advertising;
    if (!(units > 0)) return [];
    return [
      {
        input,
        units,
        real: realUnits !== null,
        group: clearingGroupBySector?.get(input.sectorId) ?? "",
      },
    ];
  });

  const offerTotalsByGroup = new Map<string, { normalizable: number; exemptReal: number }>();
  for (const offer of offers) {
    const totals = offerTotalsByGroup.get(offer.group) ?? { normalizable: 0, exemptReal: 0 };
    if (offer.real) totals.exemptReal += offer.units;
    else totals.normalizable += offer.units;
    offerTotalsByGroup.set(offer.group, totals);
  }

  const normalizationByGroup = new Map<string, number>();
  for (const [group, totals] of offerTotalsByGroup) {
    // Mirror clearing.ts's balanceForBook: a group book missing the commodity
    // falls back to the GLOBAL balance. Without the fallback a missing country
    // entry skips normalization and over-values the delivered book, so buyers
    // would be charged for units nobody delivered.
    const laggedSupply =
      (
        (group ? countryClearingBooks?.get(group as CountryId)?.get("advertising") : undefined) ??
        globalCommodityBalances.get("advertising")
      )?.supply ?? 0;
    const rawUnits = totals.normalizable + totals.exemptReal;
    let normalization = 1;
    if (laggedSupply > 0 && rawUnits > laggedSupply && totals.normalizable > 0) {
      const target = laggedSupply - totals.exemptReal;
      normalization = target <= 0 ? 0 : Math.min(1, target / totals.normalizable);
    }
    normalizationByGroup.set(group, normalization);
  }

  for (const offer of offers) {
    const clearing = clearingBySectorId?.get(offer.input.sectorId);
    const soldFraction = clearing?.soldByCommodity?.advertising ?? 0;
    if (!(soldFraction > 0)) continue;
    const normalizedUnits = offer.real
      ? offer.units
      : offer.units * (normalizationByGroup.get(offer.group) ?? 1);
    const filledUnits = normalizedUnits * soldFraction;
    const corpId = sectorCorpId.get(offer.input.sectorId);
    if (!corpId || !(filledUnits > 0)) continue;
    const priceRatio =
      (offer.group
        ? reachablePriceRatioByCountry?.get(offer.group)?.get("advertising")
        : undefined) ?? priceRatioByCommodity.get("advertising");
    const posture = clearing?.effectivePosture ?? 0;
    const effectivePosture =
      qualityPremiumPricingEnabled && posture > 0 && offer.input.outputQuality != null
        ? posture * qualityPremiumMultiplier(offer.input.outputQuality)
        : posture;
    const clearingUnitPriceAnchor =
      clearingBasePrices.advertising * priceRealizationFactor(priceRatio) * (1 + effectivePosture);
    const deliveredValueAnchor = (filledUnits * clearingUnitPriceAnchor) / TURNS_PER_DAY;
    deliveredByCorpId.set(corpId, (deliveredByCorpId.get(corpId) ?? 0) + deliveredValueAnchor);
  }

  return deliveredByCorpId;
}
