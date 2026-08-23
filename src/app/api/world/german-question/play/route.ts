import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { commitSettlementPlay } from "@/lib/settlement/commands/commitPlay";

const schema = z.object({
  actor: z.enum(["seat", "personal"]),
  /** Catalogue key. Bounded so a junk body never reaches the command. */
  playId: z.string().min(1).max(64),
  /**
   * Personal plays only. A seat play's direction is its country's live bloc and
   * is derived server-side; anything sent here for one is ignored, never
   * honoured.
   */
  direction: z.union([z.literal(1), z.literal(-1)]).optional(),
});

// POST /api/world/german-question/play - Commit one play against the German Question.
// Auth: requireHumanSessionWithCharacter
// Errors: 400, 401, 403, 404, 409, 413, 429
//
// No 402: a play is never refused for want of money. `treasuryBalance` is the
// signed national cash position, so spending past zero is national debt, which
// `spendFromTreasury` models rather than blocks.
//
// `requireHumanSessionWithCharacter` rather than `requireAuthWithCharacter`:
// this route spends a NATIONAL TREASURY, so it needs the same-origin assertion
// (a plain cookie guard would let a cross-origin POST commit plays) and the
// bot-token rejection that the comparable `/api/actions/execute` uses.
export async function POST(request: Request) {
  try {
    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;

    // Budgets already cap what a play can DO, so this exists to bound the read
    // amplification of hammering the endpoint with requests that get refused.
    // Well above any legitimate rate: a seat has at most 3 actions a turn.
    const limited = checkRateLimit(auth.user.userId, 20, 60_000);
    if (!limited.ok) return rateLimitResponse(limited.retryAfter);

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const result = await commitSettlementPlay(db, {
      // The ACTING character is the authenticated one. A `characterId` in the
      // body is ignored — accepting one would let any player spend another
      // player's actions and another nation's treasury.
      characterId: auth.user.character._id,
      actor: parsed.data.actor,
      playId: parsed.data.playId,
      direction: parsed.data.direction,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({
      success: true,
      playId: result.playId,
      appliedDirection: result.appliedDirection,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
