import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { retargetOppositionResearch } from "@/lib/campaigns/commands/campaignCommands";

const retargetSchema = z.object({
  targetId: schemas.objectId,
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/campaigns/[id]/retarget — Sets a new opposition research target for a campaign, subject to cooldown.
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id: campaignId } = await params;

    if (!ObjectId.isValid(campaignId)) {
      return errorResponse(400, "Invalid campaign ID");
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const user = auth.user;

    const parsed = await parseJsonBody(request, retargetSchema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }
    const { targetId } = parsed.data;

    const db = await getDb();
    const result = await retargetOppositionResearch({
      db,
      campaignId: new ObjectId(campaignId),
      user,
      targetId,
    });
    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
