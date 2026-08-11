import { ApiError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import { createNotification } from "@/lib/notifications";
import { clearWhippedFromVote } from "@/lib/congress/clearWhippedVote";
import { buildEmbeddedVoteTallyUpdate } from "@/lib/votes/embeddedVoteTally";
import { getGameTime } from "@/lib/time/gameTime";
import { getGameState } from "@/lib/gameState";
import { checkAppointmentEligibility, isVoteClosed } from "@/lib/turn/parliamentaryGovernment";
import { triggerSnapElection, SnapElectionError } from "@/lib/turn/snapElection";
import {
  PM_VOTE_DURATION_HOURS,
  NO_CONFIDENCE_COOLDOWN_TURNS,
} from "@/lib/constants/governmentFormation";
import {
  getGovernmentFormationsCollection,
  getNoConfidenceVotesCollection,
  getPMAppointmentVotesCollection,
} from "@/lib/db/collections/governmentFormation";
import { getParliamentaryCountryConfig } from "@/lib/government/parliamentaryCountry";
import {
  getLowerChamberOfficeType,
  getJointSittingOfficeTypes,
} from "@/lib/legislature/chamberOfficeType";
import { getCountryConfig } from "@/lib/constants/countries";
import { canTriggerNoConfidence } from "@/lib/turn/onePartyConstraints";
import { getCountryState } from "@/lib/countryState";
import { ObjectId, type Db } from "mongodb";
import type { Character, ElectedOfficial, PoliticalParty } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

export async function proposePmAppointment(
  db: Db,
  countryId: CountryId,
  nominator: Pick<Character, "_id" | "name">,
  nomineeCharacterId: string
): Promise<{ success: true; voteId: string }> {
  const countryConfig = getParliamentaryCountryConfig(countryId);
  const gameTime = await getGameTime();
  const govFormationExists = await getGovernmentFormationsCollection(db).findOne(
    { _id: countryId },
    { projection: { _id: 1 } }
  );
  if (!govFormationExists) {
    throw notFound("Government formation record not found");
  }
  const nominationLockId = new ObjectId();

  const nominationLock = await getGovernmentFormationsCollection(db).findOneAndUpdate(
    {
      _id: countryId,
      $or: [
        { pmAppointmentNominationLockExpiresAt: null },
        { pmAppointmentNominationLockExpiresAt: { $exists: false } },
        { pmAppointmentNominationLockExpiresAt: { $lte: new Date() } },
      ],
    },
    {
      $set: {
        pmAppointmentNominationLockId: nominationLockId,
        pmAppointmentNominationLockExpiresAt: new Date(Date.now() + 30_000),
        updatedAt: gameTime.effectiveNow,
      },
    },
    { returnDocument: "after" }
  );
  if (!nominationLock) {
    throw new ApiError(409, "Another PM appointment nomination is currently being processed");
  }

  try {
    const govFormation = await getGovernmentFormationsCollection(db).findOne({ _id: countryId });
    if (!govFormation) {
      throw notFound("Government formation record not found");
    }
    if (govFormation.status !== "pending") {
      const activeVonc = await getNoConfidenceVotesCollection(db).findOne({
        countryId,
        status: "active",
      });
      if (!activeVonc) {
        throw badRequest(
          "PM appointment is only available when government formation is pending or a vote of no confidence is active"
        );
      }
    }
    const eligibility = await checkAppointmentEligibility(
      db,
      countryId,
      nominator._id,
      govFormation.majorityThreshold
    );
    if (!eligibility.eligible) {
      throw forbidden(
        "Only an eligible Party Chair or Coalition Chair can nominate a PM candidate"
      );
    }

    // PM votes only — an active head-of-state vote (shared collection,
    // office: "headOfState") must not block a PM nomination.
    const dedupFilter =
      eligibility.coalitionId != null
        ? {
            countryId,
            status: "active" as const,
            office: { $exists: false },
            coalitionId: eligibility.coalitionId,
          }
        : {
            countryId,
            status: "active" as const,
            office: { $exists: false },
            coalitionId: null,
            nomineePartyId: String(eligibility.qualifyingPartyIds[0]),
          };
    const existingVote = await getPMAppointmentVotesCollection(db).findOne(dedupFilter);
    if (existingVote) {
      throw badRequest(
        eligibility.coalitionId != null
          ? "Your coalition already has an active appointment vote"
          : "Your party already has an active appointment vote"
      );
    }

    const nomineeId = new ObjectId(nomineeCharacterId);
    const nomineeChar = await db
      .collection<{ _id: ObjectId; name: string; party?: string; userId?: ObjectId }>("characters")
      .findOne({ _id: nomineeId, userId: { $exists: true } });
    if (!nomineeChar) {
      throw notFound("Nominee not found or is not a player character");
    }

    const lowerChamberKey = getLowerChamberOfficeType(countryId);
    const nomineeOfficial = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      characterId: nomineeId,
      countryId,
      officeType: lowerChamberKey,
    });
    if (!nomineeOfficial) {
      throw badRequest(
        `Nominee must be an elected ${countryConfig.legislature.lowerChamber.name} member`
      );
    }

    const nomineePartyStr = nomineeOfficial.party ?? nomineeChar.party ?? "";
    const nomineePartyId = parseInt(nomineePartyStr, 10);
    if (!eligibility.qualifyingPartyIds.includes(nomineePartyId)) {
      throw forbidden(
        eligibility.formationType === "coalition"
          ? "Nominee must be a member of one of the coalition parties"
          : "Nominee must be a member of your party"
      );
    }

    const now = new Date(gameTime.effectiveNow);
    const closesAt = new Date(now.getTime() + PM_VOTE_DURATION_HOURS * 3_600_000);
    const voteDoc = {
      _id: new ObjectId(),
      countryId,
      nomineeCharacterId: nomineeId,
      nomineeName: nomineeChar.name,
      nomineePartyId: nomineePartyStr,
      nominatedByCharacterId: nominator._id,
      formationType: eligibility.formationType,
      coalitionId: eligibility.coalitionId,
      coalitionPartyIds: eligibility.coalitionPartyIds,
      votesFor: 0,
      votesAgainst: 0,
      votes: {} as Record<string, "aye" | "nay">,
      status: "active" as const,
      openedAt: now,
      closesAt,
      closesOnTurn: gameTime.currentTurn + PM_VOTE_DURATION_HOURS,
      closedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const voteResult = await getPMAppointmentVotesCollection(db).insertOne(voteDoc);
    return { success: true, voteId: voteResult.insertedId.toString() };
  } finally {
    await getGovernmentFormationsCollection(db).updateOne(
      { _id: countryId, pmAppointmentNominationLockId: nominationLockId },
      {
        $set: {
          pmAppointmentNominationLockExpiresAt: null,
          updatedAt: new Date(),
        },
        $unset: { pmAppointmentNominationLockId: "" },
      }
    );
  }
}

