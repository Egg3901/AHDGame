/**
 * Player Council filing validates the frozen subject and current constitutional mandate.
 * materializeRussianCouncilPlayerFiling replaces only bounded automatic nominees,
 * inserts one player candidacy atomically and preserves profiles and financial accounts.
 */
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type {
  Campaign,
  Character,
  CountryGameState,
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  GameState,
  PoliticalParty,
} from "@/lib/db/types";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import {
  RUSSIAN_COUNCIL_OPENINGS_COLLECTION,
  type RussianCouncilOpeningRecord,
} from "./councilElectionOpening";
import {
  RUSSIAN_DUMA_RESULTS_COLLECTION,
  type RussianDumaResultRecord,
} from "./dumaElectionResult";
import { decideRussianCouncilFiling } from "./rules/councilFiling";
import { planRussianCouncilPlayerAdmission } from "./rules/councilPlayerAdmission";
import { loadRussianCouncilOpeningBinding } from "./councilOpeningBinding";
import { loadPendingRussianCouncilOwners } from "./pendingCouncilMandates";

type FilingCharacter = Pick<
  Character,
  "_id" | "countryId" | "homeState" | "party" | "currentOffice" | "federationPendingResidenceId"
>;
import { russianDumaBoundRoot } from "./dumaConvocationAuthority";
export async function validateRussianCouncilPlayerFiling(input: {
  db: Db;
  election: Election;
  character: FilingCharacter;
  turn: number;
  registrationOrder: number;
  session?: ClientSession;
}) {
  const { db, election, character, turn, registrationOrder, session } = input;
  const reject = (reason: "unbound-mandate" | "invalid-ballot") => ({
    allowed: false as const,
    reason,
  });
  const binding = election.russianCouncilRound;
  if (!binding) return reject("unbound-mandate");
  const game = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { session, projection: { preset: 1 } });
  const country = await db.collection<CountryGameState>("countryGameStates").findOne(
    { _id: "RU" },
    {
      session,
      projection: {
        ruSovietSuccessionSinceTurn: 1,
        ruFederalAssemblyMandateSinceTurn: 1,
        ruFirstCouncilElectionCohortId: 1,
        ruCouncilComposition: 1,
        ruFirstDumaElectionCohortId: 1,
        ruDumaConvocationCohortId: 1,
        ruFederalAssemblySinceTurn: 1,
      },
    }
  );
  if (!country || game?.preset !== "1991-default") return reject("unbound-mandate");
  const bound = await loadRussianCouncilOpeningBinding({
    db,
    session,
    country,
    cohortId: binding.cohortId,
    turn,
  });
  if (!bound) return reject("unbound-mandate");
  const { opening, rootCohortId } = bound;
  if (
    opening.mandateSinceTurn !== binding.mandateSinceTurn ||
    (!opening.generation &&
      (binding.rootCohortId != null ||
        binding.generation != null ||
        binding.predecessorElectionId != null)) ||
    (opening.generation &&
      (!binding.rootCohortId?.equals(rootCohortId) || binding.generation !== opening.generation))
  )
    return reject("unbound-mandate");
  const district = bound.ballots.find((row) => row.seatId === election.seatId);
  if (
    !district ||
    district.districtNumber !== binding.districtNumber ||
    district.registeredVoters !== binding.registeredVoters ||
    !district.id.equals(election._id) ||
    ("predecessorId" in district &&
      district.predecessorId !== binding.predecessorElectionId?.toHexString()) ||
    !["active", "upcoming"].includes(election.status)
  )
    return reject("invalid-ballot");
  const partySequence = Number(character.party);
  const party =
    Number.isSafeInteger(partySequence) &&
    partySequence > 0 &&
    String(partySequence) === character.party
      ? await db
          .collection<PoliticalParty>("politicalParties")
          .findOne(
            { countryId: "RU", sequentialId: partySequence, regimeStatus: { $ne: "banned" } },
            { session, projection: { countryId: 1, sequentialId: 1, regimeStatus: 1 } }
          )
      : null;
  const candidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find(
      {
        status: "active",
        $or: [{ electionId: election._id }, { characterId: character._id, isNPP: { $ne: true } }],
      },
      {
        session,
        projection: {
          electionId: 1,
          characterId: 1,
          nppId: 1,
          party: 1,
          isNPP: 1,
          boundedNpcNomineeId: 1,
          russianCouncilNomination: 1,
        },
      }
    )
    .toArray();
  const admission = planRussianCouncilPlayerAdmission({
    ownerId: character._id.toHexString(),
    party: character.party ?? "independent",
    candidates: candidates
      .filter((row) => row.electionId.equals(election._id))
      .map((row) => ({
        id: row._id.toHexString(),
        ownerId: (row.isNPP ? row.nppId : row.characterId)?.toHexString() ?? "",
        party: row.party,
        isNpc: row.isNPP === true,
        bounded:
          row.boundedNpcNomineeId?.equals(row._id) === true &&
          row.russianCouncilNomination !== undefined,
        registrationOrder: row.russianCouncilNomination?.registrationOrder ?? 0,
      })),
  });
  if (!admission.allowed) return admission;
  const dumaRoot = russianDumaBoundRoot(country);
  const dumaResults = dumaRoot
    ? await db
        .collection<RussianDumaResultRecord>(RUSSIAN_DUMA_RESULTS_COLLECTION)
        .find(
          {
            countryId: "RU",
            preset: "1991-default",
            mandateSinceTurn: binding.mandateSinceTurn,
            $or: [{ cohortId: dumaRoot }, { rootCohortId: dumaRoot }],
          },
          { session, projection: { result: 1, nominees: 1, seatedOnTurn: 1 } }
        )
        .toArray()
    : [];
  const owner = character._id.toHexString();
  const pendingDumaMandate = dumaResults.some(
    (row) =>
      row.seatedOnTurn === undefined &&
      (row.result.constituencyResults.some(
        (district) => district.winner?.ownerId === owner && !district.winner.isNpc
      ) ||
        row.nominees.some(
          (nominee) =>
            !nominee.isNpc &&
            nominee.ownerId.equals(character._id) &&
            (row.result.listAssignment?.seatsByNominee[nominee.candidateId.toHexString()] ?? 0) > 0
        ))
  );
  const councilOwners = await loadPendingRussianCouncilOwners({
    db,
    session,
    cohortId: rootCohortId,
    mandateSinceTurn: binding.mandateSinceTurn,
  });
  const decision = decideRussianCouncilFiling({
    preset: game?.preset ?? "",
    turn,
    registrationOrder,
    successionSinceTurn: country.ruSovietSuccessionSinceTurn,
    mandateSinceTurn: country.ruFederalAssemblyMandateSinceTurn,
    boundCohortId: country.ruFirstCouncilElectionCohortId?.toHexString(),
    election: {
      countryId: election.countryId ?? "",
      type: election.electionType,
      state: election.state,
      seatId: election.seatId ?? "",
      totalSeats: election.totalSeats ?? 0,
      primaryEndTurn: election.primaryEndTurn,
      cohortId: binding.cohortId.toHexString(),
      rootCohortId: binding.rootCohortId?.toHexString(),
      mandateSinceTurn: binding.mandateSinceTurn,
      districtNumber: binding.districtNumber,
    },
    character: {
      countryId: character.countryId ?? "",
      homeState: character.homeState,
      party: character.party ?? "independent",
      pendingRelocation: character.federationPendingResidenceId !== undefined,
      recognizedParty:
        !!party &&
        party.countryId === "RU" &&
        party.sequentialId === partySequence &&
        party.regimeStatus !== "banned",
      holdsOtherChamberMandate:
        character.currentOffice?.type === "dumaDeputy" || pendingDumaMandate,
      holdsCouncilMandate:
        character.currentOffice?.type === "federationCouncilMember" ||
        councilOwners.has(`player:${owner}`),
      hasOtherActiveCandidacy: candidates.some((row) => !row.electionId.equals(election._id)),
    },
    associationNominees: admission.associationNominees,
  });
  return decision.allowed ? { ...decision, withdrawIds: admission.withdrawIds } : decision;
}

