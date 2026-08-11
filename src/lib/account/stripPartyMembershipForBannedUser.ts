/**
 * Forces a banned account's character(s) out of their political party — same core
 * effects as `POST .../parties/[id]/leave`, but without auth and invoked from ban
 * handlers so party rosters and `memberCount` stay consistent (banned accounts are
 * not supposed to remain listed as members).
 */

import type { Db, ObjectId } from "mongodb";
import type { Character, PartyCharter, PoliticalParty } from "@/lib/db/types";
import {
  withdrawFromMismatchedPrimaries,
  cleanupPartyPositionsOnSwitch,
} from "@/lib/utils/electionCandidacy";
import { updatePartyPresence } from "@/lib/turn/partyOrg/presence";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { cleanupCaucusParticipationForCharacters } from "@/lib/caucus/cleanupCaucusParticipationForCharacters";

export interface StripPartyMembershipResult {
  charactersUpdated: number;
}

export async function stripPartyMembershipForBannedUser(
  db: Db,
  userId: ObjectId
): Promise<StripPartyMembershipResult> {
  const characters = await db.collection<Character>("characters").find({ userId }).toArray();

  let charactersUpdated = 0;
  const now = new Date();
  const partyCharacterIds = characters
    .filter((char) => !!char.party && char.party !== "independent")
    .map((char) => char._id);

  if (partyCharacterIds.length > 0) {
    await cleanupCaucusParticipationForCharacters(db, partyCharacterIds, {
      removeMembership: true,
      membershipStatus: "removed",
      now,
    });
  }

  for (const char of characters) {
    const oldParty = char.party;
    if (!oldParty || oldParty === "independent") continue;

    const countryId = char.countryId ?? "US";

    await db.collection<Character>("characters").updateOne(
      { _id: char._id },
      {
        $set: {
          party: "independent",
          partyInfluence: 0,
          updatedAt: now,
        },
        $unset: { partyJoinedAt: "", partyJoinedTurn: "" },
      }
    );

    await db
      .collection("electedOfficials")
      .updateMany({ characterId: char._id }, { $set: { party: "independent", updatedAt: now } });

    await withdrawFromMismatchedPrimaries(char._id, "independent");
    await cleanupPartyPositionsOnSwitch(char._id, oldParty, "independent", countryId);

    const politicalParty = await findPartyBySequentialId(db, oldParty, countryId);

    if (politicalParty) {
      await db.collection<PoliticalParty>("politicalParties").updateOne(
        { _id: politicalParty._id },
        {
          $inc: { memberCount: -1 },
          $set: { updatedAt: now },
        }
      );

      const isChair = politicalParty.chairId?.toString() === char._id.toString();
      if (isChair) {
        await db
          .collection("coalitions")
          .updateMany(
            { chairPartyId: politicalParty._id },
            { $set: { chairCharacterId: null, updatedAt: now } }
          );
      }
    }

    await updatePartyPresence(db, char.homeState, oldParty);
    charactersUpdated += 1;
  }

  // Phase 6 ban cascade — auto-reject any in-flight charter signatures
  // bound to the banned user's characters and transition the affected
  // charters to `founder-replacement` so other founders aren't held
  // hostage by a banned account until natural expiry (D3: "a founder is
  // voided / banned" should open the replacement window).
  //
  // Founder identity is `characterId`, so we look up every character
  // owned by the banned user and cascade through each one. A single user
  // may have multiple character slots on the same charter (multi-persona
  // play), so we update per-character and the per-charter status flip
  // is idempotent ($set status="founder-replacement" runs once and any
  // re-runs are no-ops on already-replaced charters).
  const bannedCharacterIds = characters.map((c) => c._id);
  if (bannedCharacterIds.length > 0) {
    const computeCharterDeadline = (await import("@/lib/charters/charterDeadlines"))
      .computeCharterDeadline;
    const replacementDeadline = computeCharterDeadline(now);
    for (const characterId of bannedCharacterIds) {
      await db.collection<PartyCharter>("partyCharters").updateMany(
        {
          status: "pending-signatures",
          "signatures.characterId": characterId,
        },
        {
          $set: {
            "signatures.$.rejectedAt": now,
            "signatures.$.rejectionReason": "Founder account banned",
            status: "founder-replacement",
            founderReplacementDeadline: replacementDeadline,
            updatedAt: now,
          },
        }
      );
    }
  }

  return { charactersUpdated };
}
