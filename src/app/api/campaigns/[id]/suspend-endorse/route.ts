import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { suspendCampaignAndEndorse } from "@/lib/campaigns/commands/suspendEndorse";
import { z } from "zod";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/campaigns/[id]/suspend-endorse — Presidential general-election nominee
// suspends active campaigning and endorses another ticket. Transfers 25% of CS
// immediately (one-time), boosts endorsed vote math with 25% of suspender's
// per-state org each turn (no org debit). Suspender keeps existing votes but
// stops further accumulation.
// Auth: requireAuthWithCharacter (nominee only)
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id: campaignId } = await params;
    if (!ObjectId.isValid(campaignId)) {
      return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
    }

    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 5, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, z.object({ candidateId: schemas.objectId }));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const result = await suspendCampaignAndEndorse({
      db,
      campaignId: new ObjectId(campaignId),
      endorsedElectionCandidateId: new ObjectId(parsed.data.candidateId),
      user: auth.user,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return handleRouteError(error);
  }
}
