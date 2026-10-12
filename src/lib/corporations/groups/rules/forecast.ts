/** Group estimates reuse allocation rules at fixed output, public fill and operating costs. */
import {
  coordinateGroupBook,
  type CoordinationBook,
  type CoordinationSeller,
} from "./marketCoordination";
import type { SupplyMember } from "./supply";
export interface ForecastSeller extends CoordinationSeller {
  openFill: number;
  quoteFactor: number;
}
export interface GroupForecastBook extends Omit<CoordinationBook, "turn" | "members" | "sellers"> {
  sellers: ForecastSeller[];
  benchmarkFactor?: number;
}
export interface GroupForecastBasis {
  turn: number;
  rootId: string;
  memberIds: string[];
  cashByMember: Record<string, number>;
  books: GroupForecastBook[];
  complete: boolean;
}
export function estimateGroupSupply(
  basis: GroupForecastBasis,
  members: readonly SupplyMember[],
  turn: number
) {
  if (
    !basis.complete ||
    members.length !== basis.memberIds.length ||
    members.some((m) => !basis.memberIds.includes(m.id))
  )
    return null;
  const rows = new Map(
    members.map((m) => [
      m.id,
      {
        id: m.id,
        independentRevenue: 0,
        coordinatedRevenue: 0,
        revenueDifference: 0,
        operatingProfitDifference: 0,
        receivingValue: 0,
        supplyingValue: 0,
      },
    ])
  );
  const cash = new Map(members.map((m) => [m.id, m.cashAvailableAnchor]));
  for (const book of basis.books) {
    const result = coordinateGroupBook({
      ...book,
      turn,
      members: members.map((m) => ({ ...m, cashAvailableAnchor: cash.get(m.id) ?? 0 })),
    });
    for (const [id, spent] of result.spendByBuyer)
      cash.set(id, Math.max(0, (cash.get(id) ?? 0) - spent));
    for (const seller of book.sellers) {
      const row = rows.get(seller.memberId);
      if (!row) continue;
      const fill = Math.max(0, Math.min(1, seller.openFill));
      const quote =
        Number.isFinite(seller.quoteFactor) && seller.quoteFactor > 0 ? seller.quoteFactor : 1;
      const units = result.reservedBySeller.get(seller.sectorId) ?? 0;
      const available = Math.max(0, seller.units - seller.committedUnits);
      row.independentRevenue += available * book.unitPriceAnchor * quote * fill;
      row.coordinatedRevenue +=
        Math.max(0, available - units) * book.unitPriceAnchor * quote * fill +
        units * book.unitPriceAnchor;
    }
    for (const receipt of result.receipts) {
      rows.get(receipt.supplierId)!.supplyingValue += receipt.amountAnchor;
      const buyer = rows.get(receipt.buyerId)!;
      buyer.receivingValue += receipt.amountAnchor;
      const publicFactor = book.buyers.find(
        (b) => b.sectorId === receipt.buyerSectorId
      )?.publicPriceFactor;
      const benchmark = book.benchmarkFactor ?? 1;
      if (publicFactor != null && publicFactor > 0 && benchmark > 0)
        buyer.operatingProfitDifference += receipt.amountAnchor * (publicFactor / benchmark - 1);
    }
  }
  for (const row of rows.values()) {
    row.revenueDifference = row.coordinatedRevenue - row.independentRevenue;
    // Direct sales contribution before tax and any production/cost response.
    row.operatingProfitDifference += row.revenueDifference;
  }
  const corporations = [...rows.values()];
  const total = corporations.reduce(
    (sum, r) => ({
      independentRevenue: sum.independentRevenue + r.independentRevenue,
      coordinatedRevenue: sum.coordinatedRevenue + r.coordinatedRevenue,
      revenueDifference: sum.revenueDifference + r.revenueDifference,
      operatingProfitDifference: sum.operatingProfitDifference + r.operatingProfitDifference,
      internalTradingValue: sum.internalTradingValue + r.supplyingValue,
    }),
    {
      independentRevenue: 0,
      coordinatedRevenue: 0,
      revenueDifference: 0,
      operatingProfitDifference: 0,
      internalTradingValue: 0,
    }
  );
  if (
    corporations.some((r) =>
      Object.values(r).some((v) => typeof v === "number" && !Number.isFinite(v))
    )
  )
    return null;
  return { basisTurn: basis.turn, appliesTurn: turn, corporations, total };
}
