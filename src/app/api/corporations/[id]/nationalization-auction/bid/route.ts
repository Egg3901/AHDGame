// POST /api/corporations/[id]/nationalization-auction/bid
// Place or raise an escrowed bid on the open privatization auction for corp [id].
// A corp bid (asCorporationId) requires the acting character to be that corp's CEO.
// Auth: requireAuthWithCharacter. Spec §13.3. Errors: 400, 401, 404, 429
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, isUnexpectedError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import type { NationalizationAuction } from "@/lib/db/types";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { placeAuctionBid } from "@/lib/nationalization/privatizationAuction";
import { auctionBidSchema } from "@/lib/api/schemas/nationalization";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid corporation ID" }, { status: 400 });
    }
    const parsed = await parseJsonBody(request, auctionBidSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    if (parsed.data.asCorporationId && !ObjectId.isValid(parsed.data.asCorporationId)) {
      return NextResponse.json({ error: "Invalid corporation ID" }, { status: 400 });
    }

    const db = await getDb();
    const auction = await db
      .collection<NationalizationAuction>("nationalizationAuctions")
      .findOne({ corporationId: new ObjectId(id), status: "open" });
    if (!auction) {
      return NextResponse.json({ error: "No open auction for this corporation." }, { status: 404 });
    }

    const turn = await getCurrentTurn(db);
    try {
      await placeAuctionBid(db, {
        auctionId: auction._id,
        characterId: auth.user.character._id,
        asCorporationId: parsed.data.asCorporationId
          ? new ObjectId(parsed.data.asCorporationId)
          : undefined,
        amount: parsed.data.amount,
        turn,
      });
      return NextResponse.json({ success: true });
    } catch (err) {
      // Real infra/programming failures in this money path must be captured,
      // not masked as a 400 validation message the user can't act on.
      if (isUnexpectedError(err)) {
        return handleRouteError(err, {
          request,
          route: "/api/corporations/[id]/nationalization-auction/bid",
          extra: { auctionId: auction._id.toString(), amount: parsed.data.amount },
        });
      }
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Bid failed" },
        { status: 400 }
      );
    }
  } catch (error) {
    return handleRouteError(error);
  }
}
