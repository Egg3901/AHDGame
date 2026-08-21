import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { declareSettlementWar } from "@/lib/settlement/commands/declareWar";

// POST /api/world/german-question/declare - Open the NATO-Warsaw Pact war.
// Auth: requireHumanSessionWithCharacter
// Errors: 401, 403, 404, 409, 429
//
// The most consequential button in the feature: it freezes the influence
// contest and puts a war on the board whose winner takes Germany. Same guard as
// the other two mutating routes — same-origin asserted, bot tokens rejected.
export async function POST(request: Request) {
  try {
    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;

    const limited = checkRateLimit(`gq-declare:${auth.user.userId}`, 5, 60_000);
    if (!limited.ok) return rateLimitResponse(limited.retryAfter);

    const db = await getDb();
    const result = await declareSettlementWar(db, auth.user.character._id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({
      success: true,
      conflictId: result.conflictId,
      conflictNumber: result.conflictNumber,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
