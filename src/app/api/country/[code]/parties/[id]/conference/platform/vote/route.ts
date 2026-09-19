import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { withNoStore } from "@/lib/api/withNoStore";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { isSameCountry } from "@/lib/api/sameCountry";
import { getGameTime } from "@/lib/time/gameTime";
import { voteOnPlatform } from "@/lib/uk/conference/conferenceCommands";

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

const voteSchema = z.object({
  vote: z.enum(["aye", "nay"]),
});

// POST /api/country/[code]/parties/[id]/conference/platform/vote — cast (or
// change) a platform vote. Aye ratifies, nay rejects. Party members only.
// Auth: requireAuthWithCharacter; party member.
// Errors: 400, 401, 403, 404, 429
async function postHandler(request: Request, { params }: RouteParams) {
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

    const parsed = await parseJsonBody(request, voteSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }
    if (authUser.character.party !== partyId || !isSameCountry(authUser.character, party)) {
      return NextResponse.json(
        { error: "You must be a member of this party to vote at its conference" },
        { status: 403 }
      );
    }

    const gameTime = await getGameTime();
    const result = await voteOnPlatform(
      db,
      countryId,
      String(party.sequentialId),
      {
        _id: authUser.character._id,
        name: authUser.character.name,
        party: authUser.character.party,
      },
      parsed.data.vote,
      gameTime.currentTurn,
      gameTime.effectiveNow
    );
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error);
  }
}

export const POST = withNoStore(postHandler);
