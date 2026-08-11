import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { ObjectId } from "mongodb";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { fireRallyOneShot } from "@/lib/campaigns/commands/campaignCommands";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/campaigns/[id]/rally — Fire a one-shot rally event for the
// campaign's candidate. 60% of the race-family-scaled
// SUPPORT_RALLY_FULL_VALUE applies to candidate.support immediately;
// remaining 40% queues as a 4-turn drip via supportAccrual.
// Auth: requireAuthWithCharacter (must be campaign manager or nominee)
// Errors: 400, 401, 403, 404, 409, 429
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { id: campaignId } = await params;

    if (!ObjectId.isValid(campaignId)) {
      return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    // Tighter rate limit than upgrades — rallies are throttled to 1/turn
    // via lastRallyTurn, but request-level rate-limit prevents abuse.
    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const user = auth.user;

    const db = await getDb();
    const result = await fireRallyOneShot({
      db,
      campaignId: new ObjectId(campaignId),
      user,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return handleRouteError(error);
  }
}
