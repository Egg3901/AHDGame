import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { setRallyTourActive } from "@/lib/campaigns/commands/campaignCommands";

const rallyTourSchema = z.object({
  active: z.boolean(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/campaigns/[id]/rally-tour — Toggle the ongoing rally tour
// for the campaign's candidate. While active, the per-turn campaign
// processor queues a fresh rally event each turn (60%/40% split same
// as one-shot). Stopping leaves the trailing accrual intact.
// Auth: requireAuthWithCharacter (must be campaign manager or nominee)
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id: campaignId } = await params;

    if (!ObjectId.isValid(campaignId)) {
      return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const user = auth.user;

    const parsed = await parseJsonBody(request, rallyTourSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const result = await setRallyTourActive({
      db,
      campaignId: new ObjectId(campaignId),
      user,
      active: parsed.data.active,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return handleRouteError(error);
  }
}
