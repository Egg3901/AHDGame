import type { Db, ObjectId } from "mongodb";
import type {
  Character,
  State,
  Corporation,
  CentralBank,
  PoliticalParty,
  StatePartyOrg,
  CareerEvent,
} from "@/lib/db/types";
import {
  withdrawAllActiveCandidacies,
  cleanupPartyPositionsOnSwitch,
} from "@/lib/utils/electionCandidacy";
import { updatePartyPresence } from "@/lib/turn/partyOrg/presence";
import { cleanupCaucusParticipationForCharacters } from "@/lib/caucus/cleanupCaucusParticipationForCharacters";
import { closeCeoTenure } from "@/lib/corporations/ceoHistory";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";

export interface RelocationOutcome {
  resignedFromOffice: string | null;
  ceoResignedFrom: string | null;
  chairResignedFrom: string | null;
  leftPartyName: string | null;
  clearedStateLeadership: string[];
  withdrawnGeneralElections: number;
  withdrawnStatePartyElections: number;
  withdrawnNationalPartyElections: number;
  withdrawnCommitteeElections: number;
  countryChanged: boolean;
}

export interface PerformRelocationOptions {
  /** If set, the CEO auto-resign step is skipped when the active corp matches this id. */
  skipCeoResignForCorpId?: ObjectId;
}

/**
 * Apply the full relocation pipeline to a character. Assumes caller has
 * already validated:
 *   - the target state exists
 *   - the character is not already in the target state
 *   - any cooldown/permission checks the caller cares about
 *
 * Called by:
 *   - POST /api/character/relocate (player flow, cooldown enforced upstream)
 *   - POST /api/character/relocate-with-corp (combined char+corp move)
 *   - PATCH /api/admin/characters/update-country
 *   - PATCH /api/admin/characters/update-state
 *   - PATCH /api/moderator/characters/update-country
 *   - PATCH /api/moderator/characters/update-state
 *
 * When `options.skipCeoResignForCorpId` is supplied, the CEO auto-resign
 * step is skipped if the matching corp is the one the character currently
 * leads — used by the combined character+corp relocation flow.
 */
