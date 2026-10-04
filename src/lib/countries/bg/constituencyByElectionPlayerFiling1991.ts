/**
 * Players file one vacant Grand Assembly constituency in their home region.
 * Filing, party reservations and replacement of the party's NPC nominee commit
 * together; a held mandate or pending relocation prevents a second seat.
 */
import { ObjectId } from "mongodb";
import type {
  Character,
  Election,
  ElectionCandidate,
  ElectedOfficial,
  GameState,
  PoliticalParty,
} from "@/lib/db/types";
import {
  BG_FOUNDING_FILING_LOCKS_COLLECTION,
  type BgFoundingFilingFailure,
  type materializeBgFoundingPlayerFiling,
} from "./foundingPlayerFiling1990";
import {
  BG_GRAND_BY_ELECTIONS_COLLECTION,
  type BgGrandByElectionRecord,
} from "./constituencyByElections1991";
import {
  bgGrandAssemblyAllowsPartialElection,
  bgGrandPartialOwnerEligible,
} from "./rules/constituencyByElection1991";

interface Lock {
  _id: string;
  ownerId: string;
  electionId: ObjectId;
  candidateId: ObjectId;
  party: string;
  constituencyId: string;
  createdAt: Date;
}
export async function materializeBgGrandPartialPlayerFiling(
  input: Parameters<typeof materializeBgFoundingPlayerFiling>[0]
): Promise<
  { allowed: true; insertedId: ObjectId } | { allowed: false; reason: BgFoundingFilingFailure }
