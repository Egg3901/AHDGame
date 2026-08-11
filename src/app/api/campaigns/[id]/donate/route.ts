import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { donateToCampaign } from "@/lib/campaigns/commands/campaignCommands";

const donateSchema = z.object({
  amount: z.number().int().min(1),
  partyId: z.string().regex(/^\d+$/).optional(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/campaigns/[id]/donate — Donates funds to a campaign from a character or party treasury.
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
    const user = auth.user;

    const parsed = await parseJsonBody(request, donateSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { amount, partyId } = parsed.data;

    const db = await getDb();
    await donateToCampaign({ db, campaignId: new ObjectId(campaignId), user, amount, partyId });
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
