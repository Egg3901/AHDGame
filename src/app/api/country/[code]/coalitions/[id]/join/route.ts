import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import { createNotification } from "@/lib/notifications";
import type { Coalition } from "@/lib/db/types/coalition";
import type { PoliticalParty } from "@/lib/db/types/party";
import type { Character } from "@/lib/db/types/character";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { canInviteToCoalition, isBannedParty } from "@/lib/turn/onePartyConstraints";
import { getCountryState } from "@/lib/countryState";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { canActAsChair } from "@/lib/parties/actingChair";

// POST /api/coalitions/[id]/join — Request to join a coalition
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;

    const rateLimit = checkRateLimit(authResult.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const { character } = authResult.user;

    if (!character.party || character.party === "independent") {
      throw badRequest("You must be a member of a party to request to join a coalition.");
    }

    const db = await getDb();

    // Find user's party
    const party = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ sequentialId: Number(character.party), countryId });
    if (!party) {
      throw notFound("Your party could not be found.");
    }

    // Caller must be the party chair
    if (!canActAsChair(party, character._id)) {
      throw forbidden(
        "Only the national party chair (or acting vice-chair) can request to join a coalition."
      );
    }

    // One-party-state guard: banned parties cannot join; in a one-party
    // state only the ruling party may operate coalitions at all. Reads
    // runtime governmentType so a post-Stage-4 conversion immediately
    // lifts the coalition restriction.
    const runtime = await getCountryState(db, countryId);
    const runtimeConfig = { governmentType: runtime.governmentType };
    if (runtime.governmentType === "onePartyState") {
      if (isBannedParty(runtimeConfig, party)) {
        throw forbidden("Banned parties cannot join coalitions.");
      }
      if (!canInviteToCoalition(runtimeConfig, party)) {
        throw forbidden("Coalitions are not available to non-ruling parties in this country.");
      }
    }

    // Party must not already be in a coalition
    if (party.coalitionId) {
      throw badRequest("Your party is already a member of a coalition.");
    }

    // Find the target coalition
    const coalition = await db
      .collection<Coalition>("coalitions")
      .findOne({ sequentialId: Number(id), countryId });
    if (!coalition) {
      throw notFound("Coalition not found.");
    }

    // Check if the party is already a member of this coalition
    const alreadyMember = coalition.members.some((m) => String(m.partyId) === String(party._id));
    if (alreadyMember) {
      throw badRequest("Your party is already a member of this coalition.");
    }

    // Check if the party already has a pending join request to ANY coalition
    const existingRequest = await db
      .collection<Coalition>("coalitions")
      .findOne({ countryId, "joinRequests.partyId": party._id });
    if (existingRequest) {
      throw badRequest("Your party already has a pending join request to another coalition.");
    }

    const now = new Date();

    await db.collection<Coalition>("coalitions").updateOne(
      { _id: coalition._id },
      {
        $push: {
          joinRequests: {
            partyId: party._id,
            requestedBy: character._id,
            requestedAt: now,
          },
        },
        $set: { updatedAt: now },
      }
    );

    // Notify the coalition chair
    const chairChar = coalition.chairCharacterId
      ? await db
          .collection<Character>("characters")
          .findOne({ _id: coalition.chairCharacterId }, { projection: { userId: 1 } })
      : null;
    if (chairChar) {
      await createNotification({
        userId: chairChar.userId,
        type: "coalition_join_request",
        title: `Join Request: ${party.name}`,
        message: `${party.name} has requested to join ${coalition.name}.`,
        metadata: {
          coalitionId: coalition._id,
          coalitionSequentialId: coalition.sequentialId,
          coalitionName: coalition.name,
          countryId,
          partyName: party.name,
        },
      });
    }

    return NextResponse.json({ success: true, message: "Join request sent" });
  } catch (error) {
    return handleRouteError(error);
  }
}