> {
  const { db, session, electionId, candidateId, candidate, requestedDistrictId, turn, now } = input;
  const reject = (reason: BgFoundingFilingFailure) => ({ allowed: false as const, reason });
  if (!session.inTransaction()) throw new Error("Bulgarian partial filing requires a transaction");
  const election = await db
    .collection<Election>("elections")
    .findOne({ _id: electionId }, { session });
  const binding = election?.bulgarianFoundingRound;
  if (
    !election ||
    !binding?.byElection ||
    candidate.isNPP ||
    !candidate.electionId.equals(electionId)
  )
    return reject("invalid-ballot");
  const game = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { session, projection: { preset: 1, currentTurn: 1, preIteration: 1 } }
    );
  if (game?.preset !== "1991-default" || game.preIteration?.active) return reject("invalid-ballot");
  const job = await db
    .collection<BgGrandByElectionRecord & { filingGeneration?: number }>(
      BG_GRAND_BY_ELECTIONS_COLLECTION
    )
    .findOne({ _id: binding.receiptId }, { session });
  if (
    !job ||
    job.status !== "open" ||
    binding.ruleVersion !== "parallel-1990-v1" ||
    binding.round !== job.round ||
    binding.byElection.generation !== job.generation ||
    binding.rootElectionId !== job.electionIds[0].toHexString() ||
    binding.registeredVoters !== job.registeredVoters ||
    election.countryId !== "BG" ||
    election.state !== job.regionId ||
    election.totalSeats !== 1 ||
    !job.activeElectionId.equals(electionId) ||
    job.parentReceiptId !== binding.byElection.parentReceiptId ||
    job.districtId !== binding.byElection.districtId ||
    !["active", "upcoming"].includes(election.status)
  )
    return reject("invalid-ballot");
  if (
    election.primaryEndTurn == null ||
    Math.max(turn, game.currentTurn) >= election.primaryEndTurn ||
    Math.max(turn, game.currentTurn) >= job.termEndTurn ||
    (binding.round === 2 && !binding.newNominationDistrictIds?.includes(job.districtId))
  )
    return reject("filing-closed");
  const country = await db
    .collection<{
      _id: string;
      bgOrdinaryAssemblySinceTurn?: number;
      dissolvedTurn?: number;
      bgGrandAssemblyDissolutionSinceTurn?: number;
      bgConstitution1991SinceTurn?: number;
      bgGrandAssemblyContinuationSinceTurn?: number;
    }>("countryGameStates")
    .findOne(
      { _id: "BG" },
      {
        session,
        projection: {
          bgOrdinaryAssemblySinceTurn: 1,
          dissolvedTurn: 1,
          bgGrandAssemblyDissolutionSinceTurn: 1,
          bgConstitution1991SinceTurn: 1,
          bgGrandAssemblyContinuationSinceTurn: 1,
        },
      }
    );
  if (!bgGrandAssemblyAllowsPartialElection(country)) return reject("invalid-ballot");
  const character = await db.collection<Character>("characters").findOne(
    { _id: candidate.characterId },
    {
      session,
      projection: {
        countryId: 1,
        homeState: 1,
        party: 1,
        currentOffice: 1,
        federationPendingResidenceId: 1,
      },
    }
  );
  if (
    !character ||
    character.countryId !== "BG" ||
    character.homeState !== job.regionId ||
    character.federationPendingResidenceId !== undefined
  )
    return reject("invalid-residence");
  if (character.party !== candidate.party) return reject("party-changed");
  if (requestedDistrictId && requestedDistrictId !== job.districtId)
    return reject("outside-region");
  const held = await db.collection<ElectedOfficial>("electedOfficials").findOne(
    {
      countryId: "BG",
      officeType: "assemblyDeputy",
      characterId: character._id,
      seatsHeld: { $gte: 1 },
    },
    { session, projection: { _id: 1 } }
  );
  if (
    !bgGrandPartialOwnerEligible({
      ownerExists: true,
      ownerParty: character.party,
      candidateParty: candidate.party,
      officeType: character.currentOffice?.type,
      isNpc: false,
      heldPlayerMandates: held ? 1 : 0,
    })
  )
    return reject("incompatible-office");
  if (candidate.party !== "independent") {
    const sequence = Number(candidate.party);
    if (!Number.isSafeInteger(sequence) || sequence < 1 || String(sequence) !== candidate.party)
      return reject("unregistered-party");
    const party = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne(
        { countryId: "BG", sequentialId: sequence },
        { session, projection: { regimeStatus: 1 } }
      );
    if (!party || party.regimeStatus === "banned") return reject("unregistered-party");
  }
  const activeJobs = await db
    .collection<BgGrandByElectionRecord>(BG_GRAND_BY_ELECTIONS_COLLECTION)
    .find(
      { parentReceiptId: job.parentReceiptId, status: "open" },
      { session, projection: { activeElectionId: 1 } }
    )
    .toArray();
  const alreadyFiled = await db.collection<ElectionCandidate>("electionCandidates").findOne(
    {
      electionId: { $in: activeJobs.map((row) => row.activeElectionId) },
      characterId: character._id,
      isNPP: { $ne: true },
      status: "active",
    },
    { session, projection: { _id: 1 } }
  );
  if (alreadyFiled) return reject("already-filed");
  const locks = db.collection<Lock>(BG_FOUNDING_FILING_LOCKS_COLLECTION);
  const ownerKey = `${job._id}:player:${character._id}`,
    partyKey = `${job._id}:party:${candidate.party}:${job.districtId}`;
  const ownerLock = await locks.findOne({ _id: ownerKey }, { session });
  const partyLock =
    candidate.party !== "independent" ? await locks.findOne({ _id: partyKey }, { session }) : null;
  if (ownerLock && ownerLock.party !== candidate.party) return reject("party-changed");
  if (partyLock && partyLock.ownerId !== character._id.toHexString())
    return reject("party-slot-full");
  const countryLock = await db
    .collection<{ _id: string; bgGrandByElectionGeneration?: number }>("countryGameStates")
    .updateOne({ _id: "BG" }, { $inc: { bgGrandByElectionGeneration: 1 } }, { session });
  if (countryLock.matchedCount !== 1)
    throw new Error("Bulgarian partial filing lost its country authority");
  const chamber = await db
    .collection<{ _id: string; bg1991MandateGeneration?: number }>("governmentFormations")
    .updateOne({ _id: "BG" }, { $inc: { bg1991MandateGeneration: 1 } }, { session });
  const receipt = await db
    .collection<BgGrandByElectionRecord & { filingGeneration?: number }>(
      BG_GRAND_BY_ELECTIONS_COLLECTION
    )
    .updateOne(
      { _id: job._id, status: "open", activeElectionId: electionId },
      { $inc: { filingGeneration: 1 } },
      { session }
    );
  if (chamber.matchedCount !== 1 || receipt.matchedCount !== 1)
    throw new Error("Bulgarian partial filing authority changed");
  const lockedCandidate = ownerLock
    ? await db
        .collection<ElectionCandidate>("electionCandidates")
        .findOne({ _id: ownerLock.candidateId }, { session })
    : null;
  if (ownerLock && !lockedCandidate)
    throw new Error("Bulgarian partial filing has lost its original person");
  const prior = lockedCandidate?.electionId.equals(electionId) ? lockedCandidate : null;
  const id = prior?._id ?? candidateId;
  if (prior && prior.party !== candidate.party) return reject("party-changed");
  if (prior)
    await db
      .collection<ElectionCandidate>("electionCandidates")
      .updateOne(
        { _id: id },
        { $set: { status: "active" }, $unset: { withdrawnAt: "" } },
        { session }
      );
  else
    await db.collection<ElectionCandidate>("electionCandidates").insertOne(
      {
        ...candidate,
        _id: id,
        bulgarianFoundingNomination: {
          constituencyId: job.districtId,
          ...(ownerLock
            ? {
                rootCandidateId:
                  lockedCandidate?.bulgarianFoundingNomination?.rootCandidateId ??
                  ownerLock.candidateId.toHexString(),
              }
            : {}),
        },
      },
      { session }
    );
  const reservation = {
    ownerId: character._id.toHexString(),
    electionId,
    candidateId: id,
    party: candidate.party,
    constituencyId: job.districtId,
    createdAt: ownerLock?.createdAt ?? now,
  };
  await locks.replaceOne({ _id: ownerKey }, reservation, { session, upsert: true });
  if (candidate.party !== "independent") {
    await locks.replaceOne({ _id: partyKey }, reservation, { session, upsert: true });
    // The filing window precedes the actual ballot. The party has one nominee.
    await db
      .collection<ElectionCandidate>("electionCandidates")
      .updateMany(
        { electionId, party: candidate.party, isNPP: true, status: "active" },
        { $set: { status: "withdrawn", withdrawnAt: now } },
        { session }
      );
  }
  return { allowed: true, insertedId: id };
}
