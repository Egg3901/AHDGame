import { type Db } from "mongodb";
import {
  withdrawFromMismatchedPrimaries,
  cleanupPartyPositionsOnSwitch,
} from "@/lib/utils/electionCandidacy";
import { updatePartyPresence } from "@/lib/turn/partyOrg/presence";
import { cleanupCaucusParticipationForCharacters } from "@/lib/caucus/cleanupCaucusParticipationForCharacters";
import type { Character, PoliticalParty } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { prunePurgeRejoinBlocks } from "@/lib/parties/antiAbuseGuards";
import { emitPartyMembershipEvent, buildPartyEventSnapshots } from "@/lib/parties/membershipEvents";

export interface ApplyCharacterPartyJoinArgs {
  db: Db;
  /** The character being moved into `party` (fetched BEFORE this call). */
  character: Character;
  party: PoliticalParty;
  countryId: CountryId;
  currentTurn: number;
  now: Date;
  /**
   * Auto-promote the joiner to chair when a default party's chair seat is
   * vacant (the "first joiner becomes chair" rule). Pass the resolved gameConfig
   * toggle for a self-join; pass `false` for a leader-approved accept, where a
   * seated/acting leader already exists.
   */
  autoChairWhenVacant: boolean;
  /** Who performed the move — the joiner themselves ("self") or an approving leader ("chair"). */
  actor: Pick<Character, "_id" | "name">;
  actorRole: "self" | "chair";
  /**
   * When true, this move spent the character's one free party move (granted
   * during the post-reset setup window because the normal 24h switch cooldown
   * would otherwise have blocked it). Stamps `freePartyMoveUsedAt` so a second
   * in-window switch falls back to the cooldown. See the join route.
   */
  consumeFreePartyMove?: boolean;
}

/**
 * Applies a character's membership move into `party`, running the full set of
 * side effects: reset party influence, re-point elected-official rows, withdraw
 * from mismatched primaries, clean up old-party positions, adjust roster counts,
 * refresh presence, optionally auto-promote to a vacant chair, and emit the
 * party-membership event.
 *
 * Shared by the immediate "open" join path (`join/route.ts`) and the
 * leader-approved "approval" accept path (`join-requests/route.ts`, suggestion
 * #72) so both stay in exact lockstep. Callers must have already run the
 * country / already-member / switch-cooldown / purge-block guards — this
 * function only performs the mutations.
 */
