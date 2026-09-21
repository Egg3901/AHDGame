import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import {
  FILL_CLAIM_STALE_MS,
  isFillClaimStale,
  recoverStaleFillClaims,
} from "@/lib/forex/fillRecovery";
import type { CurrencyOrder } from "@/lib/db/types";

// GET /api/admin/forex/recover - list peer-fill intents stuck in `processing`.
// Unresolvable intents stay `processing` by design; this listing is how they
// remain visible to an operator instead of being force-completed.
// Auth: requireAdmin only.
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const now = new Date();
    const stuck = await db
      .collection<CurrencyOrder>("currencyOrders")
      .find({ status: "processing", processingFillKey: { $exists: true } })
      .limit(100)
      .toArray();

    return NextResponse.json({
      orders: stuck.map((order) => ({
        orderId: order._id.toHexString(),
        fillKey: order.processingFillKey,
        fillerId: order.processingFill?.fillerId,
        fillAmount: order.processingFill?.fillAmount,
        claimedAt: order.processingFill?.claimedAt ?? null,
        stale: isFillClaimStale(order, now.getTime()),
        staleAfterMs: FILL_CLAIM_STALE_MS,
        recoveryInProgress: (order.processingFill?.recoveryKey ?? null) !== null,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/admin/forex/recover - finish or undo stale peer-fill intents.
// Same pass the forex turn runs before filling; here on demand, for an
// operator looking at the stuck list above.
// Auth: requireAdmin only.
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    return NextResponse.json(await recoverStaleFillClaims(db, new Date()));
  } catch (error) {
    return handleRouteError(error);
  }
}
