import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";

// Maps CountryId to the ISO 3166-1 numeric code used by the world map
const COUNTRY_TO_ISO: Record<string, string> = {
  US: "840",
  UK: "826",
  DE: "276",
  JP: "392",
};

// GET /api/world/parties — Returns the dominant political party per country keyed by ISO numeric code for the world map.
// Auth: public
// Errors: 400
export async function GET() {
  try {
    const db = await getDb();

    // Get all banned user IDs
    const bannedUsers = await db
      .collection("users")
      .find({ isBanned: true }, { projection: { _id: 1 } })
      .toArray();
    const bannedUserIds = new Set(bannedUsers.map((u) => u._id.toString()));

    // Aggregate character counts by countryId + party, excluding banned users
    const counts = await db
      .collection("characters")
      .aggregate<{ _id: { countryId: string; party: string }; userIds: ObjectId[] }>([
        { $match: { party: { $exists: true, $ne: null } } },
        {
          $group: {
            _id: { countryId: "$countryId", party: "$party" },
            userIds: { $addToSet: "$userId" },
          },
        },
      ])
      .toArray();

    // Filter out banned users and recount
    const cleanCounts: Record<string, Record<string, number>> = {};
    for (const entry of counts) {
      const { countryId, party } = entry._id;
      if (!countryId || !party) continue;
      const activeCount = entry.userIds.filter((id) => !bannedUserIds.has(id.toString())).length;
      if (activeCount === 0) continue;
      if (!cleanCounts[countryId]) cleanCounts[countryId] = {};
      cleanCounts[countryId][party] = (cleanCounts[countryId][party] ?? 0) + activeCount;
    }

    // Find dominant party per country
    const dominantPartyIds: Record<string, { partyId: string; count: number }> = {};
    for (const [countryId, partyCounts] of Object.entries(cleanCounts)) {
      let topParty = "";
      let topCount = 0;
      for (const [partyId, count] of Object.entries(partyCounts)) {
        if (count > topCount) {
          topCount = count;
          topParty = partyId;
        }
      }
      if (topParty) dominantPartyIds[countryId] = { partyId: topParty, count: topCount };
    }

    if (Object.keys(dominantPartyIds).length === 0) {
      const response = NextResponse.json({});
      response.headers.set(
        "Cache-Control",
        "public, s-maxage=120, stale-while-revalidate=300, no-transform"
      );
      return response;
    }

    // Fetch party details for each dominant party. Parties are uniquely identified
    // by (sequentialId, countryId) — partyId values aggregated above are
    // sequentialId strings, possibly colliding across countries.
    const partyLookupPairs = Object.entries(dominantPartyIds)
      .map(([countryId, { partyId }]) => ({ countryId, sequentialId: Number(partyId) }))
      .filter((p) => Number.isFinite(p.sequentialId));

    const parties =
      partyLookupPairs.length > 0
        ? await db
            .collection<{
              countryId: string;
              sequentialId: number;
              name: string;
              color?: string;
            }>("politicalParties")
            .find(
              { $or: partyLookupPairs },
              { projection: { countryId: 1, sequentialId: 1, name: 1, color: 1 } }
            )
            .toArray()
        : [];

    const partyMap = new Map(parties.map((p) => [`${p.countryId}:${p.sequentialId}`, p]));

    // Build response keyed by ISO numeric country code
    const result: Record<string, { partyName: string; partyColor: string; count: number }> = {};
    for (const [countryId, { partyId, count }] of Object.entries(dominantPartyIds)) {
      const isoCode = COUNTRY_TO_ISO[countryId];
      if (!isoCode) continue;
      const party = partyMap.get(`${countryId}:${partyId}`);
      if (!party) continue;
      result[isoCode] = {
        partyName: party.name,
        partyColor: party.color ?? "#6b6b7a",
        count,
      };
    }

    const response = NextResponse.json(result);
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=120, stale-while-revalidate=300, no-transform"
    );
    return response;
  } catch (error) {
    return handleRouteError(error);
  }
}
