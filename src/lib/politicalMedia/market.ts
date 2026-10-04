import { TURNS_PER_DAY } from "@/lib/constants/corporations";
import { commodityMixWeight, type CommodityType } from "@/lib/constants/commodities";
import type { SectorClearingInput, SectorClearingResult } from "@/lib/market/clearing";
import { priceRealizationFactor } from "@/lib/market/priceRealization";
import { qualityPremiumMultiplier } from "@/lib/market/clearing";
import type { PoliticalMediaSettlementPlan } from "./journal";
import {
  allocatePoliticalAdOrders,
  type PoliticalAdOrderDemand,
  type PoliticalAdSellerOffer,
} from "./rules";

export interface PoliticalAdClearingOffer {
  input: SectorClearingInput;
  clearing?: SectorClearingResult;
  corporationId: string;
  countryId: string;
  stateId?: string;
  basePrice: number;
  priceRatio?: number;
  sellerCurrencyCode: string;
  sellerLocalPerAnchor: number;
  /** Normalized physical offer, before ordinary commercial fills. */
  offeredUnits: number;
}

export interface PoliticalAdMarketSettlement {
  allocations: ReturnType<typeof allocatePoliticalAdOrders>;
  settlementPlans: Array<{ orderId: string; plan: PoliticalMediaSettlementPlan }>;
  /** Updated clearing figures include paid political fills. */
  clearingBySectorId: Map<string, SectorClearingResult>;
  /** Exact seller-local values to remove from the later sector cash P&L. */
  sellerPayoutLocalByCorpId: Map<string, number>;
}

/**
 * Fill funded political orders from unsold advertising output in their target
 * state. Commercial filling is already complete, so only its residual units
 * enter this allocator. The result updates the production revenue factor while
 * keeping commercial buyer receipts separate from these political receipts.
 */