/**
 * Nominate a candidate for a legislature-appointed ceremonial head of state
 * (RU Chairman of the Presidium — spec §2.3). Mirrors proposePmAppointment
 * with three differences: gated on `headOfStateSelection ===
 * "legislatureAppointment"`; available only while the office is VACANT
 * (post-convocation), independent of formation status; and the nominee may
 * hold a seat in EITHER chamber (the vote is a joint sitting).
 */
export async function proposeHosAppointment(
  db: Db,
  countryId: CountryId,
  nominator: Pick<Character, "_id" | "name">,
  nomineeCharacterId: string
): Promise<{ success: true; voteId: string }> {
  getParliamentaryCountryConfig(countryId);
  const config = getCountryConfig(countryId);
  if (config.headOfStateSelection !== "legislatureAppointment") {
    throw badRequest("This country's head of state is not appointed by the legislature");
  }
  const gameTime = await getGameTime();

  const govFormation = await getGovernmentFormationsCollection(db).findOne({ _id: countryId });
  if (!govFormation) {
    throw notFound("Government formation record not found");
  }
  if (govFormation.hosCharacterId != null || govFormation.hosNppId != null) {
    throw badRequest(`The office of ${config.headOfStateTitle} is currently filled`);
  }

  const eligibility = await checkAppointmentEligibility(
    db,
    countryId,
    nominator._id,
    govFormation.majorityThreshold
  );
  if (!eligibility.eligible) {
    throw forbidden(
      `Only an eligible Party Chair or Coalition Chair can nominate a ${config.headOfStateTitle} candidate`
    );
  }

  // One active head-of-state vote per party/coalition (PM dedup parity).
  const dedupFilter =
    eligibility.coalitionId != null
      ? {
          countryId,
          status: "active" as const,
          office: "headOfState" as const,
          coalitionId: eligibility.coalitionId,
        }
      : {
          countryId,
          status: "active" as const,
          office: "headOfState" as const,
          coalitionId: null,
          nomineePartyId: String(eligibility.qualifyingPartyIds[0]),
        };
  const existingVote = await getPMAppointmentVotesCollection(db).findOne(dedupFilter);
  if (existingVote) {
    throw badRequest("Your party already has an active head-of-state appointment vote");
  }

  const nomineeId = new ObjectId(nomineeCharacterId);
  const nomineeChar = await db
    .collection<{ _id: ObjectId; name: string; party?: string; userId?: ObjectId }>("characters")
    .findOne({ _id: nomineeId, userId: { $exists: true } });
  if (!nomineeChar) {
    throw notFound("Nominee not found or is not a player character");
  }

  // Joint sitting: the nominee may sit in either Supreme Soviet chamber.
  const nomineeOfficial = await db.collection<ElectedOfficial>("electedOfficials").findOne({
    characterId: nomineeId,
    countryId,
    officeType: { $in: getJointSittingOfficeTypes(countryId) },
  });
  if (!nomineeOfficial) {
    throw badRequest("Nominee must hold a seat in the legislature");
  }

  const nomineePartyStr = nomineeOfficial.party ?? nomineeChar.party ?? "";
  const nomineePartyId = parseInt(nomineePartyStr, 10);
  if (!eligibility.qualifyingPartyIds.includes(nomineePartyId)) {
    throw forbidden(
      eligibility.formationType === "coalition"
        ? "Nominee must be a member of one of the coalition parties"
        : "Nominee must be a member of your party"
    );
  }

  const now = new Date(gameTime.effectiveNow);
  const closesAt = new Date(now.getTime() + PM_VOTE_DURATION_HOURS * 3_600_000);
  const voteDoc = {
    _id: new ObjectId(),
    countryId,
    office: "headOfState" as const,
    nomineeCharacterId: nomineeId,
    nomineeName: nomineeChar.name,
    nomineePartyId: nomineePartyStr,
    nominatedByCharacterId: nominator._id,
    formationType: eligibility.formationType,
    coalitionId: eligibility.coalitionId,
    coalitionPartyIds: eligibility.coalitionPartyIds,
    votesFor: 0,
    votesAgainst: 0,
    votes: {} as Record<string, "aye" | "nay">,
    status: "active" as const,
    openedAt: now,
    closesAt,
    closesOnTurn: gameTime.currentTurn + PM_VOTE_DURATION_HOURS,
    closedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  const voteResult = await getPMAppointmentVotesCollection(db).insertOne(voteDoc);
  return { success: true, voteId: voteResult.insertedId.toString() };
}

export async function castPmAppointmentVote(
  db: Db,
  countryId: CountryId,
  character: Pick<Character, "_id">,
  voteIdParam: string,
  vote: "aye" | "nay"
): Promise<{ success: true; votesFor: number; votesAgainst: number }> {
  const countryConfig = getParliamentaryCountryConfig(countryId);
  if (!ObjectId.isValid(voteIdParam)) {
    throw badRequest("Invalid vote ID format");
  }
  const voteId = new ObjectId(voteIdParam);

  const voteDoc = await getPMAppointmentVotesCollection(db).findOne({ _id: voteId, countryId });
  if (!voteDoc) {
    throw notFound("PM appointment vote not found");
  }
  if (voteDoc.status !== "active") {
    throw badRequest("This vote has already closed");
  }
  // closesAt is anchored to the game clock at write time, so the window check
  // must compare against gameTime.effectiveNow to stay consistent under drift.
  const appointmentGameTime = await getGameTime();
  if (isVoteClosed(voteDoc, appointmentGameTime.currentTurn, appointmentGameTime.effectiveNow)) {
    throw badRequest("The voting window has closed");
  }

  // Head-of-state votes are a JOINT sitting — members of either chamber vote.
  const voterOfficeTypes =
    voteDoc.office === "headOfState"
      ? getJointSittingOfficeTypes(countryId)
      : [getLowerChamberOfficeType(countryId)];
  const voterOfficial = await db.collection<ElectedOfficial>("electedOfficials").findOne({
    characterId: character._id,
    countryId,
    officeType: { $in: voterOfficeTypes },
  });
  if (!voterOfficial) {
    throw forbidden(
      voteDoc.office === "headOfState"
        ? "You must be a seated member of the legislature to vote on this appointment"
        : `You must be an elected ${countryConfig.legislature.lowerChamber.name} member to vote on a PM appointment`
    );
  }

  const updateResult = await getPMAppointmentVotesCollection(db).updateOne(
    { _id: voteId, countryId, status: "active" },
    buildEmbeddedVoteTallyUpdate({
      voteField: "votes",
      voteKey: character._id.toString(),
      vote,
      tallyFieldByVote: { aye: "votesFor", nay: "votesAgainst" },
      updatedAt: new Date(),
      weight: voterOfficial.seatsHeld ?? 1,
    })
  );
  if (updateResult.matchedCount === 0) {
    throw badRequest("This vote has already closed");
  }

  await clearWhippedFromVote(db, "pmAppointmentVotes", voteId, character._id);
  const updatedVote = await getPMAppointmentVotesCollection(db).findOne({ _id: voteId, countryId });

  return {
    success: true,
    votesFor: updatedVote?.votesFor ?? 0,
    votesAgainst: updatedVote?.votesAgainst ?? 0,
  };
}

export async function proposeNoConfidence(
  db: Db,
  countryId: CountryId,
  proposerUserId: string,
  proposer: Pick<Character, "_id" | "name">
): Promise<{ success: true; voteId: string }> {
  const countryConfig = getParliamentaryCountryConfig(countryId);
  const gameTime = await getGameTime();

  const govFormation = await getGovernmentFormationsCollection(db).findOne({ _id: countryId });
  if (!govFormation) {
    throw notFound("Government formation record not found");
  }
  if (govFormation.status !== "formed" || !govFormation.pmCharacterId) {
    throw badRequest(`There is no ${countryConfig.executiveTitle} currently in office`);
  }
  if (govFormation.activeVoteId !== null) {
    throw badRequest("A no-confidence vote is already in progress");
  }

  const proposerOfficial = await db.collection<ElectedOfficial>("electedOfficials").findOne({
    characterId: proposer._id,
    countryId,
    officeType: getLowerChamberOfficeType(countryId),
  });
  if (!proposerOfficial) {
    throw forbidden(
      `You must be an elected ${countryConfig.legislature.lowerChamber.shortName} member to propose a no-confidence motion`
    );
  }

  // One-party-state guard: defence-in-depth on top of the route-level
  // assertConfidenceVoteMechanism check. Today, CN's
  // confidenceVoteMechanism is false so the route returns 400 before
  // reaching this command, but the gate protects future one-party
  // states that opt into confidence votes from non-ruling-party VONCs.
  const proposerPartySeqId = parseInt(proposerOfficial.party ?? "0", 10);
  const proposerParty = await db
    .collection<PoliticalParty>("politicalParties")
    .findOne({ countryId, sequentialId: proposerPartySeqId });
  // Runtime governmentType so a post-Stage-4 conversion immediately
  // changes the ruling-party VONC gate.
  const vonRuntime = await getCountryState(db, countryId);
  if (!canTriggerNoConfidence({ governmentType: vonRuntime.governmentType }, proposerParty)) {
    throw forbidden("Only the ruling party may move a vote of no confidence in this country.");
  }

  const currentTurn = (await getGameState(db))?.currentTurn ?? 0;
  const lastVote = await getNoConfidenceVotesCollection(db)
    .find({ countryId })
    .sort({ turnProposed: -1 })
    .limit(1)
    .toArray();
  if (lastVote.length > 0) {
    const turnsElapsed = currentTurn - lastVote[0].turnProposed;
    if (turnsElapsed < NO_CONFIDENCE_COOLDOWN_TURNS) {
      const remaining = NO_CONFIDENCE_COOLDOWN_TURNS - turnsElapsed;
      throw badRequest(
        `Cannot propose another no-confidence motion for ${remaining} more turn${remaining === 1 ? "" : "s"}`
      );
    }
  }

  let targetPmName = govFormation.pmName ?? "Unknown";
  if (!govFormation.pmName) {
    const pmChar = await db
      .collection<{ _id: ObjectId; name: string }>("characters")
      .findOne({ _id: govFormation.pmCharacterId });
    targetPmName = pmChar?.name ?? "Unknown";
  }

  const now = new Date(gameTime.effectiveNow);
  const closesAt = new Date(now.getTime() + PM_VOTE_DURATION_HOURS * 3_600_000);
  const voteDoc = {
    _id: new ObjectId(),
    countryId,
    proposedByCharacterId: proposer._id,
    proposedByName: proposer.name,
    targetPmCharacterId: govFormation.pmCharacterId,
    targetPmName,
    votesFor: 0,
    votesAgainst: 0,
    votes: {} as Record<string, "aye" | "nay">,
    status: "active" as const,
    openedAt: now,
    closesAt,
    closesOnTurn: gameTime.currentTurn + PM_VOTE_DURATION_HOURS,
    closedAt: null,
    turnProposed: currentTurn,
    createdAt: now,
    updatedAt: now,
  };

  const voteResult = await getNoConfidenceVotesCollection(db).insertOne(voteDoc);
  const claimResult = await getGovernmentFormationsCollection(db).findOneAndUpdate(
    { _id: countryId, activeVoteId: null },
    { $set: { activeVoteId: voteResult.insertedId, updatedAt: now } }
  );
  if (!claimResult) {
    await getNoConfidenceVotesCollection(db).deleteOne({ _id: voteResult.insertedId });
    throw badRequest("A no-confidence vote is already in progress");
  }

  await notifyNoConfidenceParticipants(
    db,
    countryId,
    proposerUserId,
    proposer.name,
    govFormation.pmCharacterId,
    targetPmName,
    getLowerChamberOfficeType(countryId),
    countryConfig.legislature.lowerChamber.shortName,
    countryConfig.executiveTitle
  );

  return { success: true, voteId: voteResult.insertedId.toString() };
}

export async function castNoConfidenceVote(
  db: Db,
  countryId: CountryId,
  character: Pick<Character, "_id">,
  voteIdParam: string,
  vote: "aye" | "nay"
): Promise<{ success: true; votesFor: number; votesAgainst: number }> {
  const countryConfig = getParliamentaryCountryConfig(countryId);
  if (!ObjectId.isValid(voteIdParam)) {
    throw badRequest("Invalid vote ID format");
  }
  const voteId = new ObjectId(voteIdParam);

  const voteDoc = await getNoConfidenceVotesCollection(db).findOne({ _id: voteId, countryId });
  if (!voteDoc) {
    throw notFound("No-confidence vote not found");
  }
  if (voteDoc.status !== "active") {
    throw badRequest("This vote has already closed");
  }
  // closesAt is anchored to the game clock at write time, so the window check
  // must compare against gameTime.effectiveNow to stay consistent under drift.
  const noConfidenceGameTime = await getGameTime();
  if (isVoteClosed(voteDoc, noConfidenceGameTime.currentTurn, noConfidenceGameTime.effectiveNow)) {
    throw badRequest("The voting window has closed");
  }

  const voterOfficial = await db.collection<ElectedOfficial>("electedOfficials").findOne({
    characterId: character._id,
    countryId,
    officeType: getLowerChamberOfficeType(countryId),
  });
  if (!voterOfficial) {
    throw forbidden(
      `You must be an elected ${countryConfig.legislature.lowerChamber.name} member to vote on a no-confidence motion`
    );
  }

  const updateResult = await getNoConfidenceVotesCollection(db).updateOne(
    { _id: voteId, countryId, status: "active" },
    buildEmbeddedVoteTallyUpdate({
      voteField: "votes",
      voteKey: character._id.toString(),
      vote,
      tallyFieldByVote: { aye: "votesFor", nay: "votesAgainst" },
      updatedAt: new Date(),
      weight: voterOfficial.seatsHeld ?? 1,
    })
  );
  if (updateResult.matchedCount === 0) {
    throw badRequest("This vote has already closed");
  }

  await clearWhippedFromVote(db, "noConfidenceVotes", voteId, character._id);
  const updatedVote = await getNoConfidenceVotesCollection(db).findOne({ _id: voteId, countryId });

  return {
    success: true,
    votesFor: updatedVote?.votesFor ?? 0,
    votesAgainst: updatedVote?.votesAgainst ?? 0,
  };
}

export async function triggerPrimeMinisterSnapElection(
  db: Db,
  countryId: CountryId,
  character: Pick<Character, "_id" | "name">
): Promise<{
  success: true;
  message: string;
  snapElectionsUsed: number;
  snapElectionsRemaining: number;
}> {
  const gov = await getGovernmentFormationsCollection(db).findOne({ _id: countryId });
  if (!gov || gov.status !== "formed") {
    throw badRequest("No government is currently formed");
  }
  if (!gov.pmCharacterId || gov.pmCharacterId.toString() !== character._id.toString()) {
    throw forbidden("Only the sitting PM can dissolve the lower house");
  }

  try {
    // Anchor spawned-election timestamps to the game clock so primary/general
    // phase boundaries land on the same clock readers compare against.
    const gameTime = await getGameTime();
    const result = await triggerSnapElection(db, countryId, gameTime.effectiveNow, {
      reason: "pm-trigger",
      actorName: character.name,
    });
    return {
      success: true,
      message: `Snap election triggered. ${result.electionsSpawned} elections spawned.`,
      snapElectionsUsed: result.snapElectionsUsed,
      snapElectionsRemaining: result.snapElectionsRemaining,
    };
  } catch (error) {
    if (error instanceof SnapElectionError) {
      throw badRequest(error.message);
    }
    throw error;
  }
}

async function notifyNoConfidenceParticipants(
  db: Db,
  countryId: CountryId,
  proposerUserId: string,
  proposerName: string,
  pmCharacterId: ObjectId,
  pmName: string,
  lowerChamberKey: string,
  lowerChamberShortName: string,
  executiveTitle: string
): Promise<void> {
  const [pmChar, allLowerMps] = await Promise.all([
    db.collection<Character>("characters").findOne({ _id: pmCharacterId }),
    db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ officeType: lowerChamberKey, countryId, isNPP: { $ne: true } })
      .toArray(),
  ]);

  if (pmChar?.userId) {
    await createNotification({
      userId: pmChar.userId,
      type: "system",
      title: "No-Confidence Motion Proposed",
      message: `${proposerName} has proposed a vote of no confidence against you. ${lowerChamberShortName} members will vote over the next ${PM_VOTE_DURATION_HOURS} hours.`,
    });
  }

  const notifiedUserIds = new Set<string>();
  if (pmChar?.userId) {
    notifiedUserIds.add(pmChar.userId.toString());
  }
  notifiedUserIds.add(proposerUserId);

  const mpCharacterIds = allLowerMps
    .filter((official) => official.characterId)
    .map((official) => official.characterId!);
  if (mpCharacterIds.length === 0) {
    return;
  }

  const mpCharacters = await db
    .collection<Character>("characters")
    .find({ _id: { $in: mpCharacterIds } })
    .toArray();
  const notifications = mpCharacters
    .filter((character) => character.userId && !notifiedUserIds.has(character.userId.toString()))
    .map((character) => ({
      userId: character.userId!,
      type: "system" as const,
      title: "No-Confidence Vote Called",
      message: `${proposerName} has called a vote of no confidence against ${executiveTitle} ${pmName}. As a ${lowerChamberShortName} member, you may cast your vote.`,
    }));
  if (notifications.length > 0) {
    await Promise.all(notifications.map((notification) => createNotification(notification)));
  }
}
