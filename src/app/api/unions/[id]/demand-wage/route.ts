/**
 * POST /api/unions/[id]/demand-wage: the union president publishes (or
 * withdraws) a standing wage claim for the industry. Gated on
 * `labourSystemMode >= "full"`.
 *
 * This is a pressure signal, not a second bargaining system: the number is
 * only ever read for display (the per-local gap column on the union
 * dashboard, the wage-demand callout on a sector's CEO panel, and the
 * "demanding" counts on the union lists). Wage terms that actually bind an
 * employer go through a bargaining campaign.
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
import { setUnionWageDemand } from "@/lib/unions/commands/unionActions";

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

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    // Withdrawing the claim is `null`, which is a real value here rather than
    // "field omitted", so an absent/undefined field is a client error, not a
    // silent clear.
    const parsed = await parseJsonBody(
      request,
      z.object({
        demandedWageLevel: z
          .number()
          .finite({ message: "demandedWageLevel must be a number, or null to withdraw the claim." })
          .nullable(),
      })
    );
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const demandedWageLevel = parsed.data.demandedWageLevel;

    const { id } = await params;
    const db = await getDb();
    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const result = await setUnionWageDemand(db, character, id, demandedWageLevel);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return handleRouteError(error);
  }
}