export function settlePoliticalAdMarket(args: {
  orders: readonly PoliticalAdOrderDemand[];
  persistedPlans?: readonly { orderId: string; plan: PoliticalMediaSettlementPlan }[];
  offers: readonly PoliticalAdClearingOffer[];
  clearingBySectorId: ReadonlyMap<string, SectorClearingResult>;
  clearingEnabled: boolean;
  turn: number;
}): PoliticalAdMarketSettlement {
  const clearingBySectorId = new Map(args.clearingBySectorId);
  const sellerPayoutLocalByCorpId = new Map<string, number>();
  if (!args.clearingEnabled || (args.orders.length === 0 && !args.persistedPlans?.length)) {
    return {
      allocations: [],
      settlementPlans: [],
      clearingBySectorId,
      sellerPayoutLocalByCorpId,
    };
  }

  const sellerDetails = new Map<string, PoliticalAdClearingOffer>();
  const persistedUnitsBySectorId = new Map<string, number>();
  const persistedAllocationRows: Array<{
    sectorId: string;
    corporationId: string;
    units: number;
    amountAnchor: number;
    sellerLocalAmount: number;
  }> = [];
  for (const { plan } of args.persistedPlans ?? []) {
    for (const seller of plan.sellers) {
      persistedUnitsBySectorId.set(
        seller.sectorId,
        (persistedUnitsBySectorId.get(seller.sectorId) ?? 0) + seller.units
      );
      sellerPayoutLocalByCorpId.set(
        seller.corporationId,
        (sellerPayoutLocalByCorpId.get(seller.corporationId) ?? 0) + seller.sellerLocalAmount
      );
      persistedAllocationRows.push({
        sectorId: seller.sectorId,
        corporationId: seller.corporationId,
        units: seller.units,
        amountAnchor: seller.amountAnchor,
        sellerLocalAmount: seller.sellerLocalAmount,
      });
    }
  }
  const sellers: PoliticalAdSellerOffer[] = [];
  for (const offer of args.offers) {
    sellerDetails.set(offer.input.sectorId, offer);
    const rate = offer.input.supplyRates.advertising ?? 0;
    const clearing = offer.clearing;
    const soldFraction = clearing?.soldByCommodity?.advertising ?? 0;
    const unsoldUnits = Math.max(
      0,
      offer.offeredUnits * (1 - Math.max(0, Math.min(1, soldFraction))) -
        (persistedUnitsBySectorId.get(offer.input.sectorId) ?? 0)
    );
    if (
      !offer.stateId ||
      !(rate > 0) ||
      !(unsoldUnits > 0) ||
      !(offer.basePrice > 0) ||
      !Number.isFinite(offer.sellerLocalPerAnchor) ||
      !(offer.sellerLocalPerAnchor > 0)
    )
      continue;

    const priceLeg = priceRealizationFactor(offer.priceRatio);
    const posture = clearing?.effectivePosture ?? offer.input.posture ?? 0;
    const effectivePosture =
      posture > 0 && typeof offer.input.outputQuality === "number"
        ? posture * qualityPremiumMultiplier(offer.input.outputQuality)
        : posture;
    const unitPriceAnchor = (offer.basePrice * priceLeg * (1 + effectivePosture)) / TURNS_PER_DAY;
    if (!Number.isFinite(unitPriceAnchor) || !(unitPriceAnchor > 0)) continue;

    sellers.push({
      sectorId: offer.input.sectorId,
      corporationId: offer.corporationId,
      countryId: offer.countryId,
      stateId: offer.stateId,
      offeredUnits: offer.offeredUnits,
      unsoldUnits,
      unitPriceAnchor,
      sellerLocalPerAnchor: offer.sellerLocalPerAnchor,
    });
  }

  const allocations = allocatePoliticalAdOrders(args.orders, sellers);
  const settlementPlans = allocations.map((allocation) => ({
    orderId: allocation.orderId,
    plan: {
      plannedTurn: args.turn,
      deliveredAnchor: allocation.deliveredAnchor,
      unfilledAnchor: allocation.unfilledAnchor,
      deliveredUnits: allocation.deliveredUnits,
      sellers: allocation.sellers.map((seller) => {
        const offer = sellerDetails.get(seller.sectorId);
        if (!offer) throw new Error(`Missing ad clearing offer for ${seller.sectorId}.`);
        return {
          allocationId: seller.sectorId,
          sectorId: seller.sectorId,
          corporationId: seller.corporationId,
          units: seller.units,
          amountAnchor: seller.amountAnchor,
          sellerLocalAmount: seller.sellerLocalAmount,
          sellerCurrencyCode: offer.sellerCurrencyCode,
          sellerLocalPerAnchor: seller.sellerLocalPerAnchor,
        };
      }),
    },
  }));
  const soldUnitsBySectorId = new Map<string, number>();
  const allocationsToApply = [
    ...persistedAllocationRows,
    ...allocations.flatMap((allocation) =>
      allocation.sellers.map((seller) => ({
        sectorId: seller.sectorId,
        corporationId: seller.corporationId,
        units: seller.units,
        amountAnchor: seller.amountAnchor,
        sellerLocalAmount: seller.sellerLocalAmount,
      }))
    ),
  ];
  for (const allocation of allocations) {
    for (const seller of allocation.sellers) {
      soldUnitsBySectorId.set(
        seller.sectorId,
        (soldUnitsBySectorId.get(seller.sectorId) ?? 0) + seller.units
      );
      sellerPayoutLocalByCorpId.set(
        seller.corporationId,
        (sellerPayoutLocalByCorpId.get(seller.corporationId) ?? 0) + seller.sellerLocalAmount
      );
    }
  }
  for (const seller of persistedAllocationRows) {
    soldUnitsBySectorId.set(
      seller.sectorId,
      (soldUnitsBySectorId.get(seller.sectorId) ?? 0) + seller.units
    );
  }

  for (const [sectorId, politicalUnits] of soldUnitsBySectorId) {
    const offer = sellerDetails.get(sectorId);
    const before = clearingBySectorId.get(sectorId);
    if (!offer || !before || !(offer.offeredUnits > 0)) continue;
    const rates = Object.values(offer.input.supplyRates).filter(
      (rate): rate is number => typeof rate === "number" && Number.isFinite(rate) && rate > 0
    );
    const totalRate = rates.reduce((sum, rate) => sum + rate, 0);
    const advertisingRate = offer.input.supplyRates.advertising ?? 0;
    if (!(totalRate > 0) || !(advertisingRate > 0)) continue;

    const fractionIncrease = Math.min(
      Math.max(0, 1 - (before.soldByCommodity?.advertising ?? 0)),
      politicalUnits / offer.offeredUnits
    );
    if (!(fractionIncrease > 0)) continue;
    const nextSoldByCommodity = {
      ...before.soldByCommodity,
      advertising: Math.min(1, (before.soldByCommodity?.advertising ?? 0) + fractionIncrease),
    };
    const rowsForSector = allocationsToApply.filter((row) => row.sectorId === sectorId);
    const paidAmountAnchor = rowsForSector.reduce((sum, row) => sum + row.amountAnchor, 0);
    const averagePaidPriceFactor =
      politicalUnits > 0 && offer.basePrice > 0
        ? (paidAmountAnchor / politicalUnits / offer.basePrice) * TURNS_PER_DAY
        : 0;
    const offerFactor = averagePaidPriceFactor;
    const rateShare = advertisingRate / totalRate;
    const factor = before.factor + rateShare * fractionIncrease * offerFactor;
    const soldFraction = before.soldFraction + rateShare * fractionIncrease;
    clearingBySectorId.set(sectorId, {
      ...before,
      factor,
      soldFraction: Math.min(1, soldFraction),
      soldByCommodity: nextSoldByCommodity as Partial<Record<CommodityType, number>>,
    });
  }

  return { allocations, settlementPlans, clearingBySectorId, sellerPayoutLocalByCorpId };
}

/** Raw revenue/production offer before the clearing engine's supply normalization. */
export function rawAdvertisingOffer(args: {
  input: SectorClearingInput;
  plantsEnabled: boolean;
  clearingBasePrices: Record<CommodityType, number>;
}): number {
  const { input, plantsEnabled, clearingBasePrices } = args;
  const rate = input.supplyRates.advertising ?? 0;
  const basePrice = clearingBasePrices.advertising ?? 0;
  if (!(rate > 0) || !(basePrice > 0)) return 0;
  const measured =
    plantsEnabled && typeof input.producedUnits === "number"
      ? input.producedUnits *
        commodityMixWeight(input.supplyRates, clearingBasePrices, "advertising")
      : undefined;
  const offered = measured ?? (input.revenue * rate) / basePrice;
  return Number.isFinite(offered) && offered > 0 ? offered : 0;
}
