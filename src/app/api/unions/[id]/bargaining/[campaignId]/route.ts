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
import { actOnBargainingCampaignAsUnion } from "@/lib/unions/commands/bargaining";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept") }),
  z.object({
    action: z.literal("counter"),
    wageLevel: z.number(),
    agreementDurationTurns: z.number().int(),
    noStrikeTurns: z.number().int(),
    // A8: optional, because an offer that says nothing about a pension is a
    // well-formed offer and every offer made before this shipped says nothing.
    pensionContributionRate: z.number().optional(),
  }),
  z.object({ action: z.literal("withdraw") }),
  z.object({ action: z.literal("escalate") }),
  z.object({ action: z.literal("request_mediation") }),
  z.object({ action: z.literal("accept_mediation") }),
  z.object({ action: z.literal("reject_mediation") }),
]);

interface RouteParams {
  params: Promise<{ id: string; campaignId: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    if (!(await isLabourFullMode())) {
      return NextResponse.json({ error: "Player-run unions are not enabled." }, { status: 403 });
    }
    const rateLimit = checkRateLimit(auth.user.userId, 20, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const parsed = await parseJsonBody(request, actionSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { id, campaignId } = await params;
    const db = await getDb();
    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character) return NextResponse.json({ error: "Character not found" }, { status: 404 });
    const terms = parsed.data.action === "counter" ? parsed.data : undefined;
    const result = await actOnBargainingCampaignAsUnion(
      db,
      character,
      id,
      campaignId,
      parsed.data.action,
      await getCurrentTurn(db),
      terms
    );
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return handleRouteError(error);
  }
}
