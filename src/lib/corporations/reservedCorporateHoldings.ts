import type { Db, ObjectId } from "mongodb";
import type { Corporation, ShareListing, ShareOrder } from "@/lib/db/types";
import { getControllingCorporateParent } from "@/lib/corporations/corporateOwnership";

export interface ReservedCorporatePosition {
  corporationId: ObjectId;
  shares: number;
}

type OpenCorpSell = Pick<
  ShareOrder,
  "corporationId" | "type" | "status" | "placerCorporationId" | "sharesRemaining"
>;
type OpenCorpListing = Pick<
  ShareListing,
  "corporationId" | "status" | "sellerCorporationId" | "sharesRemaining"
>;

/**
 * Corp-placed sell orders and listings debit the holder at creation, so the
 * cap table no longer shows those shares. They are still unsold: add them back
 * when deciding who controls a corporation.
 */
export function reservedCorporatePositions(
  orders: OpenCorpSell[],
  listings: OpenCorpListing[],
  targetCorpId: ObjectId
): ReservedCorporatePosition[] {
  const byPlacer = new Map<string, ReservedCorporatePosition>();
  const add = (id: ObjectId, shares: number) => {
    if (shares <= 0) return;
    const key = id.toString();
    const prev = byPlacer.get(key);
    if (prev) prev.shares += shares;
    else byPlacer.set(key, { corporationId: id, shares });
  };

  for (const order of orders) {
    if (order.type !== "sell" || order.status !== "open" || !order.placerCorporationId) continue;
    if (order.corporationId.toString() !== targetCorpId.toString()) continue;
    add(order.placerCorporationId, order.sharesRemaining ?? 0);
  }
  for (const listing of listings) {
    if (listing.status !== "open" || !listing.sellerCorporationId) continue;
    if (listing.corporationId.toString() !== targetCorpId.toString()) continue;
    add(listing.sellerCorporationId, listing.sharesRemaining ?? 0);
  }
  return [...byPlacer.values()];
}

/** Clone `corporation.shareholders` with reserved corp-sell/listing shares added back. */
export function corporationWithReservedHoldings(
  corporation: Corporation,
  reserved: ReservedCorporatePosition[]
): Corporation {
  if (reserved.length === 0) return corporation;
  const shareholders = [...(corporation.shareholders ?? [])];
  for (const row of reserved) {
    const idx = shareholders.findIndex((sh) => sh.corporationId?.equals(row.corporationId));
    if (idx >= 0) {
      shareholders[idx] = {
        ...shareholders[idx],
        shares: (shareholders[idx].shares ?? 0) + row.shares,
      };
    } else {
      shareholders.push({ corporationId: row.corporationId, shares: row.shares });
    }
  }
  return { ...corporation, shareholders };
}

export async function loadReservedCorporatePositions(
  db: Db,
  targetCorpId: ObjectId
): Promise<ReservedCorporatePosition[]> {
  const [orders, listings] = await Promise.all([
    db
      .collection<ShareOrder>("shareOrders")
      .find({
        corporationId: targetCorpId,
        type: "sell",
        status: "open",
        placerCorporationId: { $exists: true },
      })
      .toArray(),
    db
      .collection<ShareListing>("shareListings")
      .find({
        corporationId: targetCorpId,
        status: "open",
        sellerCorporationId: { $exists: true },
      })
      .toArray(),
  ]);
  return reservedCorporatePositions(orders, listings, targetCorpId);
}

/** Batch loader for turn cleanup: reserved positions keyed by target corp id. */
export async function loadReservedCorporatePositionsByTarget(
  db: Db
): Promise<Map<string, ReservedCorporatePosition[]>> {
  const [orders, listings] = await Promise.all([
    db
      .collection<ShareOrder>("shareOrders")
      .find({
        type: "sell",
        status: "open",
        placerCorporationId: { $exists: true },
      })
      .toArray(),
    db
      .collection<ShareListing>("shareListings")
      .find({
        status: "open",
        sellerCorporationId: { $exists: true },
      })
      .toArray(),
  ]);

  const targetIds = new Set<string>();
  for (const order of orders) targetIds.add(order.corporationId.toString());
  for (const listing of listings) targetIds.add(listing.corporationId.toString());

  const map = new Map<string, ReservedCorporatePosition[]>();
  for (const id of targetIds) {
    const targetId =
      orders.find((o) => o.corporationId.toString() === id)?.corporationId ??
      listings.find((l) => l.corporationId.toString() === id)?.corporationId;
    if (!targetId) continue;
    map.set(id, reservedCorporatePositions(orders, listings, targetId));
  }
  return map;
}

/**
 * Open corp-placed sell reservations this holder has against OTHER corps.
 * Used so a parent portfolio still shows a subsidiary it has listed for sale.
 */
export async function loadReservedPositionsPlacedBy(
  db: Db,
  placerCorpId: ObjectId
): Promise<Array<{ targetCorpId: ObjectId; shares: number }>> {
  const [orders, listings] = await Promise.all([
    db
      .collection<ShareOrder>("shareOrders")
      .find({
        placerCorporationId: placerCorpId,
        type: "sell",
        status: "open",
      })
      .toArray(),
    db
      .collection<ShareListing>("shareListings")
      .find({
        sellerCorporationId: placerCorpId,
        status: "open",
      })
      .toArray(),
  ]);

  const byTarget = new Map<string, { targetCorpId: ObjectId; shares: number }>();
  const add = (targetCorpId: ObjectId, shares: number) => {
    if (shares <= 0) return;
    const key = targetCorpId.toString();
    const prev = byTarget.get(key);
    if (prev) prev.shares += shares;
    else byTarget.set(key, { targetCorpId, shares });
  };
  for (const order of orders) add(order.corporationId, order.sharesRemaining ?? 0);
  for (const listing of listings) add(listing.corporationId, listing.sharesRemaining ?? 0);
  return [...byTarget.values()];
}

/** Controlling parent, counting unsold shares still reserved on the order book. */
export async function resolveControllingCorporateParent(
  db: Db,
  corporation: Corporation
): Promise<ReturnType<typeof getControllingCorporateParent>> {
  const reserved = await loadReservedCorporatePositions(db, corporation._id);
  return getControllingCorporateParent(corporationWithReservedHoldings(corporation, reserved));
}
