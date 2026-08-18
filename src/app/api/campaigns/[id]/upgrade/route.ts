import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { upgradeCampaign } from "@/lib/campaigns/commands/campaignCommands";

const upgradeSchema = z.object({
  category: z.enum(["fundraising", "oppositionResearch", "groundGame", "mediaSpending"]),
  // Strategic Operations v2: `branch` selects which sub-track to level. Omit it
  // (or send null) to buy the lever's tier-1 starter unlock.
  branch: z.enum(["a", "b", "c"]).nullish(),
  targetId: z.string().optional(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/campaigns/[id]/upgrade — Upgrades a campaign capability (fundraising, oppositionResearch, groundGame, mediaSpending).
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 409, 429
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
    const user = auth.user;

    const parsed = await parseJsonBody(request, upgradeSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { category, branch, targetId } = parsed.data;

    if (targetId && !ObjectId.isValid(targetId)) {
      return NextResponse.json({ error: "Invalid target ID" }, { status: 400 });
    }

    const db = await getDb();
    const campaign = await upgradeCampaign({
      db,
      campaignId: new ObjectId(campaignId),
      user,
      category,
      branch: branch ?? null,
      targetId,
    });
    return NextResponse.json({
      success: true,
      campaign,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
