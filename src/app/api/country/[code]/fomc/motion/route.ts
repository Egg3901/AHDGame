/**
 * POST /api/country/[code]/fomc/motion — a player chair tables the motion for
 * the active FOMC meeting (hike / cut / hold, with an optional size in points).
 * The committee still decides it by majority vote; NPP chairs keep the
 * automatic motion.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, badRequest, forbidden, notFound, errorResponse } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { resolveJurisdiction } from "@/lib/monetaryGovernance/jurisdiction";
import { getGameState } from "@/lib/gameState";
import { setFomcMotion } from "@/lib/turn/fomcMeetingTurn";

interface RouteContext {
  params: Promise<{ code: string }>;
}

const schema = z.object({
  motion: z.enum(["hike", "cut", "hold"]),
  delta: z.number().positive().max(25).optional(),
});

export async function POST(request: Request, context: RouteContext) {
  try {
    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;
    const auth = authResult.user;

    const rateLimit = checkRateLimit(`fomc-motion:${auth.userId}`, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { code } = await context.params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId])
      return NextResponse.json(notFound("Country not found").toJson(), { status: 404 });

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);

    const db = await getDb();
    const { institutionId: bankId } = await resolveJurisdiction(db, countryId);
    const gameState = await getGameState();

    const outcome = await setFomcMotion(
      db,
      bankId,
      auth.character._id,
      parsed.data.motion,
      parsed.data.delta,
      gameState?.currentTurn ?? 0,
      new Date(),
      gameState?.currentYear ?? null
    );

    if (!outcome.ok) {
      if (outcome.reason === "not-chair")
        return NextResponse.json(forbidden(outcome.message).toJson(), { status: 403 });
      return NextResponse.json(badRequest(outcome.message).toJson(), { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      motion: outcome.motion,
      proposedDelta: outcome.proposedDelta,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
