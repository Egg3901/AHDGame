// POST /api/country/[code]/command-economy/repression
// Command Economy v2 (internal repression) — the government sets how hard it
// represses the second economy (0 none … 1 heavy). Higher repression forces the
// black market down (easing the marketization drift so the regime can resist
// reform) but burns regime legitimacy, and that cost climbs with the still-present
// shortage. Writes economicFactors.repressionDirective (the seam the turn engine
// honors: directive > NPP commandStance > default).
// Auth: the head of government or the Gosbank chair. Errors: 400/401/403/404/429.
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonBody } from "@/lib/api/validate";
import { forbidden, handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import type { FederalBudget } from "@/lib/db/types/budget";
import { INTERNAL_REPRESSION_RANGE, clampRange } from "@/lib/constants/commandEconomyOffices";
import { canSetRepression } from "@/lib/economy/commandEconomyAuth";
import { resolveWriteContext } from "@/lib/economy/queries/commandEconomyWriteContext";

interface RouteContext {
  params: Promise<{ code: string }>;
}

const schema = z.object({
  level: z.number().min(0).max(1),
});

export async function POST(request: Request, context: RouteContext) {
  try {
    const { code } = await context.params;
    const setup = await resolveWriteContext(code);
    if (!setup.ok) return setup.response;
    const { db, countryId, characterId, roles, currentTurn } = setup.ctx;

    if (!canSetRepression(roles)) {
      return NextResponse.json(
        forbidden(
          "Only the head of government or the Gosbank chair can set internal repression."
        ).toJson(),
        { status: 403 }
      );
    }

    const rate = checkRateLimit(String(characterId), 20, 60000);
    if (!rate.ok) return rateLimitResponse(rate.retryAfter);

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const set: Record<string, unknown> = {
      "economicFactors.repressionDirective.level": clampRange(
        parsed.data.level,
        INTERNAL_REPRESSION_RANGE
      ),
      "economicFactors.repressionDirective.setOnTurn": currentTurn,
      "economicFactors.repressionDirective.setByCharacterId": String(characterId),
    };

    await db
      .collection<FederalBudget>("federalBudget")
      .updateOne({ _id: getNationalBudgetId(countryId) } as { _id: "federal" }, { $set: set });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
