/**
 * POST /api/unions/[id]/bargaining/[campaignId]/ratify — an organizer's ballot
 * on the settlement the president moved to accept. Same auth, feature gate and
 * rate-limit shape as the campaign action route next door.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { isLabourFullMode } from "@/lib/labour/featureFlag";
import { getDb } from "@/lib/mongodb";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { castRatificationBallot } from "@/lib/unions/commands/ratifySettlement";

const ballotSchema = z.object({ vote: z.enum(["ratify", "reject"]) });

interface RouteParams {
  params: Promise<{ id: string; campaignId: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    if (!(await isLabourFullMode())) {
      return errorResponse(403, "Player-run unions are not enabled.");
    }
    const rateLimit = checkRateLimit(auth.user.userId, 20, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const parsed = await parseJsonBody(request, ballotSchema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }
    const { id, campaignId } = await params;
    const db = await getDb();
    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character) return errorResponse(404, "Character not found");
    const result = await castRatificationBallot(
      db,
      character,
      id,
      campaignId,
      parsed.data.vote,
      await getCurrentTurn(db)
    );
    if (!result.ok) return errorResponse(result.status, result.error);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return handleRouteError(error);
  }
}
