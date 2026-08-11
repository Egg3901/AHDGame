import type { Db, ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { Corporation, ShareOrder } from "@/lib/db/types";

/**
 * A single open share order belonging to the authenticated character, enriched
 * with the corporation it trades so a consolidated view can label and link it
 * without a second round trip. Mirrors the `myOrders` shape produced by
 * getShareOrdersView (see ./shareOrders.ts) plus corporation metadata.
 */
export interface MyOpenShareOrder {
  _id: string;
  corporationId: string;
  corporationSequentialId?: number;
  corporationName: string;
  tickerSymbol?: string;
  currencyCode: CurrencyCode;
  type: "buy" | "sell";
  shares: number;
  sharesRemaining: number;
  pricePerShare: number;
  escrowAmount: number;
  status: ShareOrder["status"];
  createdAt: Date;
}

/**
 * Return every OPEN share order authorized by this character across ALL
 * corporations, newest first. Backed by the `shareOrders_char_status` index
 * (see src/lib/admin/seed/indexes/performance.ts).
 */
export async function getMyOpenShareOrders(
  db: Db,
  characterId: ObjectId
): Promise<MyOpenShareOrder[]> {
  const orders = await db
    .collection<ShareOrder>("shareOrders")
    .find({ characterId, status: "open" })
    .sort({ createdAt: -1 })
    .toArray();

  if (orders.length === 0) return [];

  // Batch-load the corporations these orders touch so we enrich without an
  // N+1 fetch. De-duplicate ids first — a character often has several orders
  // on the same corp.
  const corpIds = Array.from(
    new Map(orders.map((o) => [o.corporationId.toString(), o.corporationId])).values()
  );

  const corps = await db
    .collection<Corporation>("corporations")
    .find({ _id: { $in: corpIds } })
    .project<
      Pick<Corporation, "_id" | "name" | "tickerSymbol" | "sequentialId" | "liquidCurrencyCode">
    >({
      name: 1,
      tickerSymbol: 1,
      sequentialId: 1,
      liquidCurrencyCode: 1,
    })
    .toArray();

  const corpMap = new Map(corps.map((c) => [c._id.toString(), c]));

  return orders.map((order) => {
    const corp = corpMap.get(order.corporationId.toString());
    return {
      _id: order._id.toString(),
      corporationId: order.corporationId.toString(),
      corporationSequentialId: corp?.sequentialId,
      corporationName: corp?.name ?? "Unknown corporation",
      tickerSymbol: corp?.tickerSymbol,
      // Pre-forex corps have no stored currency; treat those as USD.
      currencyCode: corp?.liquidCurrencyCode ?? "USD",
      type: order.type,
      shares: order.shares,
      sharesRemaining: order.sharesRemaining,
      pricePerShare: order.pricePerShare,
      escrowAmount: order.escrowAmount,
      status: order.status,
      createdAt: order.createdAt,
    };
  });
}