export async function materializeRussianCouncilPlayerFiling(input: {
  db: Db;
  session: ClientSession;
  electionId: ObjectId;
  candidateId: ObjectId;
  candidate: Omit<ElectionCandidate, "_id">;
  turn: number;
  now: Date;
}) {
  const { db, session, electionId, candidateId, candidate, turn, now } = input;
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(turn) ||
    turn < 1 ||
    !Number.isFinite(now.getTime()) ||
    !candidate.characterId ||
    candidate.isNPP ||
    !candidate.electionId.equals(electionId)
  )
    throw new Error("Council player filing needs a transaction and one player identity");
  const election = await db
    .collection<Election>("elections")
    .findOne({ _id: electionId }, { session });
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
    !election ||
    !character ||
    character.party !== candidate.party ||
    character.countryId !== candidate.countryId
  )
    return { allowed: false as const, reason: "unbound-mandate" as const };
  const decision = await validateRussianCouncilPlayerFiling({
    db,
    election,
    character,
    turn,
    registrationOrder: now.getTime(),
    session,
  });
  if (!decision.allowed) return decision;
  const tally = await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .findOne({ electionId }, { session, projection: { totalVotes: 1 } });
  if (Object.values(tally?.totalVotes ?? {}).some((votes) => votes !== 0))
    return { allowed: false as const, reason: "filing-closed" as const };
  const binding = election.russianCouncilRound!;
  const guard = await db.collection<CountryGameState>("countryGameStates").updateOne(
    {
      _id: "RU",
      ruFirstCouncilElectionCohortId: binding.rootCohortId ?? binding.cohortId,
      ruFederalAssemblyMandateSinceTurn: binding.mandateSinceTurn,
    },
    { $set: { ruFirstCouncilElectionCohortId: binding.rootCohortId ?? binding.cohortId } },
    { session }
  );
  if (guard.matchedCount !== 1) throw new Error("Council filing mandate changed during admission");
  if (decision.withdrawIds.length) {
    const withdrawn = await db.collection<ElectionCandidate>("electionCandidates").updateMany(
      {
        _id: { $in: decision.withdrawIds.map((id) => new ObjectId(id)) },
        electionId,
        status: "active",
      },
      { $set: { status: "withdrawn", withdrawnAt: now } },
      { session }
    );
    if (withdrawn.modifiedCount !== decision.withdrawIds.length)
      throw new Error("Council association nominations changed during admission");
    const unset = Object.fromEntries(
      decision.withdrawIds.flatMap((id) =>
        ["primaryVotes", "totalVotes", "candidateNames", "candidateParties", "seatsEstimate"].map(
          (field) => [`${field}.${id}`, "" as const]
        )
      )
    );
    await db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .updateOne({ electionId }, { $unset: unset, $set: { updatedAt: now } }, { session });
  }
  await db
    .collection<ElectionCandidate>("electionCandidates")
    .insertOne(
      { ...candidate, _id: candidateId, russianCouncilNomination: decision.nomination },
      { session }
    );
  await db
    .collection<Campaign>("campaigns")
    .updateOne(
      { electionId, candidateId: candidate.characterId, status: { $ne: "archived" } },
      { $set: { party: candidate.party, updatedAt: now } },
      { session }
    );
  const receipt = await db
    .collection<RussianCouncilOpeningRecord>(RUSSIAN_COUNCIL_OPENINGS_COLLECTION)
    .updateOne(
      { cohortId: binding.cohortId, mandateSinceTurn: binding.mandateSinceTurn },
      { $inc: { playerFilings: 1 } },
      { session }
    );
  if (receipt.matchedCount !== 1)
    throw new Error("Council opening receipt changed during admission");
  return { allowed: true as const, insertedId: candidateId };
}

export async function registerRussianCouncilPlayerCandidate(
  input: Omit<
    Parameters<typeof materializeRussianCouncilPlayerFiling>[0],
    "session" | "candidateId"
  >
) {
  const candidateId = new ObjectId();
  return runRequiredTransaction(
    (session) => materializeRussianCouncilPlayerFiling({ ...input, session, candidateId }),
    { client: input.db.client }
  );
}
