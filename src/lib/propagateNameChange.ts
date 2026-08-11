import type { Db, ObjectId } from "mongodb";

/**
 * Propagate a character name change to all denormalized collections.
 *
 * Character names are snapshotted into many collections when candidates
 * enter elections, get elected, sponsor bills, etc. This function updates
 * all those copies so displays stay current after a rename.
 *
 * Called fire-and-forget from the name change route — failures are logged
 * but don't block the response.
 */
export async function propagateCharacterNameChange(
  db: Db,
  characterId: ObjectId,
  newName: string
): Promise<void> {
  // ── 1. Election candidates ────────────────────────────────────────────────
  await Promise.all([
    db
      .collection("electionCandidates")
      .updateMany({ characterId }, { $set: { characterName: newName } }),
    db
      .collection("nationalCommitteeCandidates")
      .updateMany({ characterId }, { $set: { characterName: newName } }),
    db
      .collection("statePartyCandidates")
      .updateMany({ characterId }, { $set: { characterName: newName } }),
    db
      .collection("nationalPartyCandidates")
      .updateMany({ characterId }, { $set: { characterName: newName } }),
  ]);

  // ── 2. Elected officials & leadership ─────────────────────────────────────
  await Promise.all([
    db
      .collection("electedOfficials")
      .updateMany({ characterId }, { $set: { characterName: newName } }),
    db
      .collection("congressLeaders")
      .updateMany({ characterId }, { $set: { characterName: newName } }),
    db
      .collection("committeeAssignments")
      .updateMany({ characterId }, { $set: { characterName: newName } }),
    db
      .collection("cabinetMembers")
      .updateMany({ characterId }, { $set: { characterName: newName } }),
  ]);

  // ── 3. Bills (sponsor and co-sponsors) ────────────────────────────────────
  await Promise.all([
    db
      .collection("bills")
      .updateMany({ sponsorId: characterId }, { $set: { sponsorName: newName } }),
    db
      .collection("stateBills")
      .updateMany({ sponsorId: characterId }, { $set: { sponsorName: newName } }),
    // Co-sponsors are an embedded array — use arrayFilters
    db
      .collection("bills")
      .updateMany(
        { "coSponsors.characterId": characterId },
        { $set: { "coSponsors.$[elem].characterName": newName } },
        { arrayFilters: [{ "elem.characterId": characterId }] }
      ),
  ]);

  // ── 4. Central bank ───────────────────────────────────────────────────────
  await db
    .collection("centralBanks")
    .updateMany({ chairCharacterId: characterId }, { $set: { chairCharacterName: newName } });

  // Central bank nested arrays: nominations and lobbying pool
  await Promise.all([
    db
      .collection("centralBanks")
      .updateMany(
        { "nominations.characterId": characterId },
        { $set: { "nominations.$[elem].characterName": newName } },
        { arrayFilters: [{ "elem.characterId": characterId }] }
      ),
    db
      .collection("centralBanks")
      .updateMany(
        { "nominations.nominatedById": characterId },
        { $set: { "nominations.$[elem].nominatedByName": newName } },
        { arrayFilters: [{ "elem.nominatedById": characterId }] }
      ),
    // lobbyingPool: targetCharacterId is who is being lobbied for (has stored name)
    // lobbyistCharacterId has no stored name field — skip it
    db
      .collection("centralBanks")
      .updateMany(
        { "lobbyingPool.targetCharacterId": characterId },
        { $set: { "lobbyingPool.$[elem].targetCharacterName": newName } },
        { arrayFilters: [{ "elem.targetCharacterId": characterId }] }
      ),
    // rateHistory.changedBy is stored as ObjectId — must query with ObjectId, not string
    db
      .collection("centralBanks")
      .updateMany(
        { "rateHistory.changedBy": characterId },
        { $set: { "rateHistory.$[elem].changedByName": newName } },
        { arrayFilters: [{ "elem.changedBy": characterId }] }
      ),
  ]);

  // ── 5. Leadership nominations (nominee + nominator) ───────────────────────
  const nominationCollections = [
    "speakerNominations",
    "houseLeadershipNominations",
    "senateLeadershipNominations",
  ];
  await Promise.all(
    nominationCollections.flatMap((col) => [
      db.collection(col).updateMany({ nomineeId: characterId }, { $set: { nomineeName: newName } }),
      db
        .collection(col)
        .updateMany({ nominatedById: characterId }, { $set: { nominatedByName: newName } }),
    ])
  );

  // Cabinet nominations
  await Promise.all([
    db
      .collection("cabinetNominations")
      .updateMany({ nomineeCharacterId: characterId }, { $set: { nomineeCharacterName: newName } }),
    db
      .collection("cabinetNominations")
      .updateMany(
        { proposedByPresidentId: characterId },
        { $set: { proposedByPresidentName: newName } }
      ),
  ]);

  // UK government formation nominations
  await db
    .collection("governmentFormationVotes")
    .updateMany(
      { "nominees.nomineeCharacterId": characterId },
      { $set: { "nominees.$[elem].nomineeName": newName } },
      { arrayFilters: [{ "elem.nomineeCharacterId": characterId }] }
    );

  // Look up all candidate row ids for this character — playerEndorsements.candidateId
  // and electionVoteTallies.candidateNames are both keyed by the electionCandidates
  // row _id, not characterId (ticket #868).
  const charCandidates = await db
    .collection("electionCandidates")
    .find({ characterId }, { projection: { _id: 1 } })
    .toArray();
  const ownCandidateIds = charCandidates.map((c) => c._id as ObjectId);

  // ── 6. Endorsements ───────────────────────────────────────────────────────
  await Promise.all([
    db
      .collection("playerEndorsements")
      .updateMany({ characterId }, { $set: { characterName: newName } }),
    ownCandidateIds.length > 0
      ? db
          .collection("playerEndorsements")
          .updateMany(
            { candidateId: { $in: ownCandidateIds } },
            { $set: { candidateName: newName } }
          )
      : Promise.resolve(),
    db
      .collection("nppEndorsements")
      .updateMany({ candidateId: characterId }, { $set: { candidateName: newName } }),
  ]);

  // ── 7. Vote tallies (candidateNames is keyed by ElectionCandidate._id) ───
  if (charCandidates.length > 0) {
    await Promise.all(
      charCandidates.map((c) => {
        const candidateIdStr = (c._id as import("mongodb").ObjectId).toString();
        return db
          .collection("electionVoteTallies")
          .updateMany(
            { [`candidateNames.${candidateIdStr}`]: { $exists: true } },
            { $set: { [`candidateNames.${candidateIdStr}`]: newName } }
          );
      })
    );
  }

  // ── 8. Forex / currency orders ────────────────────────────────────────────
  await Promise.all([
    db
      .collection("currencyOrders")
      .updateMany({ characterId }, { $set: { characterName: newName } }),
    db
      .collection("currencyOrders")
      .updateMany({ targetCharacterId: characterId }, { $set: { targetCharacterName: newName } }),
  ]);
}
