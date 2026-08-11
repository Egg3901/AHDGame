/**
 * POST /api/country/[code]/fomc/vote — a seated player board member casts their
 * ballot (hike / cut / hold) on the bank's active FOMC meeting. If the ballot
 * gives the motion a full-board majority (or makes one impossible) the meeting
 * resolves immediately, ahead of the 24h window.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getCentralBankScope } from "@/lib/centralBank/helpers";
import { getGameState } from "@/lib/gameState";
import { castFomcBallot } from "@/lib/turn/fomcMeetingTurn";

interface RouteContext {
  params: Promise<{ code: string }>;
}

const schema = z.object({ vote: z.enum(["hike", "cut", "hold"]) });

export async function POST(request: Request, context: RouteContext) {
  try {
    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;
    const auth = authResult.user;

    const rateLimit = checkRateLimit(`fomc-vote:${auth.userId}`, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { code } = await context.params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId])
      return NextResponse.json(notFound("Country not found").toJson(), { status: 404 });

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const db = await getDb();
    const { bankId } = await getCentralBankScope(db, countryId);
    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 0;

    const outcome = await castFomcBallot(
      db,
      bankId,
      auth.character._id,
      parsed.data.vote,
      currentTurn,
      new Date()
    );

    if (!outcome.ok) {
      if (outcome.reason === "not-seated")
        return NextResponse.json(forbidden("You do not hold a seat on this committee").toJson(), {
          status: 403,
        });
      const msg =
        outcome.reason === "no-meeting"
          ? "No FOMC meeting is currently taking votes"
          : "You have already voted in this meeting";
      return NextResponse.json(badRequest(msg).toJson(), { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      motion: outcome.motion,
      resolved: outcome.resolved,
      rateChanged: outcome.moved,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
