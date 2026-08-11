/**
 * Vacates seated leadership positions and committee seats held by a banned
 * user's character(s).
 *
 * Pairs with `cleanupPartyElectionsForBannedUser` (which handles in-flight
 * candidacies and votes). This handler covers the seats they currently hold:
 *
 *   - `politicalParties.chairId / viceChairId / treasurerId`
 *   - `politicalParties.committeeIds[]`
 *   - `statePartyOrg.chairId / viceChairId / treasurerId`
 *   - `coalitions.chairCharacterId` (direct hold + cascade when their party
 *     loses its chair)
 *
 * Mirrors the equivalent cleanup in `retireCharacter` but does NOT delete the
 * character — banned accounts retain their character document so admin tools
 * can inspect them, but they should not retain leadership powers that route
 * authorization through `chairId` / `committeeIds` lookups.
 */

import type { Db, ObjectId } from "mongodb";
import type { Character, PoliticalParty, StatePartyOrg } from "@/lib/db/types";

export interface VacateResult {
  characterIds: string[];
  nationalChairsVacated: number;
  nationalViceChairsVacated: number;
  nationalTreasurersVacated: number;
  committeeSeatsVacated: number;
  stateChairsVacated: number;
  stateViceChairsVacated: number;
  stateTreasurersVacated: number;
  coalitionChairsCleared: number;
}

export async function vacatePartyLeadershipForBannedUser(
  db: Db,
  userId: ObjectId
): Promise<VacateResult> {
  const characters = await db
    .collection<Character>("characters")
    .find({ userId })
    .project<{ _id: ObjectId }>({ _id: 1 })
    .toArray();

  const result: VacateResult = {
    characterIds: characters.map((c) => c._id.toString()),
    nationalChairsVacated: 0,
    nationalViceChairsVacated: 0,
    nationalTreasurersVacated: 0,
    committeeSeatsVacated: 0,
    stateChairsVacated: 0,
    stateViceChairsVacated: 0,
    stateTreasurersVacated: 0,
    coalitionChairsCleared: 0,
  };

  if (characters.length === 0) return result;

  const characterIds = characters.map((c) => c._id);
  const now = new Date();

  // Find every party doc that seats one of these characters anywhere, so we
  // can record per-position counts and cascade chair changes to coalitions.
  const partyDocs = await db
    .collection<PoliticalParty>("politicalParties")
    .find({
      $or: [
        { chairId: { $in: characterIds } },
        { viceChairId: { $in: characterIds } },
        { treasurerId: { $in: characterIds } },
        { committeeIds: { $in: characterIds } },
      ],
    })
    .toArray();

  const characterIdSet = new Set(characterIds.map((id) => id.toString()));
  const partiesLosingChair: ObjectId[] = [];

  for (const party of partyDocs) {
    const setOps: Record<string, unknown> = { updatedAt: now };
    let touched = false;

    if (party.chairId && characterIdSet.has(party.chairId.toString())) {
      setOps.chairId = null;
      result.nationalChairsVacated += 1;
      partiesLosingChair.push(party._id);
      touched = true;
    }
    if (party.viceChairId && characterIdSet.has(party.viceChairId.toString())) {
      setOps.viceChairId = null;
      result.nationalViceChairsVacated += 1;
      touched = true;
    }
    if (party.treasurerId && characterIdSet.has(party.treasurerId.toString())) {
      setOps.treasurerId = null;
      result.nationalTreasurersVacated += 1;
      touched = true;
    }

    const seatedCommittee = (party.committeeIds ?? []).filter((id) =>
      characterIdSet.has(id.toString())
    );

    const updateOp: Record<string, unknown> = {};
    if (touched) {
      updateOp.$set = setOps;
    }
    if (seatedCommittee.length > 0) {
      updateOp.$pull = { committeeIds: { $in: seatedCommittee } };
      result.committeeSeatsVacated += seatedCommittee.length;
      if (!updateOp.$set) updateOp.$set = { updatedAt: now };
    }

    if (Object.keys(updateOp).length > 0) {
      await db
        .collection<PoliticalParty>("politicalParties")
        .updateOne({ _id: party._id }, updateOp);
    }
  }

  // State party leadership — every statePartyOrg doc that seats one of the
  // banned characters in any of the three positions.
  const stateOrgs = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .find({
      $or: [
        { chairId: { $in: characterIds } },
        { viceChairId: { $in: characterIds } },
        { treasurerId: { $in: characterIds } },
      ],
    })
    .toArray();

  for (const org of stateOrgs) {
    const setOps: Record<string, unknown> = { updatedAt: now };
    let touched = false;

    if (org.chairId && characterIdSet.has(org.chairId.toString())) {
      setOps.chairId = null;
      result.stateChairsVacated += 1;
      touched = true;
    }
    if (org.viceChairId && characterIdSet.has(org.viceChairId.toString())) {
      setOps.viceChairId = null;
      result.stateViceChairsVacated += 1;
      touched = true;
    }
    if (org.treasurerId && characterIdSet.has(org.treasurerId.toString())) {
      setOps.treasurerId = null;
      result.stateTreasurersVacated += 1;
      touched = true;
    }

    if (touched) {
      await db
        .collection<StatePartyOrg>("statePartyOrg")
        .updateOne({ _id: org._id }, { $set: setOps });
    }
  }

  // Coalitions where the banned character is the named chair.
  const coalitionDirect = await db
    .collection("coalitions")
    .updateMany(
      { chairCharacterId: { $in: characterIds } },
      { $set: { chairCharacterId: null, updatedAt: now } }
    );
  result.coalitionChairsCleared += coalitionDirect.modifiedCount;

  // Coalitions led by a party whose chair we just cleared — null the cached
  // chairCharacterId so the coalition doesn't keep pointing at a banned
  // account through the chairPartyId chain.
  if (partiesLosingChair.length > 0) {
    const coalitionCascade = await db
      .collection("coalitions")
      .updateMany(
        { chairPartyId: { $in: partiesLosingChair } },
        { $set: { chairCharacterId: null, updatedAt: now } }
      );
    result.coalitionChairsCleared += coalitionCascade.modifiedCount;
  }

  return result;
}
