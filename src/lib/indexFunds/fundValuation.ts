import { ObjectId, type Db } from "mongodb";
import type { IndexFundRedemptionQueueEntry, ShareOrder } from "@/lib/db/types";

type IdLike = ObjectId | { toString(): string };

/**
 * Normalize to ObjectIds so the $match compares native types and can use an
 * index (fund ids are stored as ObjectIds). Non-ObjectId-shaped inputs are
 * dropped — under the previous string comparison they could never match either.
 */
function toObjectIds(ids?: IdLike[]): ObjectId[] | null {
  if (!ids) return null;
  return ids
    .filter((id) => id instanceof ObjectId || ObjectId.isValid(id.toString()))
    .map((id) => (id instanceof ObjectId ? id : new ObjectId(id.toString())));
}

/** Cash locked in open fund-owned buy orders remains fund backing until filled or cancelled. */
export async function loadOpenOrdersEscrowByFundId(
  db: Db,
  fundIds?: IdLike[]
): Promise<Map<string, number>> {
  const fundObjectIds = toObjectIds(fundIds);
  const match: Record<string, unknown> = {
    placerFundId: fundObjectIds ? { $in: fundObjectIds } : { $exists: true },
    type: "buy",
    status: "open",
  };

  const rows = await db
    .collection<ShareOrder>("shareOrders")
    .aggregate<{ _id: string; totalEscrowAnchor: number }>([
      { $match: match },
      {
        $group: {
          _id: { $toString: "$placerFundId" },
          totalEscrowAnchor: { $sum: "$escrowAnchor" },
        },
      },
    ])
    .toArray();
  return new Map(rows.map((row) => [row._id, row.totalEscrowAnchor]));
}

/**
 * Cash owed for queued redemptions whose units have already been removed from
 * unitSupply. This payable is subtracted from NAV backing until the cash leaves.
 */
export async function loadQueuedRedemptionLiabilityByFundId(
  db: Db,
  fundIds?: IdLike[]
): Promise<Map<string, number>> {
  const fundObjectIds = toObjectIds(fundIds);
  const match: Record<string, unknown> = {
    status: { $in: ["queued", "partial"] },
    unitsBurnedAtRequest: true,
  };
  if (fundObjectIds) {
    match.fundId = { $in: fundObjectIds };
  }

  const rows = await db
    .collection<IndexFundRedemptionQueueEntry>("indexFundRedemptionQueue")
    .aggregate<{ _id: string; liabilityAnchor: number }>([
      { $match: match },
      {
        $group: {
          _id: { $toString: "$fundId" },
          liabilityAnchor: {
            $sum: {
              $multiply: ["$units", "$requestedNavAnchor"],
            },
          },
        },
      },
    ])
    .toArray();
  return new Map(rows.map((row) => [row._id, row.liabilityAnchor]));
}

export async function getOpenOrdersEscrowAnchor(db: Db, fundId: IdLike): Promise<number> {
  return (await loadOpenOrdersEscrowByFundId(db, [fundId])).get(fundId.toString()) ?? 0;
}

export async function getQueuedRedemptionLiabilityAnchor(db: Db, fundId: IdLike): Promise<number> {
  return (await loadQueuedRedemptionLiabilityByFundId(db, [fundId])).get(fundId.toString()) ?? 0;
}
