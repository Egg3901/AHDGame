import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { appointCampaignManager } from "@/lib/campaigns/commands/campaignCommands";

const schema = z.object({
  /** Character ObjectId to appoint as manager; null clears the appointment. */
  managerCharacterId: z.union([schemas.objectId, z.null()]),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/campaigns/[id]/manager — Appoint or clear the campaign manager. The appointed character's owning user becomes campaign manager (managerId). Nominee or admin only.
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rate = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rate.ok) return rateLimitResponse(rate.retryAfter);

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { managerCharacterId } = parsed.data;

    const db = await getDb();
    const result = await appointCampaignManager({
      db,
      campaignId: new ObjectId(id),
      user: auth.user,
      managerCharacterId,
    });
    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
