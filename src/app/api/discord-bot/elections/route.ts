import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { logBotApiRequest, requireBotApiAccess } from "@/lib/api/botApiAuth";
import { checkRateLimit, rateLimitResponse, BOT_READ_LIMITS } from "@/lib/api/rateLimit";
import { getEnabledCountryIds } from "@/lib/countryAccess";
import type { Election, ElectionCandidate, PoliticalParty } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

// GET /api/discord-bot/elections — Returns active and upcoming elections with candidate lists, optionally filtered by country or state.
// Auth: requireAdminOrApiKey
// Errors: 401
export async function GET(request: Request) {
  try {
    const auth = await requireBotApiAccess(request, "campaign");
    if (!auth.ok) {
      await logBotApiRequest({
        keyId: "unknown",
        source: "env",
        scope: "campaign",
        method: "GET",
        path: "/api/discord-bot/elections",
        status: 401,
      });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(
      "discord-bot:elections",
      BOT_READ_LIMITS.maxRequests,
      BOT_READ_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const enabledCountries = await getEnabledCountryIds();

    const url = new URL(request.url);
    const country = url.searchParams.get("country");
    const state = url.searchParams.get("state");

    const query: Record<string, unknown> = { status: { $in: ["upcoming", "active"] } };
    if (country) {
      // Validate the requested country is enabled
      if (!enabledCountries.includes(country as CountryId)) {
        return NextResponse.json({ found: false, elections: [] });
      }
      query.countryId = country;
    } else {
      query.countryId = { $in: enabledCountries };
    }
    if (state) query.state = state;

    const db = await getDb();

    const elections = await db
      .collection<Election>("elections")
      .find(query)
      .sort({ endTime: 1 })
      .limit(20)
      .toArray();

    if (elections.length === 0) {
      await logBotApiRequest({
        keyId: auth.keyId,
        source: auth.source,
        scope: auth.scope,
        method: "GET",
        path: "/api/discord-bot/elections",
        status: 200,
      });
      return NextResponse.json({ found: false, elections: [] });
    }

    const electionIds = elections.map((e) => e._id);
    const candidates = await db
      .collection<ElectionCandidate>("electionCandidates")
      .find({ electionId: { $in: electionIds }, status: "active" })
      .toArray();

    // Use composite keys (countryId:sequentialId) to avoid cross-country collisions
    const partySeqIds = [...new Set(candidates.map((c) => c.party))].map(Number).filter(Boolean);
    const electionCountryIds = [...new Set(elections.map((e) => e.countryId ?? "US"))];
    const parties = await db
      .collection<PoliticalParty>("politicalParties")
      .find({ sequentialId: { $in: partySeqIds }, countryId: { $in: electionCountryIds } })
      .toArray();
    const partyMap = new Map(parties.map((p) => [`${p.countryId ?? "US"}:${p.sequentialId}`, p]));

    const candidatesByElection = new Map<string, ElectionCandidate[]>();
    for (const c of candidates) {
      const key = c.electionId.toString();
      if (!candidatesByElection.has(key)) candidatesByElection.set(key, []);
      candidatesByElection.get(key)!.push(c);
    }

    const results = elections.map((e) => {
      const electionCandidates = candidatesByElection.get(e._id.toString()) ?? [];
      const electionCountryId = e.countryId ?? "US";
      return {
        id: e._id.toString(),
        seatId: e.seatId ?? null,
        electionType: e.electionType,
        /*
         * No `electionLabel` here on purpose. Election display wants the RACE
         * name ("Commons", "House"), whereas the config's officeType label is
         * the OFFICE name ("Member of Parliament", "Representative") — emitting
         * it would regress every country's /elections output. Race naming stays
         * with the bot's formatElectionType map.
         *
         * `countryId` IS emitted: the bot needs it to disambiguate office keys
         * shared across countries (CN and RU both use `premier`) when picking a
         * race emoji.
         */
        countryId: electionCountryId,
        state: e.state,
        status: e.status,
        startTime: e.startTime?.toISOString() ?? null,
        endTime: e.endTime?.toISOString() ?? null,
        candidates: electionCandidates.map((c) => {
          const party = partyMap.get(`${electionCountryId}:${c.party}`);
          return {
            characterId: c.characterId.toString(),
            characterName: c.characterName,
            party: party?.name ?? (c.party === "independent" ? "Independent" : c.party),
            partyColor: party?.color ?? "#666666",
          };
        }),
      };
    });

    await logBotApiRequest({
      keyId: auth.keyId,
      source: auth.source,
      scope: auth.scope,
      method: "GET",
      path: "/api/discord-bot/elections",
      status: 200,
    });
    return NextResponse.json({ found: true, elections: results });
  } catch (error) {
    return handleRouteError(error);
  }
}
