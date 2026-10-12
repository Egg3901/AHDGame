/**
 * Internal supply clearing bridge. Reservations use the normalized offer book;
 * supply discounts and buyer availability come from the same delivery rows.
 */
import type { CommodityType } from "@/lib/constants/commodities";
import type { ClearingSeller } from "../clearing";
import {
  allocateInternalSupply,
  internalSupplyDiscounts,
  internalSupplyAvailability,
  type InternalSupplyBuyer,
  type InternalSupplyTrade,
  type InternalSupplyPolicy,
} from "./rules";
import { TURNS_PER_DAY } from "@/lib/constants/turnTime";

export interface InternalSupplyClearing {
  policies: ReadonlyMap<string, { root: string; policy: InternalSupplyPolicy }>;
  buyers: readonly {
    sectorId: string;
    corporationId: string;
    demand: ReadonlyMap<string, number>;
    committed?: ReadonlyMap<CommodityType, number>;
    availability?: ReadonlyMap<CommodityType, number>;
  }[];
  availabilityOut: Map<string, Map<CommodityType, number>>;
  discountCostOut: Map<string, number>;
  tradesOut: Array<InternalSupplyTrade & { commodity: CommodityType }>;
  pendingBooks?: Array<{
    commodity: CommodityType;
    trades: InternalSupplyTrade[];
    buyers: InternalSupplyBuyer[];
    supply: number;
    demand: number;
    marketPrice: number;
    sellers: readonly { id: string; units: number }[];
  }>;
}

export function reserveInternalSupply(args: {
  context: InternalSupplyClearing;
  commodity: CommodityType;
  sellers: readonly ClearingSeller[];
  corporationBySector: ReadonlyMap<string, string>;
  committed: ReadonlyMap<string, number> | undefined;
  book: string;
  bookForSector: (sectorId: string) => string;
  supply: number;
  demand: number;
  reservationRoom: number;
  marketPrice: number;
}): Map<string, number> | undefined {
  const buyers: InternalSupplyBuyer[] = args.context.buyers
    .filter((b) => args.bookForSector(b.sectorId) === args.book)
    .map((b) => ({
      sectorId: b.sectorId,
      corporationId: b.corporationId,
      demand: b.demand.get(args.commodity) ?? 0,
      committed: b.committed?.get(args.commodity) ?? 0,
      availability:
        b.availability?.get(args.commodity) ??
        (args.demand > 0 ? Math.min(1, args.supply / args.demand) : 1),
    }));
  const { trades } = allocateInternalSupply({
    sellers: args.sellers.map((s) => ({
      sectorId: s.id,
      corporationId: args.corporationBySector.get(s.id) ?? "",
      units: s.units,
      committed: args.committed?.get(s.id),
    })),
    buyers,
    policies: args.context.policies,
    supply: args.supply,
    demand: args.demand,
    reservationRoom: Math.min(
      args.reservationRoom,
      Math.max(0, args.supply - [...(args.committed?.values() ?? [])].reduce((n, u) => n + u, 0))
    ),
  });
  if (!trades.length) return undefined;
  (args.context.pendingBooks ??= []).push({
    commodity: args.commodity,
    trades,
    buyers,
    supply: args.supply,
    demand: args.demand,
    marketPrice: args.marketPrice,
    sellers: args.sellers.map((s) => ({ id: s.id, units: s.units })),
  });
  const reservations = new Map(args.committed ?? []);
  for (const t of trades)
    reservations.set(t.supplierSectorId, (reservations.get(t.supplierSectorId) ?? 0) + t.units);
  return reservations;
}

/** Actual seller fills, including ownership caps, bound internal deliveries too. */
export function finishInternalSupplyCommodity(
  context: InternalSupplyClearing,
  commodity: CommodityType,
  sold: ReadonlyMap<string, number>,
  sellers: readonly ClearingSeller[],
  committed: ReadonlyMap<string, number>,
  blockedFraction?: ReadonlyMap<string, number>
): void {
  const internalBySeller = new Map<string, number>();
  for (const book of context.pendingBooks ?? []) {
    if (book.commodity !== commodity) continue;
    for (const trade of book.trades)
      internalBySeller.set(
        trade.supplierSectorId,
        (internalBySeller.get(trade.supplierSectorId) ?? 0) + trade.units
      );
  }
  const filled = new Map(
    sellers.map((s) => [
      s.id,
      Math.max(0, s.units * (sold.get(s.id) ?? 0) - (committed.get(s.id) ?? 0)),
    ])
  );
  for (const book of context.pendingBooks ?? []) {
    if (book.commodity !== commodity) continue;
    const trades = book.trades
      .map((t) => ({
        ...t,
        units:
          t.units *
          Math.min(
            1,
            (filled.get(t.supplierSectorId) ?? 0) / (internalBySeller.get(t.supplierSectorId) ?? 1)
          ),
      }))
      .filter((t) => t.units > 0);
    for (const [id, availability] of internalSupplyAvailability(
      book.buyers,
      trades,
      Math.max(
        0,
        book.supply -
          book.sellers.reduce(
            (sum, seller) => sum + seller.units * (blockedFraction?.get(seller.id) ?? 0),
            0
          )
      ),
      book.demand
    )) {
      const byCommodity = context.availabilityOut.get(id) ?? new Map<CommodityType, number>();
      byCommodity.set(commodity, availability);
      context.availabilityOut.set(id, byCommodity);
    }
    for (const [id, cost] of internalSupplyDiscounts(trades, book.marketPrice, TURNS_PER_DAY))
      context.discountCostOut.set(id, (context.discountCostOut.get(id) ?? 0) + cost);
    context.tradesOut.push(...trades.map((t) => ({ ...t, commodity })));
  }
}
