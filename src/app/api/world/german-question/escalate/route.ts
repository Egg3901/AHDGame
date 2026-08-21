import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { armSettlementLadder } from "@/lib/settlement/commands/armLadder";

// POST /api/world/german-question/escalate - Take the ladder to its top rung.
// Auth: requireHumanSessionWithCharacter
// Errors: 401, 403, 404, 409, 429
//
// Same guard as the play route: this arms a NATO–Warsaw Pact confrontation and
// starts a per-turn levy on four national treasuries, so it needs the
// same-origin assertion and the bot-token rejection, not just a session cookie.
// No body — the act takes no parameters, and the seat comes from the session.
export async function POST(request: Request) {
  try {
    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;

    // Tighter than the play route's 20: there is exactly one legitimate press
    // of this per crisis, and each attempt reads the actor context.
    const limited = checkRateLimit(`gq-escalate:${auth.user.userId}`, 5, 60_000);
    if (!limited.ok) return rateLimitResponse(limited.retryAfter);

    const db = await getDb();
    const result = await armSettlementLadder(db, auth.user.character._id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, heat: result.heat });
  } catch (error) {
    return handleRouteError(error);
  }
}
