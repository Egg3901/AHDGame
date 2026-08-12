import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import type { Character } from "@/lib/db/types";
import type { MergerReview } from "@/lib/db/types/mergerReview";
import { MERGER_REVIEWS } from "@/lib/corporations/mergerReview/gate";
import { resolveMergerAuthority } from "@/lib/corporations/mergerReview/authority";
import { decideMergerReview } from "@/lib/corporations/mergerReview/lifecycle";
import { getGameState } from "@/lib/gameState";
import { getCurrentTurn } from "@/lib/turn/currentTurn";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const decideSchema = z.object({
  decision: z.enum(["cleared", "clearedWithRemedy", "blocked"]),
  note: z.string().trim().max(500).optional(),
});

/**
 * POST — the reviewing officeholder hands down a decision.
 *
 * Authorization is the SEAT, not the country: holding office in the reviewing
 * country is not enough, and neither is being a party to the deal. Only the
 * character currently seated in that country's competition seat can decide.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(`merger-review:${auth.user.userId}`, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    if (!ObjectId.isValid(id))
      return NextResponse.json({ error: "Invalid review id" }, { status: 400 });

    const parsed = await parseJsonBody(request, decideSchema);
    if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const db = await getDb();
    const review = await db
      .collection<MergerReview>(MERGER_REVIEWS)
      .findOne({ _id: new ObjectId(id) });
    if (!review) return NextResponse.json({ error: "Review not found" }, { status: 404 });

    const gameState = await getGameState(db);
    const authority = await resolveMergerAuthority(
      db,
      review.countryId,
      gameState?.currentYear ?? null
    );
    if (!authority?.holderCharacterId)
      return NextResponse.json(
        { error: "The reviewing seat is vacant; this referral will resolve on its deadline." },
        { status: 409 }
      );

    const character = await db
      .collection<Character>("characters")
      .findOne(
        { userId: new ObjectId(auth.user.userId) },
        { projection: { _id: 1 } }
      );
    if (!character || !authority.holderCharacterId.equals(character._id))
      return NextResponse.json(
        { error: `Only the ${authority.seatName} can decide this referral.` },
        { status: 403 }
      );

    const currentTurn = await getCurrentTurn(db);
    const result = await decideMergerReview(db, {
      review,
      decision: parsed.data.decision,
      currentTurn,
      decidedByCharacterId: character._id,
      ...(parsed.data.note ? { decisionNote: parsed.data.note } : {}),
    });
    if (!result.ok)
      return NextResponse.json({ error: result.error }, { status: result.status });

    return NextResponse.json({
      success: true,
      status: result.review.status,
      remedySectorType: result.review.remedySectorType ?? null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