export async function applyCharacterPartyJoin(
  args: ApplyCharacterPartyJoinArgs
): Promise<{ becameChair: boolean }> {
  const {
    db,
    character,
    party,
    countryId,
    currentTurn,
    now,
    autoChairWhenVacant,
    actor,
    actorRole,
    consumeFreePartyMove,
  } = args;

  const partyIdStr = String(party.sequentialId);
  const oldParty = character.party;

  // Update character's party and reset party influence.
  // `partyJoinedAt` is the third anchor of the 24-hour new-character
  // cooldown on leadership/committee actions (see newCharacterCooldown.ts).
  await db.collection("characters").updateOne(
    { _id: character._id },
    {
      $set: {
        party: partyIdStr,
        partyInfluence: 0,
        partyJoinedAt: now,
        partyJoinedTurn: currentTurn,
        lastPartySwitchAt: now,
        updatedAt: now,
        purgeRejoinBlocks: prunePurgeRejoinBlocks(character.purgeRejoinBlocks, currentTurn).filter(
          (b) => !(b.partyId === partyIdStr && b.countryId === countryId)
        ),
        ...(consumeFreePartyMove ? { freePartyMoveUsedAt: now } : {}),
      },
    }
  );

  // Update any ElectedOfficial records for this character to reflect the new party
  // This ensures Congress/Parliament and state legislature displays show the correct party
  await db
    .collection("electedOfficials")
    .updateMany({ characterId: character._id }, { $set: { party: partyIdStr, updatedAt: now } });

  // Withdraw from any primaries where the character was registered under a different party
  const { withdrawnCount } = await withdrawFromMismatchedPrimaries(character._id, partyIdStr);
  if (withdrawnCount > 0) {
    console.log(
      `[Party Join] ${character.name} withdrew from ${withdrawnCount} primary(ies) due to party switch`
    );
  }

  // Clean up old party positions and candidacies
  if (oldParty && oldParty !== "independent") {
    const cleanup = await cleanupPartyPositionsOnSwitch(
      character._id,
      oldParty,
      partyIdStr,
      countryId
    );
    if (cleanup.clearedNationalLeadership.length > 0) {
      console.log(
        `[Party Join] ${character.name} vacated national party positions: ${cleanup.clearedNationalLeadership.join(", ")}`
      );
    }
    if (cleanup.clearedStateLeadership.length > 0) {
      console.log(
        `[Party Join] ${character.name} vacated state party positions: ${cleanup.clearedStateLeadership.join("; ")}`
      );
    }
    if (cleanup.withdrawnStateElections > 0) {
      console.log(
        `[Party Join] ${character.name} withdrew from ${cleanup.withdrawnStateElections} state party election(s)`
      );
    }
    if (cleanup.withdrawnNationalElections > 0) {
      console.log(
        `[Party Join] ${character.name} withdrew from ${cleanup.withdrawnNationalElections} national party election(s)`
      );
    }
    if (cleanup.removedFromCommittee) {
      console.log(`[Party Join] ${character.name} removed from national committee`);
    }
    if (cleanup.withdrawnCommitteeElections > 0) {
      console.log(
        `[Party Join] ${character.name} withdrew from ${cleanup.withdrawnCommitteeElections} national committee election(s)`
      );
    }

    // Caucuses are scoped to a single (countryId, partyId). Switching parties
    // without going independent must drop old-party caucus membership the same
    // way leave does — otherwise factionId/membership linger and block founding
    // or joining a caucus in the new party (ticket #1030 / leave fix #0552).
    const caucusCleanup = await cleanupCaucusParticipationForCharacters(db, [character._id], {
      removeMembership: true,
      membershipStatus: "left",
      now,
    });
    if (caucusCleanup.membershipsClosed > 0) {
      console.log(
        `[Party Join] ${character.name} left ${caucusCleanup.membershipsClosed} caucus(es) from former party`
      );
    }
  }

  // Decrement old party member count (if not independent)
  // We just verified the character's country matches the new party's country
  // via isSameCountry upstream, so countryId (URL/new-party country) == old-party country.
  if (oldParty && oldParty !== "independent") {
    await db
      .collection<PoliticalParty>("politicalParties")
      .updateOne(
        { sequentialId: parseInt(oldParty, 10), countryId },
        { $inc: { memberCount: -1 } }
      );
  }

  // Vacant national chair: optionally auto-assign to joiner (gameConfig
  // toggle; default on). Never fires while a chair election is running —
  // the seat is election-backed and the ballot, not join order, decides it.
  // The lookup only runs when the cheap conditions already hold.
  let becameChair = autoChairWhenVacant && party.isDefault === true && party.chairId === null;
  if (becameChair) {
    const activeChairElection = await db
      .collection("nationalPartyElections")
      .findOne(
        { partyId: partyIdStr, countryId, position: "chair", status: "voting" },
        { projection: { _id: 1 } }
      );
    if (activeChairElection) becameChair = false;
  }

  // Update party: increment member count and set chair if vacant
  const partyUpdate: Record<string, unknown> = {};
  if (becameChair) {
    partyUpdate.chairId = character._id;
    partyUpdate.updatedAt = now;
  }

  await db.collection<PoliticalParty>("politicalParties").updateOne(
    { _id: party._id },
    {
      $inc: { memberCount: 1 },
      ...(becameChair ? { $set: partyUpdate } : {}),
    }
  );

  // If auto-promoted to chair, sync any coalition this party leads
  if (becameChair) {
    await db
      .collection("coalitions")
      .updateMany(
        { chairPartyId: party._id },
        { $set: { chairCharacterId: character._id, updatedAt: now } }
      );
  }

  // Update presence for old and new parties
  if (oldParty && oldParty !== "independent") {
    await updatePartyPresence(db, character.homeState, oldParty);
  }
  await updatePartyPresence(db, character.homeState, partyIdStr);

  // Resolve prior party doc (if any) for the snapshot fields.
  let oldPartyDoc: PoliticalParty | null = null;
  if (oldParty && oldParty !== "independent") {
    const oldSeq = parseInt(oldParty, 10);
    if (!isNaN(oldSeq)) {
      oldPartyDoc = await db
        .collection<PoliticalParty>("politicalParties")
        .findOne(
          { sequentialId: oldSeq, countryId },
          { projection: { sequentialId: 1, name: 1, countryId: 1 } }
        );
    }
  }

  await emitPartyMembershipEvent({
    db,
    countryId,
    character,
    oldPartyId: oldParty ?? null,
    newPartyId: partyIdStr,
    reason: "join",
    actor,
    actorRole,
    now,
    metadata: { becameChair },
    snapshots: buildPartyEventSnapshots({
      character,
      oldParty: oldPartyDoc,
      newParty: party,
      newIsIndependent: false,
    }),
  });

  if (becameChair) {
    try {
      const { awardAchievement } = await import("@/lib/achievements");
      await awardAchievement(character.userId, "party_leader", character._id);
    } catch (e) {
      console.error("Achievement check failed:", e);
    }
  }

  return { becameChair };
}
