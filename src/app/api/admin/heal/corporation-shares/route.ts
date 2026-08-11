import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { Corporation, ShareListing, ShareOrder } from "@/lib/db/types";

/**
 * POST /api/admin/heal/corporation-shares
 * Recalculates totalShares for all corporations as:
 *   sum(shareholder shares) + publicFloat + shares reserved in open sell orders.
 * Fixes any mismatches caused by race conditions or past bugs.
 */
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const corporations = await db.collection<Corporation>("corporations").find({}).toArray();

    // Aggregate reserved shares per corporation.
    // (a) CORPORATION-placed sell orders: debited from the corp's shareholder
    //     entry at creation time, so those shares are no longer in the
    //     shareholders array and must be added back to correctTotal.
    //     Character sell orders only reserve (shares stay in shareholder array),
    //     so counting them here would double-count.
    // (b) Open shareListings (both character- and corp-sold): also debit at
    //     creation. Must be counted for the same reason — omitting them would
    //     let the heal shrink totalShares below actual issued shares, which
    //     then produces phantom shares when the listing later fills.
    const reservedByCorp = new Map<string, number>();
    const openCorpSellOrders = await db
      .collection<ShareOrder>("shareOrders")
      .find({ type: "sell", status: "open", placerCorporationId: { $exists: true } })
      .toArray();
    for (const order of openCorpSellOrders) {
      const key = order.corporationId.toString();
      reservedByCorp.set(key, (reservedByCorp.get(key) ?? 0) + order.sharesRemaining);
    }
    const openListings = await db
      .collection<ShareListing>("shareListings")
      .find({ status: "open" })
      .toArray();
    for (const listing of openListings) {
      const key = listing.corporationId.toString();
      reservedByCorp.set(key, (reservedByCorp.get(key) ?? 0) + listing.sharesRemaining);
    }

    const fixes: Array<{ name: string; before: number; after: number }> = [];

    for (const corp of corporations) {
      const shareholderTotal = (corp.shareholders ?? []).reduce(
        (sum, sh) => sum + (sh.shares ?? 0),
        0
      );
      const reservedInOrders = reservedByCorp.get(corp._id.toString()) ?? 0;
      const correctTotal = shareholderTotal + (corp.publicFloat ?? 0) + reservedInOrders;

      if (correctTotal !== (corp.totalShares ?? 0)) {
        await db
          .collection<Corporation>("corporations")
          .updateOne({ _id: corp._id }, { $set: { totalShares: correctTotal } });

        fixes.push({
          name: corp.name,
          before: corp.totalShares ?? 0,
          after: correctTotal,
        });
      }
    }

    return NextResponse.json({
      message: `Healed ${fixes.length} corporation(s)`,
      fixes,
      totalChecked: corporations.length,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
