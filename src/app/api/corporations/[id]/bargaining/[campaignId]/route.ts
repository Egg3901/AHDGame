import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { isLabourFullMode } from "@/lib/labour/featureFlag";
import { getDb } from "@/lib/mongodb";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { actOnBargainingCampaignAsEmployer } from "@/lib/unions/commands/bargaining";

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
  z.object({ action: z.literal("reject") }),
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
    const terms = parsed.data.action === "counter" ? parsed.data : undefined;
    const result = await actOnBargainingCampaignAsEmployer(
      db,
      auth.user.userId,
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
