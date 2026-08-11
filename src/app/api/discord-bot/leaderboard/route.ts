import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse, BOT_READ_LIMITS } from "@/lib/api/rateLimit";
import { getOfficeLabel } from "@/lib/utils/politics";
import { buildCharacterHref } from "@/lib/utils/profileUrls";
import { getEnabledCountryIds } from "@/lib/countryAccess";
import type { Character, User, PoliticalParty } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://ahousedividedgame.com";

// GET /api/discord-bot/leaderboard — Returns the top characters ranked by influence or favorability, with optional country filtering.
// Auth: requireAdminOrApiKey
// Errors: 401
export async function GET(request: Request) {
  try {
    if (!requireBotToken(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(
      "discord-bot:leaderboard",
      BOT_READ_LIMITS.maxRequests,
      BOT_READ_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const enabledCountries = await getEnabledCountryIds();

    const url = new URL(request.url);
    const country = url.searchParams.get("country");
    const metric = url.searchParams.get("metric") ?? "influence";
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "10", 10), 25);

    const sortFieldMap: Record<string, string> = {
      favorability: "favorability",
      nationalPoliticalInfluence: "nationalInfluence",
      actions: "actions",
      funds: "funds",
    };
    const sortField = sortFieldMap[metric] ?? "politicalInfluence";

    // Map input metric to the canonical response metric name the bot consumes
    const responseMetricMap: Record<string, string> = {
      favorability: "favorability",
      nationalPoliticalInfluence: "nationalPoliticalInfluence",
      actions: "actions",
      funds: "funds",
    };
    const responseMetric = responseMetricMap[metric] ?? "politicalInfluence";

    const db = await getDb();

    const query: Record<string, unknown> = {};
    if (country) {
      // Validate the requested country is enabled
      if (!enabledCountries.includes(country as CountryId)) {
        return NextResponse.json({ found: false, characters: [] });
      }
      query.countryId = country;
    } else {
      query.countryId = { $in: enabledCountries };
    }

    // Fetch extra to account for banned user filtering
    const characters = await db
      .collection<Character>("characters")
      .find(query)
      .sort({ [sortField]: -1 })
      .limit(limit * 2)
      .toArray();

    if (characters.length === 0) {
      return NextResponse.json({ found: false, characters: [] });
    }

    const userIds = characters.map((c) => c.userId);
    type UserProjection = Pick<User, "_id" | "isBanned">;
    const userDocs = await db
      .collection<UserProjection>("users")
      .find({ _id: { $in: userIds } })
      .project<UserProjection>({ _id: 1, isBanned: 1 })
      .toArray();
    const userMap = new Map((userDocs as UserProjection[]).map((u) => [u._id!.toString(), u]));

    // Build party lookups with countryId to handle same sequentialId in different countries
    const partyLookups: { countryId: CountryId; sequentialId: number }[] = [];
    for (const c of characters) {
      if (c.party && c.party !== "independent") {
        const seqId = Number(c.party);
        if (!isNaN(seqId)) {
          partyLookups.push({
            countryId: (c.countryId ?? "US") as CountryId,
            sequentialId: seqId,
          });
        }
      }
    }
    const parties =
      partyLookups.length > 0
        ? await db
            .collection<PoliticalParty>("politicalParties")
            .find({
              $or: partyLookups.map((l) => ({
                countryId: l.countryId,
                sequentialId: l.sequentialId,
              })),
            })
            .toArray()
        : [];
    // Key by countryId:sequentialId
    const partyMap = new Map(parties.map((p) => [`${p.countryId}:${p.sequentialId}`, p]));

    const results = characters
      .filter((char) => !userMap.get(char.userId.toString())?.isBanned)
      .slice(0, limit)
      .map((char, index) => {
        const charCountryId = char.countryId ?? "US";
        const party = partyMap.get(`${charCountryId}:${char.party}`);
        // Fallback to "Independent" if party not found (avoid numeric party names)
        const partyName =
          party?.name ?? (char.party === "independent" ? "Independent" : "Independent");
        return {
          rank: index + 1,
          id: char._id.toString(),
          name: char.name,
          party: partyName,
          partyColor: party?.color ?? "#666666",
          stateCode: char.homeState,
          position: getOfficeLabel(char.currentOffice),
          politicalInfluence: char.politicalInfluence ?? 0,
          nationalPoliticalInfluence: char.nationalInfluence ?? 0,
          favorability: char.favorability ?? 50,
          actions: char.actions ?? 0,
          funds: char.funds ?? 0,
          profileUrl: `${BASE_URL}${buildCharacterHref(char)}`,
        };
      });

    return NextResponse.json({ found: true, metric: responseMetric, characters: results });
  } catch (error) {
    return handleRouteError(error);
  }
}
