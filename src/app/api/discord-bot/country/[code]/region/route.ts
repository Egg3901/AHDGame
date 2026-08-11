import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse, BOT_READ_LIMITS } from "@/lib/api/rateLimit";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

import type { State, ElectedOfficial, PoliticalParty } from "@/lib/db/types";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://ahousedividedgame.com";

// GET /api/discord-bot/country/[code]/region — Returns region/state info and current officials for the given country and region code.
// Auth: requireAdminOrApiKey
// Errors: 400, 401, 404
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    if (!requireBotToken(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(
      "discord-bot:region",
      BOT_READ_LIMITS.maxRequests,
      BOT_READ_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 404 });
    }

    const url = new URL(request.url);
    const regionCode = url.searchParams.get("id");

    if (!regionCode) {
      return NextResponse.json({ error: "Must provide id" }, { status: 400 });
    }

    const stateId = regionCode.toUpperCase();

    const db = await getDb();

    const [state, officials] = await Promise.all([
      db.collection<State>("states").findOne({ _id: stateId, countryId }),
      db.collection<ElectedOfficial>("electedOfficials").find({ state: stateId }).toArray(),
    ]);

    if (!state) {
      return NextResponse.json({ found: false });
    }

    // Filter parties by country to avoid cross-country collisions
    const partyIds = [
      ...new Set(officials.map((o) => o.party).filter((p): p is string => Boolean(p))),
    ];
    const partySeqIds = partyIds.map(Number).filter(Boolean);
    const parties = await db
      .collection<PoliticalParty>("politicalParties")
      .find({ sequentialId: { $in: partySeqIds }, countryId })
      .toArray();
    const partyMap = new Map(parties.map((p) => [String(p.sequentialId), p]));

    return NextResponse.json({
      found: true,
      state: {
        id: state._id,
        name: state.name,
        region: state.region,
        population: state.population,
        votingSystem: state.votingSystem ?? "fptp",
        stateUrl: `${BASE_URL}/state/${state._id}`,
        officials: officials.map((o) => {
          const party = o.party ? partyMap.get(o.party) : null;
          return {
            officeType: o.officeType,
            characterId: o.characterId?.toString() ?? null,
            characterName: o.characterName ?? null,
            party: party?.name ?? (o.party === "independent" ? "Independent" : (o.party ?? null)),
            partyColor: party?.color ?? "#666666",
            isNPP: o.isNPP ?? false,
          };
        }),
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
