import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { withNoStore } from "@/lib/api/withNoStore";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { getGameTime } from "@/lib/time/gameTime";
import { getConferenceState } from "@/lib/uk/conference/conferenceCommands";
import { conferenceYearForTurn } from "@/lib/uk/conference/rules";

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

// GET /api/country/[code]/parties/[id]/conference — this year's conference
// status, deadlines, agenda, motions, platform and the viewer's permitted
// actions for the party hub. UK parties only; other countries have no
// conference lifecycle.
// Auth: requireAuthWithCharacter (capabilities are per-viewer).
// Errors: 400, 401, 403, 404, 429
// withNoStore: the body is per-viewer (capabilities, vote standing).
async function getHandler(_request: Request, { params }: RouteParams) {
  try {
    const { code, id: partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    if (countryId !== "UK") {
      return NextResponse.json({ error: "Party conferences are a UK mechanic" }, { status: 400 });
    }

    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;
    if (authResult.user.isBanned) {
      return NextResponse.json({ error: "Account is banned" }, { status: 403 });
    }
    const authUser = authResult.user;

    const limit = checkRateLimit(`conference:${authUser.userId}`, 30, 60000);
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);

    const db = await getDb();
    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    const gameTime = await getGameTime();
    const state = await getConferenceState(
      db,
      countryId,
      String(party.sequentialId),
      conferenceYearForTurn(gameTime.currentTurn),
      {
        _id: authUser.character._id,
        name: authUser.character.name,
        party: authUser.character.party,
      },
      gameTime.currentTurn,
      gameTime.effectiveNow
    );
    return NextResponse.json(state);
  } catch (error) {
    return handleRouteError(error);
  }
}

export const GET = withNoStore(getHandler);
