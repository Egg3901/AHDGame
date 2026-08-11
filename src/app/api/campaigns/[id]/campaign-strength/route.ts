import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { contributeCampaignStrength } from "@/lib/campaigns/commands/campaignCommands";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/campaigns/[id]/campaign-strength — Contribute campaign strength to a presidential campaign.
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id: campaignId } = await params;

    if (!ObjectId.isValid(campaignId)) {
      return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const db = await getDb();
    const result = await contributeCampaignStrength({
      db,
      campaignId: new ObjectId(campaignId),
      user: auth.user,
    });
    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
