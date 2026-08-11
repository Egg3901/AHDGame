import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { getDb } from "@/lib/mongodb";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { canActAsChair } from "@/lib/parties/actingChair";
import {
  PARTY_PURGE_ENABLED,
  PURGE_COOLDOWN_TURNS,
  PURGE_CHAIR_INFAMY_COST_BASE,
  PURGE_CHAIR_INFAMY_ESCALATION,
  PURGE_CHAIR_INFAMY_MAX,
} from "@/lib/constants/partyActions";
import type { Character, PoliticalParty } from "@/lib/db/types";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import {
  withdrawFromMismatchedPrimaries,
  cleanupPartyPositionsOnSwitch,
} from "@/lib/utils/electionCandidacy";
import { updatePartyPresence } from "@/lib/turn/partyOrg/presence";
import { cleanupCaucusParticipationForCharacters } from "@/lib/caucus/cleanupCaucusParticipationForCharacters";
import { createNotification } from "@/lib/notifications";
import { isSameCountry } from "@/lib/api/sameCountry";
import { emitPartyMembershipEvent, buildPartyEventSnapshots } from "@/lib/parties/membershipEvents";
import { prunePurgeRejoinBlocks } from "@/lib/parties/antiAbuseGuards";

// POST /api/country/[code]/parties/[id]/purge — Chair expels a regular member from the party.
// Auth: requireAuthWithCharacter (chair only)
// Errors: 400, 401, 403, 404, 429

const bodySchema = z.object({
  characterId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid character ID"),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id: partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    if (!PARTY_PURGE_ENABLED) {
      return NextResponse.json({ error: "Party purges are currently disabled." }, { status: 403 });
    }

    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;
    const { character: chair, userId } = authResult.user;

    const rateLimit = checkRateLimit(userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();

    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    if (!canActAsChair(party, chair._id)) {
      return NextResponse.json(
        {
          error:
            "Only the party Chair (or acting Vice-Chair when the chair seat is vacant) can purge members",
        },
        { status: 403 }
      );
    }

    const targetId = new ObjectId(parsed.data.characterId);
    // Characters collection contains only player characters; NPPs live in 'npps'
    const target = await db.collection<Character>("characters").findOne({ _id: targetId });

    if (!target) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    if (target.party !== partyId || !isSameCountry(target, party)) {
      return NextResponse.json(
        { error: "That character is not a member of this party" },
        { status: 400 }
      );
    }

    const isLeadership =
      party.chairId?.equals(target._id) ||
      party.viceChairId?.equals(target._id) ||
      party.treasurerId?.equals(target._id);
    if (isLeadership) {
      return NextResponse.json({ error: "Leadership roles cannot be purged" }, { status: 400 });
    }

    const isCommitteeMember = (party.committeeIds ?? []).some((id) => id.equals(target._id));
    if (isCommitteeMember) {
      return NextResponse.json(
        { error: "National committee members cannot be purged during their term" },
        { status: 400 }
      );
    }

    const currentTurn = await getCurrentTurn(db);
    if (
      party.lastPurgeAtTurn !== undefined &&
      currentTurn - party.lastPurgeAtTurn < PURGE_COOLDOWN_TURNS
    ) {
      const turnsRemaining = PURGE_COOLDOWN_TURNS - (currentTurn - party.lastPurgeAtTurn);
      return NextResponse.json(
        {
          error: `Purge is on cooldown for ${turnsRemaining} more turn${turnsRemaining === 1 ? "" : "s"}`,
          turnsRemaining,
        },
        { status: 429 }
      );
    }

    const now = new Date();
    const influenceCost = Math.floor((target.partyInfluence ?? 0) / 2);

    // Escalating infamy: +50% per successive purge, capped at PURGE_CHAIR_INFAMY_MAX.
    // Reset count if the cooldown has expired since the last purge.
    const purgeCount =
      party.lastPurgeAtTurn !== undefined &&
      currentTurn - party.lastPurgeAtTurn >= PURGE_COOLDOWN_TURNS
        ? 0
        : (party.purgeCount ?? 0);
    const infamyCost = Math.min(
      PURGE_CHAIR_INFAMY_MAX,
      Math.floor(PURGE_CHAIR_INFAMY_COST_BASE * Math.pow(PURGE_CHAIR_INFAMY_ESCALATION, purgeCount))
    );
    const nextPurgeCount = purgeCount + 1;

    // Apply costs to chair
    await db.collection<Character>("characters").updateOne(
      { _id: chair._id },
      {
        $set: {
          infamy: Math.min(100, (chair.infamy ?? 0) + infamyCost),
          partyInfluence: Math.max(0, (chair.partyInfluence ?? 0) - influenceCost),
          updatedAt: now,
        },
      }
    );

    // Eject the target. The purge is involuntary, so it must NOT arm the global
    // party-switch cooldown — clear lastPartySwitchAt (and partyJoinedAt) so the
    // victim can join any other party immediately. The only restriction is a
    // party-scoped rejoin block on the party that purged them.
    const purgeRejoinBlocks = [
      ...prunePurgeRejoinBlocks(target.purgeRejoinBlocks, currentTurn),
      { partyId, countryId, purgedAtTurn: currentTurn },
    ];
    await db.collection<Character>("characters").updateOne(
      { _id: target._id },
      {
        $set: { party: "independent", partyInfluence: 0, purgeRejoinBlocks, updatedAt: now },
        $unset: { partyJoinedAt: "", lastPartySwitchAt: "", partyJoinedTurn: "" },
      }
    );

    // Update elected official records for the ejected character
    await db
      .collection("electedOfficials")
      .updateMany({ characterId: target._id }, { $set: { party: "independent", updatedAt: now } });

    // Update party: decrement count and record purge turn + count
    await db.collection<PoliticalParty>("politicalParties").updateOne(
      { _id: party._id },
      {
        $inc: { memberCount: -1 },
        $set: { lastPurgeAtTurn: currentTurn, purgeCount: nextPurgeCount, updatedAt: now },
      }
    );

    // Withdraw target from mismatched primaries
    await withdrawFromMismatchedPrimaries(target._id, "independent");

    // Clean up state party positions and candidacies
    await cleanupPartyPositionsOnSwitch(target._id, partyId, "independent", countryId);

    // Caucuses are party-scoped — purge must drop membership/factionId the same
    // way leave and party-switch do, or the target stays blocked from founding
    // or joining caucuses elsewhere (ticket #1030).
    await cleanupCaucusParticipationForCharacters(db, [target._id], {
      removeMembership: true,
      membershipStatus: "removed",
      now,
    });

    // Update party presence for the state the target came from
    await updatePartyPresence(db, target.homeState, partyId);

    await emitPartyMembershipEvent({
      db,
      countryId,
      character: target,
      oldPartyId: partyId,
      newPartyId: "independent",
      reason: "purge",
      actor: chair,
      actorRole: "chair",
      turn: currentTurn,
      now,
      metadata: { influenceCost },
      snapshots: buildPartyEventSnapshots({
        character: target,
        oldParty: party,
        newParty: null,
        newIsIndependent: true,
      }),
    });

    // Notify the ejected member
    await createNotification({
      userId: target.userId,
      type: "party_kicked",
      title: "Expelled from party",
      message: `${chair.name} has expelled you from the ${party.name}.`,
      metadata: { partyId: String(party.sequentialId), partyName: party.name, countryId },
    });

    return NextResponse.json({
      success: true,
      message: `${target.name} has been expelled from the ${party.name}.`,
      infamyCost,
      purgeCount: nextPurgeCount,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
