import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { Bond, Corporation } from "@/lib/db/types";

async function releaseFundHeldShares(db: Awaited<ReturnType<typeof getDb>>): Promise<{
  corporations: number;
  shares: number;
}> {
  const corporations = await db
    .collection<Corporation>("corporations")
    .find({ "shareholders.fundId": { $exists: true } }, { projection: { _id: 1, shareholders: 1 } })
    .toArray();

  const ops = [];
  let releasedShares = 0;
  for (const corporation of corporations) {
    const fundHolders = (corporation.shareholders ?? []).filter((holder) => holder.fundId);
    if (fundHolders.length === 0) continue;
    const shares = fundHolders.reduce((sum, holder) => sum + Math.max(0, holder.shares ?? 0), 0);

    releasedShares += shares;
    ops.push({
      updateOne: {
        filter: { _id: corporation._id },
        update: {
          ...(shares > 0 ? { $inc: { publicFloat: shares } } : {}),
          $pull: { shareholders: { fundId: { $exists: true } } },
          $set: { updatedAt: new Date() },
        },
      },
    });
  }

  if (ops.length > 0) {
    await db.collection<Corporation>("corporations").bulkWrite(ops);
  }

  return { corporations: ops.length, shares: releasedShares };
}

async function releaseFundHeldBonds(db: Awaited<ReturnType<typeof getDb>>): Promise<{
  bonds: number;
  units: number;
}> {
  const bonds = await db
    .collection<Bond>("bonds")
    .find({ "holders.fundId": { $exists: true } }, { projection: { _id: 1, holders: 1 } })
    .toArray();

  const ops = [];
  let releasedUnits = 0;
  for (const bond of bonds) {
    const fundHolders = (bond.holders ?? []).filter((holder) => holder.fundId);
    if (fundHolders.length === 0) continue;
    const units = fundHolders.reduce((sum, holder) => sum + Math.max(0, holder.units ?? 0), 0);

    releasedUnits += units;
    ops.push({
      updateOne: {
        filter: { _id: bond._id },
        update: {
          ...(units > 0 ? { $inc: { publicFloat: units } } : {}),
          $pull: { holders: { fundId: { $exists: true } } },
          $set: { updatedAt: new Date() },
        },
      },
    });
  }

  if (ops.length > 0) {
    await db.collection<Bond>("bonds").bulkWrite(ops);
  }

  return { bonds: ops.length, units: releasedUnits };
}

// DELETE /api/admin/investment-funds/clear — Delete all index fund data
// Also removes migration markers so re-enabling re-seeds fresh.
export async function DELETE() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const [releasedShares, releasedBonds] = await Promise.all([
      releaseFundHeldShares(db),
      releaseFundHeldBonds(db),
    ]);

    const [fundResult, posResult, txnResult, snapResult, redeemResult] = await Promise.all([
      db.collection("indexFunds").deleteMany({}),
      db.collection("indexFundPositions").deleteMany({}),
      db.collection("indexFundTransactions").deleteMany({}),
      db.collection("indexFundSnapshots").deleteMany({}),
      db.collection("indexFundRedemptionQueue").deleteMany({}),
    ]);

    // Also remove the bootstrap migration markers so re-enabling re-seeds.
    await db.collection<{ _id: string }>("migrationsRun").deleteMany({
      _id: {
        $in: [
          "2026-06-01-index-fund-foundation",
          "2026-06-01-index-fund-seed",
          "2026-06-02-index-fund-real-bonds",
        ],
      },
    });

    return NextResponse.json({
      success: true,
      deleted: {
        funds: fundResult.deletedCount,
        positions: posResult.deletedCount,
        transactions: txnResult.deletedCount,
        snapshots: snapResult.deletedCount,
        redemptions: redeemResult.deletedCount,
        fundHeldSharesReleased: releasedShares,
        fundHeldBondsReleased: releasedBonds,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
