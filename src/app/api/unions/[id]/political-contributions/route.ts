/**
 * PATCH /api/unions/[id]/political-contributions: the union president sets
 * the share of remaining per-turn budget sent to organizers. Gated on
 * `labourSystemMode >= "full"`.
 *
 * Server clamps the rate into [0, 0.5]. The response echoes the stored rate
 * plus this turn's projected free cash flow and payout so the UI can show
 * the consequence without a second round trip.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { parseJsonBody } from "@/lib/api/validate";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { isLabourFullMode } from "@/lib/labour/featureFlag";
import { setUnionPoliticalContributions } from "@/lib/unions/commands/unionActions";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const politicalContributionsSchema = z.object({
  politicalContributionPct: z.number().finite("politicalContributionPct must be a finite number."),
});

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    if (!(await isLabourFullMode())) {
      return NextResponse.json({ error: "Player-run unions are not enabled." }, { status: 403 });
    }

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, politicalContributionsSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { id } = await params;
    const db = await getDb();
    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const result = await setUnionPoliticalContributions(
      db,
      character,
      id,
      parsed.data.politicalContributionPct
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const { ok: _ok, status: _status, ...payload } = result;
    return NextResponse.json({ success: true, ...payload });
  } catch (error) {
    return handleRouteError(error);
  }
}