export async function performRelocation(
  db: Db,
  character: Character,
  targetState: State,
  options: PerformRelocationOptions = {}
): Promise<RelocationOutcome> {
  const characterId = character._id;
  const oldStateId = character.homeState;
  const newStateId = targetState._id;
  const oldCountryId = character.countryId;
  const newCountryId = targetState.countryId;
  const countryChanged = oldCountryId !== newCountryId;
  const now = new Date();
  // lastRelocatedAt anchors the relocation cooldown, so write it on the game
  // clock — the comparison side in the relocate routes is on game time too.
  const { getGameTime } = await import("@/lib/time/gameTime");
  const gameTime = await getGameTime();
  const lastRelocatedAt = gameTime.effectiveNow;
  const lastRelocatedTurn = gameTime.currentTurn;

  // 1. Auto-resign from office, if any.
  let resignedFromOffice: string | null = null;
  if (character.currentOffice) {
    const officeType = character.currentOffice.type;
    const officeState = "state" in character.currentOffice ? character.currentOffice.state : null;
    await db.collection("electedOfficials").updateOne(
      { characterId },
      {
        $set: {
          characterId: null,
          characterName: null,
          party: null,
          electedAt: null,
          updatedAt: now,
        },
      }
    );
    resignedFromOffice = officeState ? `${officeType} (${officeState})` : officeType;
  }

  // 2. Withdraw from every active candidacy (no longer a blocking precondition).
  const withdrawals = await withdrawAllActiveCandidacies(characterId);

  // 3. Auto-resign CEO of any corporation, unless the caller has asked us to
  //    keep them in place for the matching corp (combined char+corp move).
  let ceoResignedFrom: string | null = null;
  const ceoCorp = await db.collection<Corporation>("corporations").findOne({
    ceoId: characterId,
    ceoVacant: { $ne: true },
  });
  const skipForCorpId = options.skipCeoResignForCorpId;
  const keepCeo = !!(
    ceoCorp &&
    ((skipForCorpId && ceoCorp._id.toString() === skipForCorpId.toString()) ||
      // National Corporation CEOs have relaxed country-level residency (HQ-state
      // exempt): a relocation that keeps the player in the NatCorp's country does
      // not unseat them. Moving to a different country still breaks residency.
      (isStateOwned(ceoCorp) && ceoCorp.countryId === newCountryId))
  );
  if (ceoCorp && !keepCeo) {
    await db.collection<Corporation>("corporations").updateOne(
      { _id: ceoCorp._id },
      {
        $set: { ceoVacant: true, updatedAt: now },
        $unset: { ceoId: "", userId: "" },
      }
    );
    await closeCeoTenure(db, ceoCorp._id, {
      holderId: characterId,
      turn: gameTime.currentTurn,
    });
    ceoResignedFrom = ceoCorp.name;
  }

  // 4. Central bank chair: only when changing country.
  let chairResignedFrom: string | null = null;
  if (countryChanged) {
    const chairBank = await db
      .collection<CentralBank>("centralBanks")
      .findOne({ chairCharacterId: characterId });
    if (chairBank) {
      await db.collection<CentralBank>("centralBanks").updateOne(
        { _id: chairBank._id },
        {
          $set: {
            chairCharacterId: null,
            chairCharacterName: null,
            chairAppointedAt: null,
            chairAppointedBy: null,
            chairTermExpiresAtTurn: null,
          },
        }
      );
      chairResignedFrom = chairBank.countryId;
    }
  }

  // 4b. Cross-country: vacate retained roles whose action sites grant country-
  // scoped power (campaign manager, caucus chair, caucus membership, PM).
  // These were the defense-in-depth gap behind "relocated chair acts on
  // foreign entity" — clearing them here closes the loop at the source.
  if (countryChanged) {
    await db
      .collection("campaigns")
      .updateMany(
        { managerCharacterId: characterId },
        { $set: { managerId: null, managerCharacterId: null, updatedAt: now } }
      );
    // Caucus participation: closes memberships, withdraws chair candidacies,
    // clears chair/vice-chair seats, AND clears the denormalized
    // character.factionId pointer. The inline cleanup that used to live here
    // missed factionId, so relocated players stayed visibly "in" their old
    // caucus and were blocked from founding or joining caucuses in the new
    // country (bug #0552).
    await cleanupCaucusParticipationForCharacters(db, [characterId], {
      removeMembership: true,
      membershipStatus: "left",
      now,
    });
    // GovernmentFormation pmCharacterId — auth helper grants PM-only powers
    // based on this field, so a relocated PM must lose the title.
    await db.collection("governmentFormations").updateMany(
      { pmCharacterId: characterId },
      {
        $set: {
          pmCharacterId: null,
          pmName: null,
          updatedAt: now,
        },
      }
    );
    await db.collection("parliamentaryGovernments").updateMany(
      { pmCharacterId: characterId },
      {
        $set: {
          pmCharacterId: null,
          pmName: null,
          updatedAt: now,
        },
      }
    );
    // Cabinet member records. Cabinet-bill voting and cabinet-position routes
    // filter by characterId+countryId, so a stale record in another country
    // would still grant voting rights.
    await db.collection("cabinetMembers").deleteMany({ characterId });
  }

  // 5. Strip state/region-party leadership in the OLD state
  //    (always — a player can't chair the CA state party if they live in TX).
  const clearedStateLeadership: string[] = [];
  if (character.party && character.party !== "independent") {
    const oldStateOrg = await db.collection<StatePartyOrg>("statePartyOrg").findOne({
      partyId: character.party,
      stateId: oldStateId,
      $or: [{ chairId: characterId }, { viceChairId: characterId }, { treasurerId: characterId }],
    });
    if (oldStateOrg) {
      const updates: Record<string, unknown> = { updatedAt: now };
      const positions: string[] = [];
      const charIdStr = characterId.toString();
      if (oldStateOrg.chairId?.toString() === charIdStr) {
        updates.chairId = null;
        positions.push("chair");
      }
      if (oldStateOrg.viceChairId?.toString() === charIdStr) {
        updates.viceChairId = null;
        positions.push("viceChair");
      }
      if (oldStateOrg.treasurerId?.toString() === charIdStr) {
        updates.treasurerId = null;
        positions.push("treasurer");
      }
      if (positions.length > 0) {
        await db
          .collection<StatePartyOrg>("statePartyOrg")
          .updateOne({ _id: oldStateOrg._id }, { $set: updates });
        clearedStateLeadership.push(`${oldStateId}: ${positions.join(", ")}`);
      }
    }
  }

  // 6. Cross-country party cleanup: capture the party name + decrement
  //    memberCount, then delegate leadership clearing, state-org stripping,
  //    committee removal, and coalition chair sync to the shared helper.
  //    cleanupPartyPositionsOnSwitch reads the party fresh, so running it
  //    first (before we mutate chairId) is required for coalition sync to
  //    detect that chair was cleared.
  let leftPartyName: string | null = null;
  if (countryChanged && character.party && character.party !== "independent") {
    const oldPartyId = character.party;
    const oldParty = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ sequentialId: parseInt(oldPartyId, 10), countryId: oldCountryId });

    if (oldParty) {
      leftPartyName = oldParty.name;
    }

    // Handles: national leadership (chair/viceChair/treasurer), coalition
    // chair sync, state-party leadership in other states, committee
    // membership, and party-election candidacy withdrawal (already-withdrawn
    // rows are no-ops).
    await cleanupPartyPositionsOnSwitch(characterId, oldPartyId, "independent", oldCountryId);

    if (oldParty) {
      await db
        .collection<PoliticalParty>("politicalParties")
        .updateOne({ _id: oldParty._id }, { $inc: { memberCount: -1 }, $set: { updatedAt: now } });
    }
  }

  // 7. Build the character update. Reset policy:
  //    - ALWAYS reset to 0: politicalInfluence, donorBaseLevel, groupFavorability
  //    - Only reset on country change: nationalInfluence, partyInfluence, party
  //    - currentOffice cleared if they held one
  //    - homeState always updated; countryId always set to target
  const update: Partial<Character> = {
    homeState: newStateId,
    countryId: newCountryId,
    lastRelocatedAt,
    lastRelocatedTurn,
    updatedAt: now,
    ...(resignedFromOffice ? { currentOffice: null } : {}),
    ...(countryChanged
      ? {
          party: "independent",
          nationalInfluence: 0,
          partyInfluence: 0,
        }
      : {}),
    politicalInfluence: 0,
    donorBaseLevel: 0,
    groupFavorability: {},
  };

  // 8. Append a careerHistory entry and persist the character update.
  const relocationEvent: CareerEvent = {
    type: "relocated",
    officeLabel: `${oldStateId} → ${newStateId}`,
    fromState: oldStateId,
    toState: newStateId,
    ...(countryChanged ? { fromCountry: oldCountryId, toCountry: newCountryId } : {}),
    date: now,
  };

  await db
    .collection<Character>("characters")
    .updateOne({ _id: characterId }, { $set: update, $push: { careerHistory: relocationEvent } });

  // 9. Update party presence in the old and new states. Runs AFTER the
  //     character update so the headcount reflects the new homeState.
  //     For cross-country moves the character is now independent in the new
  //     country, so we only recompute the new state's presence when the
  //     party is preserved (same-country move).
  if (character.party && character.party !== "independent") {
    await updatePartyPresence(db, oldStateId, character.party);
    if (!countryChanged) {
      await updatePartyPresence(db, newStateId, character.party);
    }
  }

  return {
    resignedFromOffice,
    ceoResignedFrom,
    chairResignedFrom,
    leftPartyName,
    clearedStateLeadership,
    withdrawnGeneralElections: withdrawals.withdrawnGeneralElections,
    withdrawnStatePartyElections: withdrawals.withdrawnStatePartyElections,
    withdrawnNationalPartyElections: withdrawals.withdrawnNationalPartyElections,
    withdrawnCommitteeElections: withdrawals.withdrawnCommitteeElections,
    countryChanged,
  };
}
