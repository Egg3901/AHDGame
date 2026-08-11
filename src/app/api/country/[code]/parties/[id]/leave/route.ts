import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import {
  withdrawFromMismatchedPrimaries,
  cleanupPartyPositionsOnSwitch,
} from "@/lib/utils/electionCandidacy";
import { updatePartyPresence } from "@/lib/turn/partyOrg/presence";
import { cleanupCaucusParticipationForCharacters } from "@/lib/caucus/cleanupCaucusParticipationForCharacters";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import type { PoliticalParty } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getPartyRoleLabel } from "@/lib/parties/partyRoleLabels";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isSameCountry } from "@/lib/api/sameCountry";
import { emitPartyMembershipEvent, buildPartyEventSnapshots } from "@/lib/parties/membershipEvents";

// POST /api/country/[code]/parties/[id]/leave — Leave a political party and become independent
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 404, 429
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

    const rateLimit = checkRateLimit(authResult.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const auth = authResult.user;

    const db = await getDb();

    // Check if party exists
    const party = await findPartyBySequentialId(db, id, countryId);

    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    // Check if actually in this party - must match both party AND country
    if (auth.character.party !== id || !isSameCountry(auth.character, party)) {
      return NextResponse.json({ error: "You are not a member of this party" }, { status: 400 });
    }

    const now = new Date();
    const characterId = auth.character._id;

    // Update character to independent and reset party influence.
    // Clear partyJoinedAt since the third cooldown anchor no longer applies.
    //
    // Becoming independent is NOT a party switch, so it must not (re)arm the
    // 24-hour join cooldown — that cooldown is incurred only by joining an
    // actual party (the join route stamps lastPartySwitchAt). We deliberately
    // leave the existing lastPartySwitchAt untouched: a player who joined a
    // party minutes ago still serves out that join's cooldown through an
    // independent stint (no leave→rejoin hop escape), while a long-tenured
    // member who quits is free to join elsewhere immediately.
    await db.collection("characters").updateOne(
      { _id: characterId },
      {
        $set: {
          party: "independent",
          partyInfluence: 0,
          updatedAt: now,
        },
        $unset: { partyJoinedAt: "", partyJoinedTurn: "" },
      }
    );

    // Update any ElectedOfficial records for this character to reflect the new party
    // This ensures Congress/Parliament and state legislature displays show the correct party
    await db
      .collection("electedOfficials")
      .updateMany({ characterId }, { $set: { party: "independent", updatedAt: now } });

    // Withdraw from any primaries where the character was registered under their old party
    const { withdrawnCount } = await withdrawFromMismatchedPrimaries(characterId, "independent");
    if (withdrawnCount > 0) {
      console.log(
        `[Party Leave] ${auth.character.name} withdrew from ${withdrawnCount} primary(ies) due to party switch`
      );
    }

    // Clean up party positions and candidacies (state party positions and election candidacies)
    // Note: National party leadership is handled separately below for proper user feedback
    const cleanup = await cleanupPartyPositionsOnSwitch(characterId, id, "independent", countryId);
    if (cleanup.clearedStateLeadership.length > 0) {
      console.log(
        `[Party Leave] ${auth.character.name} vacated state party positions: ${cleanup.clearedStateLeadership.join("; ")}`
      );
    }
    if (cleanup.withdrawnStateElections > 0) {
      console.log(
        `[Party Leave] ${auth.character.name} withdrew from ${cleanup.withdrawnStateElections} state party election(s)`
      );
    }
    if (cleanup.withdrawnNationalElections > 0) {
      console.log(
        `[Party Leave] ${auth.character.name} withdrew from ${cleanup.withdrawnNationalElections} national party election(s)`
      );
    }
    if (cleanup.removedFromCommittee) {
      console.log(`[Party Leave] ${auth.character.name} removed from national committee`);
    }
    if (cleanup.withdrawnCommitteeElections > 0) {
      console.log(
        `[Party Leave] ${auth.character.name} withdrew from ${cleanup.withdrawnCommitteeElections} national committee election(s)`
      );
    }

    // Caucuses are scoped to a single (countryId, partyId), so leaving the
    // party means leaving the caucus. Closes membership, clears factionId,
    // withdraws chair candidacies, vacates chair/vice-chair seats. Without
    // this the character keeps factionId pointing at the old caucus and is
    // blocked from founding or joining caucuses elsewhere (bug #0552).
    const caucusCleanup = await cleanupCaucusParticipationForCharacters(db, [characterId], {
      removeMembership: true,
      membershipStatus: "left",
      now,
    });
    if (caucusCleanup.membershipsClosed > 0) {
      console.log(
        `[Party Leave] ${auth.character.name} left ${caucusCleanup.membershipsClosed} caucus(es)`
      );
    }
    if (caucusCleanup.chairSeatsCleared > 0 || caucusCleanup.viceChairSeatsCleared > 0) {
      console.log(
        `[Party Leave] ${auth.character.name} vacated caucus leadership: ${caucusCleanup.chairSeatsCleared} chair, ${caucusCleanup.viceChairSeatsCleared} vice-chair`
      );
    }

    // Build party update
    const partyUpdate: Record<string, unknown> = {
      updatedAt: now,
    };

    // Check if leaving member holds any leadership position
    const isChair = party.chairId?.toString() === characterId.toString();
    const isViceChair = party.viceChairId?.toString() === characterId.toString();
    const isTreasurer = party.treasurerId?.toString() === characterId.toString();

    if (isChair) {
      partyUpdate.chairId = null;
    }
    if (isViceChair) {
      partyUpdate.viceChairId = null;
    }
    if (isTreasurer) {
      partyUpdate.treasurerId = null;
    }

    // Update party: decrement member count and clear leadership if needed
    await db.collection<PoliticalParty>("politicalParties").updateOne(
      { _id: party._id },
      {
        $inc: { memberCount: -1 },
        $set: partyUpdate,
      }
    );

    // If the chair left, clear coalitionChairCharacterId for any coalition this party leads
    if (isChair) {
      await db
        .collection("coalitions")
        .updateMany(
          { chairPartyId: party._id },
          { $set: { chairCharacterId: null, updatedAt: now } }
        );
    }

    // Clear any state-level party leadership seats this character held (ticket
    // #0860). Leaving the party (like retiring) invalidates a state chair/vice
    // chair/treasurer seat, but this previously only cleared the *national*
    // leadership fields above — a departed state chair left a stale id behind,
    // permanently blocking new appointments to that seat ("not vacant").
    await db
      .collection("statePartyOrg")
      .updateMany({ chairId: characterId }, { $set: { chairId: null, updatedAt: now } });
    await db
      .collection("statePartyOrg")
      .updateMany({ viceChairId: characterId }, { $set: { viceChairId: null, updatedAt: now } });
    await db
      .collection("statePartyOrg")
      .updateMany({ treasurerId: characterId }, { $set: { treasurerId: null, updatedAt: now } });
    await db
      .collection("statePartyOrg")
      .updateMany({ campaignerId: characterId }, { $set: { campaignerId: null, updatedAt: now } });

    // Update presence for the party the character left
    await updatePartyPresence(db, auth.character.homeState, id);

    await emitPartyMembershipEvent({
      db,
      countryId,
      character: auth.character,
      oldPartyId: id,
      newPartyId: "independent",
      reason: "leave",
      actor: auth.character,
      actorRole: "self",
      now,
      metadata: {
        vacatedChair: isChair,
        vacatedViceChair: isViceChair,
        vacatedTreasurer: isTreasurer,
        removedFromCommittee: cleanup.removedFromCommittee,
      },
      snapshots: buildPartyEventSnapshots({
        character: auth.character,
        oldParty: party,
        newParty: null,
        newIsIndependent: true,
      }),
    });

    let message = `You have left the ${party.name}`;
    const vacatedPositions: string[] = [];
    if (isChair) {
      vacatedPositions.push(getPartyRoleLabel(countryId, "chair"));
    }
    if (isViceChair) {
      vacatedPositions.push(getPartyRoleLabel(countryId, "viceChair"));
    }
    if (isTreasurer) {
      vacatedPositions.push(getPartyRoleLabel(countryId, "treasurer"));
    }
    if (cleanup.removedFromCommittee) {
      vacatedPositions.push(getPartyRoleLabel(countryId, "committee"));
    }
    if (vacatedPositions.length > 0) {
      message += ` and vacated the ${vacatedPositions.join(", ")} position${vacatedPositions.length > 1 ? "s" : ""}`;
    }

    return NextResponse.json({
      success: true,
      message,
      vacatedPosition: isChair
        ? "chair"
        : isViceChair
          ? "viceChair"
          : isTreasurer
            ? "treasurer"
            : null,
      removedFromCommittee: cleanup.removedFromCommittee,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
