import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { cancelPendingTransaction } from "@/lib/parties/pendingTreasuryTransactions";
import type { PendingTreasuryTransaction } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ code: string; id: string; txnId: string }>;
}

// POST /api/country/[code]/parties/[id]/treasury/pending/[txnId]/cancel
// Cancels a pending row. Only the original proposer may cancel.
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { code, id: partyId, txnId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;
    if (authResult.user.isBanned) {
      return NextResponse.json({ error: "Account is banned" }, { status: 403 });
    }
    const { user } = authResult;

    const rateLimit = checkRateLimit(user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    let txnOid: ObjectId;
    try {
      txnOid = new ObjectId(txnId);
    } catch {
      return NextResponse.json({ error: "Invalid transaction ID" }, { status: 400 });
    }

    const db = await getDb();
    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) return NextResponse.json({ error: "Party not found" }, { status: 404 });

    // Country + party scoping check before the proposer-only update.
    const pending = await db
      .collection<PendingTreasuryTransaction>("pendingTreasuryTransactions")
      .findOne({ _id: txnOid });
    if (!pending) {
      return NextResponse.json({ error: "Pending transaction not found" }, { status: 404 });
    }
    if (!pending.partyId.equals(party._id) || pending.countryId !== countryId) {
      return NextResponse.json(
        { error: "Transaction does not belong to this party" },
        { status: 403 }
      );
    }

    const ok = await cancelPendingTransaction(db, txnOid, user.character._id);
    if (!ok) {
      return NextResponse.json(
        { error: "Only the proposer can cancel, and only while the row is open." },
        { status: 403 }
      );
    }
    return NextResponse.json({ success: true, status: "cancelled" });
  } catch (error) {
    return handleRouteError(error);
  }
}
