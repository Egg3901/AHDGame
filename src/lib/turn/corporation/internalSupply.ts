/**
 * Own-group sourcing turn context. Uses current full economic ownership and
 * the same physical input demand basis as supply agreements, without new reads.
 */
import {
  computeSupplyAgreementBuyerDemand,
  type SupplyAgreementDemandSector,
  type SettleableSupplyAgreement,
} from "./settleSupplyAgreements";
import { resolveSupplyPolicies } from "@/lib/market/internalSupply/rules";
import type { InternalSupplyClearing } from "@/lib/market/internalSupply/clearing";
import type { CorporationLookups } from "./types";
import type { MarketContext } from "@/lib/market/marketContext";
import type { CommodityType } from "@/lib/constants/commodities";
import { isStateScopedCommodity } from "@/lib/market/commodityMarketScope";

export function buildInternalSupplyContext(args: {
  lookups: CorporationLookups;
  market: MarketContext;
  sectors: readonly (SupplyAgreementDemandSector & { sectorId: string })[];
  agreements: readonly SettleableSupplyAgreement[];
  turn: number;
  freightSettlementActive?: boolean;
}): InternalSupplyClearing | undefined {
  if (!args.market.plantsEnabled || !args.market.clearingEnabled) return undefined;
  const owners = [...args.lookups.corpById].map(([id, c]) => ({
    id,
    totalShares: c.totalShares,
    holders: (c.shareholders ?? []).map((h) => ({
      corporationId: h.corporationId?.toString(),
      shares: h.shares,
    })),
    policy: c.internalSupplyPolicy,
  }));
  const policies = resolveSupplyPolicies(owners);
  if (![...policies.values()].some((p) => p.policy.priority !== "market")) return undefined;
  const buyers = args.sectors.map((s) => ({
    sectorId: s.sectorId,
    corporationId: s.corporationId,
    stateId: s.stateId,
    demand:
      computeSupplyAgreementBuyerDemand({
        preset: args.lookups.preset,
        sectors: [s],
        currentTurn: args.turn,
        unitScale: args.lookups.eraUnitScale,
        plantsEnabled: true,
      }).get(s.corporationId) ?? new Map<CommodityType, number>(),
    committed: new Map<CommodityType, number>(),
    availability: args.lookups.stateInputAvailabilityByState.get(s.stateId ?? ""),
  }));
  // Explicit promises claim their buyers' physical demand first. Splitting
  // across consuming plants prevents priority from reserving the same demand.
  for (const a of args.agreements) {
    const eligible = buyers.filter(
      (b) =>
        b.corporationId === a.buyerCorpId &&
        (!isStateScopedCommodity(a.commodity) || !a.stateId || b.stateId === a.stateId)
    );
    const remaining = eligible.map((b) =>
      Math.max(0, (b.demand.get(a.commodity) ?? 0) - (b.committed.get(a.commodity) ?? 0))
    );
    const total = remaining.reduce((n, u) => n + u, 0);
    const take = Math.min(total, Math.max(0, a.volumeCap));
    if (!(take > 0)) continue;
    eligible.forEach((b, i) =>
      b.committed.set(
        a.commodity,
        (b.committed.get(a.commodity) ?? 0) + (take * remaining[i]!) / total
      )
    );
  }
  const availabilityOut = new Map<string, Map<CommodityType, number>>();
  const discountCostOut = new Map<string, number>();
  args.market.internalInputAvailabilityBySectorId = availabilityOut;
  args.market.internalSupplyDiscountCostBySectorId = discountCostOut;
  return {
    policies,
    buyers,
    availabilityOut,
    discountCostOut,
    tradesOut: [],
    deliveryStateBySector: args.freightSettlementActive
      ? new Map(args.sectors.filter((s) => !!s.stateId).map((s) => [s.sectorId, s.stateId!]))
      : undefined,
    ownRouteDeliveredByKey: args.freightSettlementActive
      ? args.lookups.ownRouteDeliveredByKey
      : undefined,
  };
}

/** Persist only actual deliveries, with empty current receipts clearing old results. */
export function finishInternalSupplyContext(
  context: InternalSupplyClearing | undefined,
  market: MarketContext,
  turn: number
): void {
  if (!context) return;
  const receipts = new Map<
    string,
    {
      turn: number;
      received: Partial<Record<CommodityType, number>>;
      reserved: Partial<Record<CommodityType, number>>;
    }
  >();
  for (const buyer of context.buyers)
    receipts.set(buyer.sectorId, { turn, received: {}, reserved: {} });
  for (const trade of context.tradesOut) {
    const seller = receipts.get(trade.supplierSectorId) ?? { turn, received: {}, reserved: {} };
    seller.reserved[trade.commodity] = (seller.reserved[trade.commodity] ?? 0) + trade.units;
    receipts.set(trade.supplierSectorId, seller);
    const buyer = receipts.get(trade.buyerSectorId) ?? { turn, received: {}, reserved: {} };
    buyer.received[trade.commodity] = (buyer.received[trade.commodity] ?? 0) + trade.units;
    receipts.set(trade.buyerSectorId, buyer);
  }
  market.internalSupplyReceiptsBySectorId = receipts;
  market.internalSupplyCommittedInputsBySectorId = new Map(
    context.buyers.map((b) => [b.sectorId, b.committed ?? new Map()])
  );
  market.internalSupplyTrades = (context.pendingBooks ?? []).flatMap((book) =>
    context.tradesOut
      .filter(
        (t) =>
          t.commodity === book.commodity &&
          book.trades.some(
            (original) =>
              original.supplierSectorId === t.supplierSectorId &&
              original.buyerSectorId === t.buyerSectorId
          )
      )
      .map((t) => ({ ...t, marketPrice: book.marketPrice }))
  );
}
