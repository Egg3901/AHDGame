import { NextResponse } from "next/server";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, badRequest, forbidden } from "@/lib/api/errors";
import { getNextSequentialId } from "@/lib/db/sequentialId";
import { escapeRegex } from "@/lib/utils/escapeRegex";
import { canActAsChair } from "@/lib/parties/actingChair";
import type { Coalition } from "@/lib/db/types/coalition";
import type { PoliticalParty } from "@/lib/db/types/party";
import type { Character } from "@/lib/db/types/character";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { canInviteToCoalition, isBannedParty } from "@/lib/turn/onePartyConstraints";
import { getCountryState } from "@/lib/countryState";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";

const createCoalitionSchema = z.object({
  name: z.string().min(3).max(60).trim(),
  abbreviation: z.string().min(2).max(10).trim(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color"),
});

// POST /api/coalitions — Create a new coalition
export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;

    const rateLimit = checkRateLimit(authResult.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const userData = authResult.user;
    const character = userData.character;

    const parsed = await parseJsonBody(request, createCoalitionSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { name, abbreviation, color } = parsed.data;

    const db = await getDb();
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    // Verify the character belongs to a party
    if (!character.party || character.party === "independent") {
      throw badRequest("You must be a member of a party to create a coalition.");
    }

    // Look up the character's party
    const party = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ sequentialId: Number(character.party), countryId });

    if (!party) {
      throw badRequest("Your party could not be found.");
    }

    // Chair authority — vice-chair may act when the chair seat is vacant.
    if (!canActAsChair(party, character._id)) {
      throw forbidden(
        "Only the national party chair (or acting vice-chair) can create a coalition."
      );
    }

    // One-party-state guard: in a one-party state, only the ruling party
    // may create a coalition, and banned parties cannot operate coalitions
    // at all. Reads runtime governmentType so a post-Stage-4 conversion
    // immediately lifts the coalition restriction.
    const runtime = await getCountryState(db, countryId);
    const runtimeConfig = { governmentType: runtime.governmentType };
    if (runtime.governmentType === "onePartyState") {
      if (isBannedParty(runtimeConfig, party)) {
        throw forbidden("Banned parties cannot create coalitions.");
      }
      if (!canInviteToCoalition(runtimeConfig, party)) {
        throw forbidden("Coalitions are not available to non-ruling parties in this country.");
      }
    }

    // Party must not already be in a coalition
    if (party.coalitionId) {
      throw badRequest("Your party is already a member of a coalition.");
    }

    // Character needs >= 25 actions
    if (character.actions < 25) {
      throw badRequest(`You need 25 actions to create a coalition. You have ${character.actions}.`);
    }

    // Coalition name must be unique within the country (case-insensitive)
    const existingCoalition = await db.collection<Coalition>("coalitions").findOne({
      countryId,
      name: { $regex: new RegExp(`^${escapeRegex(name)}$`, "i") },
    });

    if (existingCoalition) {
      throw badRequest("A coalition with this name already exists in your country.");
    }

    const now = new Date();
    const coalitionId = new ObjectId();
    const sequentialId = await getNextSequentialId(db, "coalition", countryId);

    // Atomic claim — match the acting-chair identity (either seated chair
    // or VC when chair is vacant) to mirror the upstream `canActAsChair`
    // check. Combined with the coalition-membership guard.
    const reservedParty = await db.collection<PoliticalParty>("politicalParties").findOneAndUpdate(
      {
        _id: party._id,
        countryId,
        $and: [
          {
            $or: [{ chairId: character._id }, { chairId: null, viceChairId: character._id }],
          },
          {
            $or: [{ coalitionId: null }, { coalitionId: { $exists: false } }],
          },
        ],
      },
      { $set: { coalitionId, updatedAt: now } },
      { returnDocument: "before" }
    );

    if (!reservedParty) {
      throw badRequest("Your party is already a member of a coalition.");
    }

    const actionDebit = await db
      .collection<Character>("characters")
      .updateOne(
        { _id: character._id, actions: { $gte: 25 } },
        { $inc: { actions: -25 }, $set: { updatedAt: now } }
      );

    if (actionDebit.matchedCount === 0) {
      await db
        .collection<PoliticalParty>("politicalParties")
        .updateOne(
          { _id: party._id, coalitionId },
          { $set: { coalitionId: null, updatedAt: now } }
        );
      throw badRequest(`You need 25 actions to create a coalition. You have ${character.actions}.`);
    }

    const newCoalition: Coalition = {
      _id: coalitionId,
      sequentialId,
      countryId,
      name,
      abbreviation,
      color,
      chairPartyId: party._id,
      chairCharacterId: character._id,
      members: [
        {
          partyId: party._id,
          partySequentialId: party.sequentialId,
          joinedAt: now,
        },
      ],
      pendingInvites: [],
      joinRequests: [],
      disbandVote: null,
      createdBy: character._id,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await db.collection<Coalition>("coalitions").insertOne(newCoalition);
    } catch (error) {
      await Promise.all([
        db
          .collection<PoliticalParty>("politicalParties")
          .updateOne(
            { _id: party._id, coalitionId },
            { $set: { coalitionId: null, updatedAt: now } }
          ),
        db
          .collection<Character>("characters")
          .updateOne({ _id: character._id }, { $inc: { actions: 25 }, $set: { updatedAt: now } }),
      ]);
      throw error;
    }

    return NextResponse.json({
      success: true,
      message: `${name} has been created! Your party is the founding member.`,
      coalitionId: coalitionId.toString(),
      sequentialId,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// GET /api/coalitions?country=us — List coalitions for a country
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code: getCode } = await params;
    const countryId = getCode.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const db = await getDb();

    const coalitions = await db
      .collection<Coalition>("coalitions")
      .find({ countryId })
      .sort({ createdAt: -1 })
      .toArray();

    if (coalitions.length === 0) {
      return NextResponse.json({ coalitions: [] });
    }

    // Collect all party IDs referenced in members
    const allPartyIds = coalitions.flatMap((c) => c.members.map((m) => m.partyId));
    const allChairCharacterIds = coalitions
      .map((c) => c.chairCharacterId)
      .filter((id): id is ObjectId => id !== null);

    // Fetch party details and chair character names in parallel
    const [parties, chairCharacters] = await Promise.all([
      db
        .collection<PoliticalParty>("politicalParties")
        .find({ _id: { $in: allPartyIds } })
        .toArray(),
      db
        .collection<Character>("characters")
        .find({ _id: { $in: allChairCharacterIds } }, { projection: { _id: 1, name: 1 } })
        .toArray(),
    ]);

    // Compute live member counts using party sequentialId (the field used on characters/NPPs)
    const partySeqIds = parties.map((p) => String(p.sequentialId));
    const [charCounts, nppCounts] = await Promise.all([
      db
        .collection<Character>("characters")
        .aggregate<{ _id: string; count: number }>([
          { $match: { party: { $in: partySeqIds }, countryId } },
          { $group: { _id: "$party", count: { $sum: 1 } } },
        ])
        .toArray(),
      db
        .collection("npps")
        .aggregate<{ _id: string; count: number }>([
          { $match: { party: { $in: partySeqIds }, retiredAt: null, countryId } },
          { $group: { _id: "$party", count: { $sum: 1 } } },
        ])
        .toArray(),
    ]);

    const charCountMap = new Map(charCounts.map((r) => [r._id, r.count]));
    const nppCountMap = new Map(nppCounts.map((r) => [r._id, r.count]));

    const partyMap = new Map(parties.map((p) => [p._id.toString(), p]));
    const chairMap = new Map(chairCharacters.map((c) => [c._id.toString(), c.name]));

    const enriched = coalitions.map((coalition) => {
      const memberParties = coalition.members.map((member) => {
        const party = partyMap.get(member.partyId.toString());
        const seqIdStr = String(party?.sequentialId ?? "");
        const memberCount = (charCountMap.get(seqIdStr) ?? 0) + (nppCountMap.get(seqIdStr) ?? 0);
        // partyId is the party's sequentialId (number) — matches CoalitionListItem.
        // Previously returned the ObjectId hex, which broke UI comparisons against
        // character.party (a stringified sequentialId) — e.g. parties-page isInCoalition.
        return {
          partyId: party?.sequentialId ?? member.partySequentialId,
          name: party?.name ?? "Unknown Party",
          abbreviation: party?.abbreviation ?? "?",
          color: party?.color ?? "#888888",
          memberCount,
          joinedAt: member.joinedAt,
        };
      });

      const totalMembers = memberParties.reduce((sum, p) => sum + p.memberCount, 0);

      return {
        id: String(coalition.sequentialId),
        sequentialId: coalition.sequentialId,
        countryId: coalition.countryId,
        name: coalition.name,
        abbreviation: coalition.abbreviation,
        color: coalition.color,
        logoUrl: coalition.logoUrl,
        discordInviteUrl: coalition.discordInviteUrl ?? null,
        chairName: coalition.chairCharacterId
          ? (chairMap.get(coalition.chairCharacterId.toString()) ?? "Unknown")
          : "Vacant",
        partyCount: coalition.members.length,
        totalMembers,
        memberParties,
        createdAt: coalition.createdAt,
      };
    });

    return NextResponse.json({ coalitions: enriched });
  } catch (error) {
    return handleRouteError(error);
  }
}
