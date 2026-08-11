import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse, BOT_READ_LIMITS } from "@/lib/api/rateLimit";
import { getOfficeLabel } from "@/lib/utils/politics";
import { buildCharacterHref } from "@/lib/utils/profileUrls";
import { partyUrl } from "@/lib/urls";
import { getEnabledCountryIds } from "@/lib/countryAccess";
import type { PoliticalParty, Character } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://ahousedividedgame.com";

// GET /api/discord-bot/party — Returns party details and top members by influence, looked up by sequential ID and country.
// Auth: requireAdminOrApiKey
// Errors: 400, 401
export async function GET(request: Request) {
  try {
    if (!requireBotToken(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(
      "discord-bot:party",
      BOT_READ_LIMITS.maxRequests,
      BOT_READ_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const enabledCountries = await getEnabledCountryIds();

    const url = new URL(request.url);
    const partyId = url.searchParams.get("id");
    const country = url.searchParams.get("country")?.toUpperCase() || "US";

    if (!partyId) {
      return NextResponse.json({ error: "Must provide id" }, { status: 400 });
    }

    // Validate the requested country is enabled
    if (!enabledCountries.includes(country as CountryId)) {
      return NextResponse.json({ found: false });
    }

    const db = await getDb();

    const party = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ sequentialId: Number(partyId), countryId: country as CountryId });

    if (!party) {
      return NextResponse.json({ found: false });
    }

    const partySeqStr = String(party.sequentialId);

    // Top 5 members by influence + chair name in parallel
    // Filter by both party sequentialId AND countryId to avoid cross-country matches
    const [topMembers, chairDoc] = await Promise.all([
      db
        .collection<Character>("characters")
        .find({ party: partySeqStr, countryId: country as CountryId })
        .sort({ politicalInfluence: -1 })
        .limit(5)
        .toArray(),
      party.chairId
        ? db
            .collection<Pick<Character, "_id" | "name">>("characters")
            .findOne({ _id: party.chairId }, { projection: { name: 1 } })
        : Promise.resolve(null),
    ]);

    return NextResponse.json({
      found: true,
      party: {
        id: party._id,
        name: party.name,
        abbreviation: party.abbreviation,
        color: party.color,
        economicPosition: party.economicPosition,
        socialPosition: party.socialPosition,
        memberCount: party.memberCount,
        treasury: party.treasury,
        chairName: chairDoc?.name ?? null,
        partyUrl: `${BASE_URL}${partyUrl(country, party.sequentialId)}`,
        topMembers: topMembers.map((c) => ({
          id: c._id.toString(),
          name: c.name,
          position: getOfficeLabel(c.currentOffice),
          politicalInfluence: c.politicalInfluence ?? 0,
          profileUrl: `${BASE_URL}${buildCharacterHref(c)}`,
        })),
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
