import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { draftCharterSchema } from "@/lib/api/schemas/charters";
import { handleRouteError } from "@/lib/api/errors";
import type { PoliticalParty, Character, StatePartyOrg } from "@/lib/db/types";
import { resolvePartyTier } from "@/lib/parties/partyTier";
import { ObjectId } from "mongodb";
import { getPartyHex } from "@/lib/utils/politics";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { draftCharter } from "@/lib/charters/draftCharter";

// GET /api/country/[code]/parties — Return all political parties in the country with member counts and leadership
// Auth: public
// Errors: 400
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const db = await getDb();
    const { searchParams } = new URL(request.url);
    const includeOrg = searchParams.get("includeOrg") === "1";

    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    // Exclude defunct (merged-away) parties — their tombstone row is retained
    // for redirect/history (`mergedIntoPartyId`) but must not appear as an
    // active, joinable, or merge-targetable party in the country listing.
    const partyFilter = { countryId, isDefunct: { $ne: true } };

    const parties = await db
      .collection<PoliticalParty>("politicalParties")
      .find(partyFilter)
      .sort({ isDefault: -1, name: 1 })
      .toArray();

    const partyIdStrings = parties.map((p) => String(p.sequentialId));

    // Get character names for leadership positions
    const leaderIds = parties
      .flatMap((p) => [p.chairId, p.viceChairId, p.treasurerId])
      .filter((id): id is ObjectId => id !== null);

    // Live member counts: players (non-banned) and NPPs, aggregated per party
    const orgAggPromise = includeOrg
      ? db
          .collection<StatePartyOrg>("statePartyOrg")
          .aggregate<{ _id: string; totalOrg: number }>([
            {
              $match: {
                countryId,
                partyId: { $in: partyIdStrings },
                organization: { $gt: 0 },
              },
            },
            { $group: { _id: "$partyId", totalOrg: { $sum: "$organization" } } },
          ])
          .toArray()
      : Promise.resolve([]);

    const [leaders, bannedUserDocs, nppAgg, orgAgg, allCharsInParties] = await Promise.all([
      db
        .collection<Character>("characters")
        .find(
          { _id: { $in: leaderIds } },
          {
            projection: {
              _id: 1,
              sequentialId: 1,
              name: 1,
              avatarUrl: 1,
              borderKey: 1,
              tintColor: 1,
            },
          }
        )
        .toArray(),
      // fetch banned user IDs so we can exclude their characters
      db
        .collection("users")
        .find({ isBanned: true }, { projection: { _id: 1 } })
        .toArray(),
      db
        .collection("npps")
        .aggregate<{ _id: string; count: number }>([
          {
            $match: {
              party: { $in: partyIdStrings },
              retiredAt: null,
              // Filter by country — all NPPs have countryId post-migration
              countryId,
            },
          },
          { $group: { _id: "$party", count: { $sum: 1 } } },
        ])
        .toArray(),
      orgAggPromise,
      db
        .collection<Character>("characters")
        .find(
          { party: { $in: partyIdStrings }, countryId },
          { projection: { _id: 1, party: 1, userId: 1 } }
        )
        .toArray(),
    ]);

    // Build banned character set
    const bannedUserIds = new Set(bannedUserDocs.map((u: { _id: ObjectId }) => u._id.toString()));
    // Build accurate player counts excluding banned users
    const playerCountMap = new Map<string, number>();
    for (const char of allCharsInParties) {
      if (bannedUserIds.has(char.userId.toString())) continue;
      playerCountMap.set(char.party, (playerCountMap.get(char.party) ?? 0) + 1);
    }

    const nppCountMap = new Map(nppAgg.map((r) => [r._id, r.count]));

    const leaderMap = new Map(
      leaders.map((l) => [
        l._id.toString(),
        {
          id: l._id.toString(),
          sequentialId: l.sequentialId,
          name: l.name,
          avatarUrl: l.avatarUrl,
          borderKey: l.borderKey,
          tintColor: l.tintColor,
        },
      ])
    );

    // Format response
    const formattedParties = parties.map((party) => {
      const partyIdStr = String(party.sequentialId);
      const playerCount = playerCountMap.get(partyIdStr) ?? 0;
      const nppCount = nppCountMap.get(partyIdStr) ?? 0;
      return {
        id: partyIdStr,
        // Mongo _id as a 24-char hex string. The merge-proposal form sends
        // this as `targetPartyId` (schemas.objectId). Dropped during the
        // charters Phase-6 route rewrite (6c316287c); restoring it fixes the
        // "targetPartyId: expected string, received undefined" merge error.
        objectId: party._id.toString(),
        sequentialId: party.sequentialId,
        countryId: party.countryId,
        name: party.name,
        abbreviation: party.abbreviation,
        color: getPartyHex(partyIdStr, party.color),
        discordInviteUrl: party.discordInviteUrl ?? null,
        economicPosition: party.economicPosition,
        socialPosition: party.socialPosition,
        chair: party.chairId ? leaderMap.get(party.chairId.toString()) || null : null,
        viceChair: party.viceChairId ? leaderMap.get(party.viceChairId.toString()) || null : null,
        treasurer: party.treasurerId ? leaderMap.get(party.treasurerId.toString()) || null : null,
        treasury: party.treasury ?? 0,
        memberCount: playerCount + nppCount,
        playerCount,
        nppCount,
        isDefault: party.isDefault,
        tier: resolvePartyTier(party),
        regimeStatus: party.regimeStatus ?? null,
        createdAt: party.createdAt.toISOString(),
      };
    });

    if (!includeOrg) {
      return NextResponse.json({ parties: formattedParties });
    }

    const orgMap = new Map(orgAgg.map((row) => [row._id, row.totalOrg]));
    const orgParties = parties
      .map((party) => {
        const id = String(party.sequentialId);
        return {
          id,
          name: party.name,
          abbreviation: party.abbreviation,
          color: getPartyHex(id, party.color),
          totalOrg: orgMap.get(id) ?? 0,
        };
      })
      .filter((party) => party.totalOrg > 0)
      .sort((a, b) => b.totalOrg - a.totalOrg);

    return NextResponse.json({ parties: formattedParties, orgParties });
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/country/[code]/parties — Phase 6 D6: redirected to charter draft creation.
//
// Players can no longer create a party row directly. They submit a charter
// draft (3 founder userIds + 4-axis platform), and the party only spawns
// once 3-of-3 founders sign. The response redirects callers to
// `/charters/[id]` for the signing flow.
//
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 429
export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;

    const rateLimit = checkRateLimit(`charter-draft:${authResult.user.userId}`, 5, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, draftCharterSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { name, abbreviation, platform, foundersCharacterIds, foundingCohort } = parsed.data;

    // Cross-check character country matches the URL country.
    if (authResult.user.character.countryId !== countryId) {
      return NextResponse.json(
        { error: "You can only charter a party in your own country" },
        { status: 403 }
      );
    }

    const db = await getDb();
    const proposerCharacterId = authResult.user.character._id;
    const founderObjectIds = foundersCharacterIds.map((id) => new ObjectId(id));

    const result = await draftCharter(
      {
        countryId,
        proposedName: name,
        proposedAbbr: abbreviation,
        platform,
        foundersCharacterIds: founderObjectIds,
        proposedBy: proposerCharacterId,
        foundingCohort,
      },
      db
    );

    if (!result.ok) {
      const message =
        result.reason === "founders-not-3"
          ? "Exactly 3 founders required"
          : result.reason === "founders-not-unique"
            ? "Founders must be 3 distinct characters"
            : result.reason === "proposer-not-founder"
              ? "Proposer must be one of the founders"
              : result.reason === "founder-not-found"
                ? "One of the founders refers to a character that doesn't exist"
                : result.reason === "founder-not-human"
                  ? "All founders must be human-owned characters"
                  : result.reason === "founder-wrong-country"
                    ? "All founders must belong to the same country as this charter"
                    : result.reason === "founder-not-adjacent"
                      ? "Co-founders must live in your home state or a state adjacent to it"
                      : result.reason === "name-taken"
                        ? "A party or active charter already uses this name"
                        : result.reason === "cohort-state-not-adjacent"
                          ? "Founding-cohort states must be your home state or adjacent to it"
                          : "A party or active charter already uses this abbreviation";
      return NextResponse.json({ error: message, reason: result.reason }, { status: 400 });
    }

    return NextResponse.json(
      {
        ok: true,
        charterId: result.charterId.toString(),
        redirectTo: `/charters/${result.charterId.toString()}`,
      },
      { status: 201 }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
