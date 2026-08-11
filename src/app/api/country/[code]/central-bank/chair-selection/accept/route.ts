import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError, forbidden, notFound } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { Character } from "@/lib/db/types";
import {
  acceptCentralBankChairSelection,
  CHAIR_TERM_TURNS,
} from "@/lib/turn/centralBankChairSelection";
import { getGameState } from "@/lib/gameState";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getCentralBankScope } from "@/lib/centralBank/helpers";

interface RouteContext {
  params: Promise<{ code: string }>;
}

// POST /api/country/[code]/central-bank/chair-selection/accept — Confirm pending CB chair appointment
// Auth: requireAuthWithCharacter
// Errors: 401, 403, 404, 429

export async function POST(_request: Request, context: RouteContext) {
  try {
    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;

    const rateLimit = checkRateLimit(authResult.user.userId, 15, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { code } = await context.params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId])
      return NextResponse.json(notFound("Country not found").toJson(), { status: 404 });

    const db = await getDb();
    const { memberCountries } = await getCentralBankScope(db, countryId);
    const authChar = authResult.user.character as Character;
    if (!memberCountries.includes(authChar.countryId as CountryId))
      return NextResponse.json(forbidden().toJson(), { status: 403 });
    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 0;

    const result = await acceptCentralBankChairSelection(
      db,
      countryId,
      authChar._id,
      new Date(),
      currentTurn
    );

    if (!result.ok) {
      const msg = result.error ?? "Cannot accept";
      if (msg.includes("not the pending")) {
        return NextResponse.json({ error: msg }, { status: 403 });
      }
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      chairTermExpiresAtTurn: currentTurn + CHAIR_TERM_TURNS,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
