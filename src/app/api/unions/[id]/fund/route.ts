/**
 * POST /api/unions/[id]/fund: the union president moves personal cash into the
 * treasury of the union they lead. Gated on `labourSystemMode >= "full"`.
 *
 * Answers player tickets #1121 ("how do I send money to a union") and #1112
 * ("what is the treasury and how do I get more of it"): before this, dues were
 * the only inflow, so a newly founded union with an empty treasury could not
 * afford the drive it needed to win the members that dues are charged on.
 *
 * Head-only, see `fundUnionTreasury` for why an open donation channel is not
 * the shape we want.
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
import { fundUnionTreasury } from "@/lib/unions/commands/fundUnionTreasury";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const fundSchema = z.object({
  amount: z.number().finite("amount must be a finite number.").positive(),
});

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    if (!(await isLabourFullMode())) {
      return NextResponse.json({ error: "Player-run unions are not enabled." }, { status: 403 });
    }

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, fundSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { id } = await params;
    const db = await getDb();
    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const result = await fundUnionTreasury(db, character, id, parsed.data.amount);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const { ok: _ok, status: _status, ...payload } = result;
    return NextResponse.json({ success: true, ...payload });
  } catch (error) {
    return handleRouteError(error);
  }
}
