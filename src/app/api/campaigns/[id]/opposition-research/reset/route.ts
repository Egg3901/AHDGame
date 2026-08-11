import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { ObjectId } from "mongodb";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { resetOppositionResearch } from "@/lib/campaigns/commands/campaignCommands";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/campaigns/[id]/opposition-research/reset — Resets the campaign's opposition research level to 0, clears the target, and clears the retarget cooldown. Spent funds/actions are not refunded; an activity-log entry is pushed with reason "reset".
// Auth: requireAuthWithCharacter (admin OR campaign manager OR owner of any character that is the candidate)
// Errors: 400, 401, 403, 404, 429
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { id: campaignId } = await params;

    if (!ObjectId.isValid(campaignId)) {
      return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const user = auth.user;

    const db = await getDb();
    await resetOppositionResearch({
      db,
      campaignId: new ObjectId(campaignId),
      user,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
