import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { isLabourFullMode } from "@/lib/labour/featureFlag";
import { getDb } from "@/lib/mongodb";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { proposeBargainingCampaign } from "@/lib/unions/commands/bargaining";

const proposalSchema = z.object({
  employerCorporationId: z.string().min(1),
  wageLevel: z.number(),
  agreementDurationTurns: z.number().int(),
  noStrikeTurns: z.number().int(),
  // A8: optional, because an offer that says nothing about a pension is a
  // well-formed offer and every offer made before this shipped says nothing.
  pensionContributionRate: z.number().optional(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    if (!(await isLabourFullMode())) {
      return NextResponse.json({ error: "Player-run unions are not enabled." }, { status: 403 });
    }
    const rateLimit = checkRateLimit(auth.user.userId, 12, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const parsed = await parseJsonBody(request, proposalSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { id } = await params;
    const db = await getDb();
    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character) return NextResponse.json({ error: "Character not found" }, { status: 404 });
    const result = await proposeBargainingCampaign(
      db,
      character,
      id,
      parsed.data.employerCorporationId,
      parsed.data,
      await getCurrentTurn(db)
    );
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return handleRouteError(error);
  }
}
